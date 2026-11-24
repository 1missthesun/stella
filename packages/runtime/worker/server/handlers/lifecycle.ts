import {
  METHOD_NAMES,
  STELLA_RUNTIME_PROTOCOL_VERSION,
  type AgentHealth,
} from "@stella/contracts/protocol";
import { BootTimeline } from "../../../observability/boot-timing.js";
import * as ModelCatalog from "../model-catalog.js";
import { piChatsBusy, piChatsReplying } from "../pi-chats.js";
import type { WorkerRpcHandlers } from "../rpc.js";
import type { WorkerInitializationState } from "../types.js";

export const lifecycleHandlers: WorkerRpcHandlers = {
  [METHOD_NAMES.INTERNAL_WORKER_INITIALIZE]: async (params, ctx) => {
    const timeline = new BootTimeline();
    await timeline.timeAsync("catalogSubscribe", () =>
      ctx.modelCatalog.ensureSubscription(),
    );
    return await ctx.sessions.initialize(params as WorkerInitializationState, {
      timeline,
    });
  },

  [METHOD_NAMES.INTERNAL_WORKER_CONFIGURE]: (params, ctx) =>
    ctx.sessions.configure(params as Partial<WorkerInitializationState>),

  [METHOD_NAMES.INTERNAL_WORKER_HEALTH]: async (_params, ctx) => {
    const session = ctx.sessions.current();
    const runner = session?.runnerCell.get() ?? null;
    const runnerReadyError = session?.runner.readyError() ?? null;
    const health =
      runner?.agentHealthCheck() ??
      ({
        ready: false,
        ...(runnerReadyError
          ? { reason: runnerReadyError }
          : { reason: "Stella runtime is still initializing" }),
      } satisfies AgentHealth);
    return {
      health,
      protocolVersion: STELLA_RUNTIME_PROTOCOL_VERSION,
      pid: process.pid,
      deviceId: session?.config.deviceId ?? null,
      piBusy: session ? piChatsBusy(session) : false,
      piReplying: session ? await piChatsReplying(session) : false,
    };
  },

  [METHOD_NAMES.RUNTIME_HEALTH]: (_params, ctx) => {
    const session = ctx.sessions.current();
    const runner = session?.runnerCell.get() ?? null;
    return {
      ready: Boolean(runner?.agentHealthCheck().ready),
      hostPid: process.pid,
      workerPid: process.pid,
      workerRunning: true,
      workerGeneration: 0,
      deviceId: session?.config.deviceId ?? null,
      busy: session ? piChatsBusy(session) : false,
    };
  },

  [METHOD_NAMES.INTERNAL_WORKER_LIST_MODELS]: async (params, ctx) => {
    const modelRuntime = await ctx.modelCatalog.ensureSubscription();
    const forceRefresh =
      Boolean(params) &&
      typeof params === "object" &&
      (params as { forceRefresh?: unknown }).forceRefresh === true;
    return ModelCatalog.toCatalogWire(
      await modelRuntime.getSnapshotForListing({ forceRefresh }),
    );
  },
};
