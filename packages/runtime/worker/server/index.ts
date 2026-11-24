import type { WorkerPeerLike } from "../peer-broker.js";
import { forkDelayed } from "../effect-runtime.js";
import * as HostBus from "./host-bus.js";
import * as ModelCatalog from "./model-catalog.js";
import * as RunnerModule from "./runner-module.js";
import * as WorkerSessions from "./sessions.js";
import { attachWorkerRpcHandlers, type WorkerRpcContext } from "./rpc.js";
import { lifecycleHandlers } from "./handlers/lifecycle.js";
import { chatHandlers } from "./handlers/chat.js";
import { runsHandlers } from "./handlers/runs.js";
import { localChatHandlers } from "./handlers/local-chat.js";
import { voiceHandlers } from "./handlers/voice.js";
import { mcpHandlers } from "./handlers/mcp.js";
import { runnerOpsHandlers } from "./handlers/runner-ops.js";
import { piChatHandlers } from "./handlers/pi-chat.js";

export const createRuntimeWorkerServer = (
  peer: WorkerPeerLike,
): {
  interruptWork: () => Promise<void>;
  holdsWorkerAlive: () => boolean;
  prefetchRunner: () => void;
  shutdown: () => Promise<void>;
} => {
  const hostBus = HostBus.make(peer);
  const runnerModule = RunnerModule.make();
  const modelCatalog = ModelCatalog.make(hostBus);
  const sessions = WorkerSessions.make({ hostBus, modelCatalog, runnerModule });
  const ctx: WorkerRpcContext = {
    hostBus,
    modelCatalog,
    runnerModule,
    sessions,
  };

  attachWorkerRpcHandlers(peer, ctx, {
    ...lifecycleHandlers,
    ...chatHandlers,
    ...runsHandlers,
    ...localChatHandlers,
    ...voiceHandlers,
    ...mcpHandlers,
    ...runnerOpsHandlers,
    ...piChatHandlers,
  });

  const holdsWorkerAlive = (): boolean => sessions.holdsWorkerAlive();

  const interruptWork = (): Promise<void> => sessions.interruptWork();

  const prefetchRunner = (): void => {
    forkDelayed(0, () => {
      runnerModule.prefetch();
    });
  };

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    modelCatalog.dispose();
    await sessions.shutdown();
  };

  return { interruptWork, holdsWorkerAlive, prefetchRunner, shutdown };
};
