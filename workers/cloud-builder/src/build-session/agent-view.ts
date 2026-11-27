import type { RpcResponse } from "@stella/contracts/backend/protocol";
import type { CloudViewResponse } from "@stella/executor-cloud/cloud-view-protocol";
import { ownerGateStub } from "../rpc-release.js";
import type { TurnRequest } from "./shared/types.js";

const reply = (body: CloudViewResponse) => Response.json(body, { headers: { "cache-control": "no-store" } });

/** A cloud task's view, put into the chat it works for (`conversations.publishView`). */
export const serveAgentViewRequest = async (
  env: Pick<Cloudflare.Env, "OWNER_GATES">,
  turn: Pick<TurnRequest, "ownerId" | "ownerGeneration" | "conversationId" | "originConversationId" | "threadId" | "description" | "agentRole">,
  body: Record<string, unknown>,
): Promise<Response> => {
  if (turn.agentRole === "orchestrator" || !turn.threadId) return reply({ ok: false, error: "Only a task posts views this way." });
  const conversationId = turn.conversationId ?? turn.originConversationId;
  if (!conversationId) return reply({ ok: false, error: "This task has no chat to show the view in." });
  const response = (await ownerGateStub(env.OWNER_GATES, turn.ownerId).ownerInternal({
    name: "conversations.publishView",
    args: {
      conversationId,
      agentId: turn.threadId,
      ...(turn.description ? { agentTitle: turn.description.slice(0, 200) } : {}),
      filePath: body.filePath,
      slug: body.slug,
      title: body.title,
      source: body.source,
      ...(body.data !== undefined ? { data: body.data } : {}),
      createdAt: body.createdAt,
    },
    ownerGeneration: turn.ownerGeneration,
  })) as RpcResponse<{ posted: boolean }>;
  if (!response.ok) return reply({ ok: false, error: response.error.message });
  return reply({ ok: true, posted: response.value.posted });
};
