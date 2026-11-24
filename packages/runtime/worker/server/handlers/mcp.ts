import { METHOD_NAMES } from "@stella/contracts/protocol";
import { WorkerNotInitializedError } from "../errors.js";
import { requireSession } from "../sessions.js";
import type { WorkerRpcHandlers } from "../rpc.js";

export const mcpHandlers: WorkerRpcHandlers = {
  [METHOD_NAMES.INTERNAL_WORKER_MCP_DEVICE_REQUEST]: async (params, ctx) => {
    const session = requireSession(
      ctx.sessions,
      () => new WorkerNotInitializedError(),
    );
    const request = (params ?? {}) as {
      method?: unknown;
      params?: unknown;
    };
    const cliBridgeSocketPath =
      session.runnerCell.get()?.piTools.cliBridgeSocketPath;
    const { serveRelayedMcpRequest } = await import(
      "../../../kernel/connectors/connect-service.js"
    );
    return await serveRelayedMcpRequest(
      {
        stellaAppDir: session.config.get().stellaDataDirPath,
        deviceId: session.config.deviceId,
        ...(cliBridgeSocketPath ? { cliBridgeSocketPath } : {}),
      },
      request.method,
      request.params,
    );
  },
};
