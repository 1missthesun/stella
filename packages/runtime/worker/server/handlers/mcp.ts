import { Effect } from "effect";
import { METHOD_NAMES } from "@stella/contracts/protocol";
import { WorkerNotInitializedError } from "../errors.js";
import * as WorkerSessions from "../sessions.js";
import { fromPromise, type WorkerRpcHandlers } from "../rpc.js";

const initializedSession = WorkerSessions.sessionOrFail(
  () => new WorkerNotInitializedError(),
);

export const mcpHandlers: WorkerRpcHandlers = {
  [METHOD_NAMES.INTERNAL_WORKER_MCP_DEVICE_REQUEST]: (params) =>
    Effect.flatMap(initializedSession, (session) =>
      fromPromise(async () => {
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
      }),
    ),
};
