import type { RpcResponse } from "@stella/contracts/backend/protocol";
import {
  CLOUD_CODE_CONNECT_METHODS,
  type CloudCodeConnectMethod,
  type CloudCodeConnectResponse,
} from "@stella/executor-cloud/cloud-code-connect-protocol";
import { cloudGeneralToolNames } from "@stella/executor-cloud/cloud-general-tools";
import { CLOUD_AGENT_MOVE_TOOL } from "@stella/executor-cloud/cloud-agent-move-protocol";
import { invokeCloudConnect, type CloudConnectClient } from "../cloud-code-tool.js";
import {
  CloudConnectorDirectory,
  ownerMcpSource,
  createCloudConnectClient,
} from "../cloud-connect-client.js";
import {
  listIntegrationActions,
  listIntegrationCatalog,
} from "../integrations/catalog.js";
import { unwrapRpc } from "../owner-store/errors.js";
import { SLACK_CONNECTOR_SOURCE } from "../slack/workspace.js";
import { isSlackConversationId } from "../slack/conversation-id.js";
import type { TurnRequest } from "./shared/types.js";

type AgentConnectTurn = Pick<
  TurnRequest,
  | "ownerId"
  | "ownerGeneration"
  | "turnId"
  | "attemptGeneration"
  | "conversationId"
  | "originConversationId"
>;

const RESERVED_TOOL_NAMES: ReadonlySet<string> = new Set([
  ...cloudGeneralToolNames(),
  CLOUD_AGENT_MOVE_TOOL,
]);

const CLIENT_CACHE_LIMIT = 8;
const clients = new Map<string, CloudConnectClient>();

const agentConnectClient = (
  env: Pick<Cloudflare.Env, "OWNER_GATES" | "DB">,
  turn: AgentConnectTurn,
): CloudConnectClient => {
  const key = `${turn.ownerId}\0${turn.ownerGeneration}\0${turn.turnId}\0${turn.attemptGeneration ?? 0}`;
  const cached = clients.get(key);
  if (cached) return cached;
  const ownerInternal = async (name: string, args: unknown) =>
    unwrapRpc(
      (await env.OWNER_GATES.getByName(turn.ownerId).ownerInternal({
        name,
        args,
        ownerGeneration: turn.ownerGeneration,
      })) as RpcResponse,
    );
  const conversationId = turn.conversationId ?? turn.originConversationId;
  const slack = Boolean(conversationId && isSlackConversationId(conversationId));
  const client = createCloudConnectClient(
    new CloudConnectorDirectory({
      ...(slack ? {} : { mcp: ownerMcpSource(ownerInternal) }),
      source:
        slack
          ? SLACK_CONNECTOR_SOURCE
          : {
              catalog: () => listIntegrationCatalog(env),
              actions: (args) => listIntegrationActions(env, args),
              connections: async () =>
                (await ownerInternal("integrations.connections", {})) as {
                  connections: Array<{ id: string; connected: boolean }>;
                },
              run: (args) => ownerInternal("integrations.run", args),
            },
    }),
  );
  clients.set(key, client);
  while (clients.size > CLIENT_CACHE_LIMIT) {
    clients.delete(clients.keys().next().value!);
  }
  return client;
};

const answer = (body: CloudCodeConnectResponse): Response =>
  Response.json(body, { headers: { "cache-control": "no-store" } });

export const serveAgentCodeConnectRequest = async (
  env: Pick<Cloudflare.Env, "OWNER_GATES" | "DB">,
  turn: AgentConnectTurn,
  body: Record<string, unknown>,
): Promise<Response> => {
  const method = body.method;
  const args = Array.isArray(body.args) ? body.args : [];
  if (
    typeof method !== "string" ||
    !(CLOUD_CODE_CONNECT_METHODS as readonly string[]).includes(method)
  ) {
    return answer({ ok: false, error: `connect.${String(method ?? "?")} is not a connect method.` });
  }
  const client = agentConnectClient(env, turn);
  try {
    switch (method as CloudCodeConnectMethod) {
      case "tools":
        return answer({ ok: true, value: await client.tools(RESERVED_TOOL_NAMES) });
      case "callTool": {
        const name = args[0];
        if (typeof name !== "string" || !name) {
          return answer({ ok: false, error: "A connector tool call needs the tool's name." });
        }
        return answer({
          ok: true,
          value: await client.callTool(name, args[1] as Record<string, unknown>, RESERVED_TOOL_NAMES),
        });
      }
      default:
        return answer({ ok: true, value: await invokeCloudConnect(client, method, args) });
    }
  } catch (error) {
    return answer({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
