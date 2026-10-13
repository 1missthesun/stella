import type { ReplConnectClient } from "@stella/runtime/kernel/connectors/connect-service.js";
import type { ConnectorToolEntry } from "@stella/runtime/kernel/connectors/connector-tools.js";
import {
  CLOUD_CODE_CONNECT_PATH,
  type CloudCodeConnectMethod,
  type CloudCodeConnectRequest,
  type CloudCodeConnectResponse,
} from "./cloud-code-connect-protocol.js";

type BrokerPost = (route: string, body: unknown) => Promise<Response>;

const answerOf = async (response: Response): Promise<unknown> => {
  const body = (await response
    .json()
    .catch(() => null)) as CloudCodeConnectResponse | null;
  if (!response.ok || !body || typeof body.ok !== "boolean") {
    throw new Error(`connect is unavailable right now (${response.status}).`);
  }
  if (!body.ok) throw new Error(body.error);
  return body.value;
};

export const createBrokerConnectClient = (args: {
  post: BrokerPost;
  turnId: string;
}): ReplConnectClient => {
  const call = async (method: CloudCodeConnectMethod, callArgs: unknown[]) =>
    await answerOf(
      await args.post(CLOUD_CODE_CONNECT_PATH, {
        turnId: args.turnId,
        method,
        args: callArgs,
      } satisfies CloudCodeConnectRequest),
    );
  return {
    discover: (query) => call("discover", [query]),
    connectors: () => call("connectors", []),
    addMcp: (options) => call("addMcp", [options]),
    remove: (id) => call("remove", [id]),
    tools: async () => {
      const value = await call("tools", []);
      return Array.isArray(value) ? (value as ConnectorToolEntry[]) : [];
    },
    callTool: (name, input) => call("callTool", [name, input]),
  };
};
