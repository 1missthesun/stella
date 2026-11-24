import type { WorkerPeerLike } from "../peer-broker.js";
import type * as HostBus from "./host-bus.js";
import type * as ModelCatalog from "./model-catalog.js";
import type * as RunnerModule from "./runner-module.js";
import type * as WorkerSessions from "./sessions.js";

export type WorkerRpcContext = {
  readonly hostBus: HostBus.Interface;
  readonly modelCatalog: ModelCatalog.Interface;
  readonly runnerModule: RunnerModule.Interface;
  readonly sessions: WorkerSessions.Interface;
};

export type WorkerRpcHandler = (
  params: unknown,
  ctx: WorkerRpcContext,
) => unknown | Promise<unknown>;

export type WorkerRpcHandlers = Record<string, WorkerRpcHandler>;

export const attachWorkerRpcHandlers = (
  peer: WorkerPeerLike,
  ctx: WorkerRpcContext,
  handlers: WorkerRpcHandlers,
): void => {
  for (const [method, handler] of Object.entries(handlers)) {
    peer.registerRequestHandler(method, async (params) => handler(params, ctx));
  }
};
