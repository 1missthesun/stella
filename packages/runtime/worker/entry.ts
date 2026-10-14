import { Cause, Effect, Exit, Scope } from "effect";
import { loadModelRegistry } from "@stella/contracts/model-registry";
import "../kernel/shared/http-proxy.js";
import path from "node:path";
import {
  getFileLogger,
  initFileLogger,
  installWorkerCrashHandling,
} from "../observability/file-logger.js";
import {
  configureAgentProcessRegistry,
  describeAgentProcesses,
  killAgentProcessesSync,
  reapAgentProcesses,
  takeOrphanedAgentProcesses,
} from "../kernel/shared/agent-process-registry.js";
import { closeRuntimeTelemetry } from "../observability/runtime-telemetry.js";
import type { JsonRpcPeer } from "@stella/contracts/protocol/rpc-peer";
import { STELLA_RUNTIME_CLIENT_PROTOCOL_VERSION } from "@stella/contracts/protocol/runtime-client";
import { RuntimeClientServer } from "../host/client-server.js";
import { workerRuntime } from "./effect-runtime.js";
import {
  WorkerLifecycleServer,
} from "./lifecycle-server.js";
import { WorkerPeerBroker } from "./peer-broker.js";
import { createRuntimeWorkerServer } from "./server/index.js";
import {
  computeRuntimeBuildStamp,
  RUNTIME_BUILD_STAMP_UNAVAILABLE,
} from "./runtime-build-stamp.js";
import {
  createRuntimeServerIdentity,
  type RuntimeServerIdentity,
} from "./server-identity.js";
import {
  parseWorkerListenUrl,
  startWorkerTransport,
} from "./transport.js";

type ParsedArgs = {
  listenUrl: string;
  stellaAppDir: string | null;
  idleShutdownMs: number | null;
};

const parseEntryArgs = (argv: string[]): ParsedArgs => {
  let listenUrl = "stdio://";
  let stellaAppDir: string | null = null;
  let idleShutdownMs: number | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === "--listen" && i + 1 < argv.length) {
      listenUrl = argv[i + 1] ?? listenUrl;
      i += 1;
    } else if (arg.startsWith("--listen=")) {
      listenUrl = arg.slice("--listen=".length);
    } else if (arg === "--stella-root" && i + 1 < argv.length) {
      stellaAppDir = argv[i + 1] ?? null;
      i += 1;
    } else if (arg.startsWith("--stella-root=")) {
      stellaAppDir = arg.slice("--stella-root=".length);
    } else if (arg === "--idle-shutdown-ms" && i + 1 < argv.length) {
      const next = Number.parseInt(argv[i + 1] ?? "", 10);
      if (Number.isFinite(next) && next > 0) idleShutdownMs = next;
      i += 1;
    } else if (arg.startsWith("--idle-shutdown-ms=")) {
      const next = Number.parseInt(arg.slice("--idle-shutdown-ms=".length), 10);
      if (Number.isFinite(next) && next > 0) idleShutdownMs = next;
    }
  }
  return { listenUrl, stellaAppDir, idleShutdownMs };
};

const SHUTDOWN_DEADLINE_MS = 5_000;

const main = async () => {
  await loadModelRegistry();
  const cliArgs = parseEntryArgs(process.argv.slice(2));
  const transportResult = parseWorkerListenUrl(cliArgs.listenUrl);
  if (!transportResult.ok) {
    console.error(`[runtime-worker] ${transportResult.error}`);
    process.exit(2);
  }
  const transport = transportResult.transport;

  const rootScope = Scope.makeUnsafe();
  let rootScopeClosed = false;
  const closeRootScope = async () => {
    if (rootScopeClosed) return;
    rootScopeClosed = true;
    await workerRuntime
      .runPromise(Scope.close(rootScope, Exit.void))
      .catch(() => undefined);
    await closeRuntimeTelemetry();
  };
  const acquire = async <A>(
    effect: Effect.Effect<A, unknown, Scope.Scope>,
  ): Promise<A> => {
    const exit = await workerRuntime.runPromiseExit(
      Scope.provide(effect, rootScope),
    );
    if (Exit.isSuccess(exit)) return exit.value;
    throw Cause.squash(exit.cause);
  };

  const broker = await acquire(
    Effect.acquireRelease(
      Effect.sync(() => new WorkerPeerBroker()),
      (acquired) =>
        Effect.sync(() => {
          try {
            acquired.dispose();
          } catch {
            // Best effort during process shutdown.
          }
        }),
    ),
  );
  const runtimeServer = await acquire(
    Effect.acquireRelease(
      Effect.sync(() => createRuntimeWorkerServer(broker)),
      (acquired) =>
        Effect.promise(() => acquired.shutdown().catch(() => undefined)),
    ),
  );
  let shuttingDown = false;

  let lifecycle: WorkerLifecycleServer | null = null;
  let serverIdentity: RuntimeServerIdentity | undefined;
  let detachedMode = false;
  if (transport.kind !== "stdio") {
    if (!cliArgs.stellaAppDir) {
      console.error(
        "[runtime-worker] detached --listen requires --stella-root <path>",
      );
      process.exit(2);
    }
    detachedMode = true;
    const logger = initFileLogger(cliArgs.stellaAppDir, "worker");
    installWorkerCrashHandling(logger, {
      context: () => ({ agentProcesses: describeAgentProcesses() }),
      beforeFatalExit: () => {
        killAgentProcessesSync();
      },
    });
    process.on("exit", () => {
      killAgentProcessesSync();
    });
    logger.process("worker.starting", { pid: process.pid });
    const runtimeBuildStamp = computeRuntimeBuildStamp(process.argv[1] ?? "");
    lifecycle = new WorkerLifecycleServer({
      stellaAppDir: cliArgs.stellaAppDir,
      ...(runtimeBuildStamp !== RUNTIME_BUILD_STAMP_UNAVAILABLE
        ? { runtimeBuildStamp }
        : {}),
      ...(cliArgs.idleShutdownMs
        ? { idleShutdownMs: cliArgs.idleShutdownMs }
        : {}),
      interruptWork: () => runtimeServer.interruptWork(),
      shouldKeepAlive: () => runtimeServer.holdsWorkerAlive(),
      onShutdown: async (reason) => {
        const startedAt = Date.now();
        const closed = await workerRuntime.runPromise(
          Effect.raceFirst(
            Effect.promise(() => closeRootScope()).pipe(Effect.as(true)),
            Effect.sleep(SHUTDOWN_DEADLINE_MS).pipe(Effect.as(false)),
          ),
        );
        logger.process(closed ? "worker.shutdown-closed" : "worker.shutdown-deadline", {
          reason,
          elapsedMs: Date.now() - startedAt,
        });
        if (reason === "idle" || reason === "restart") {
          setImmediate(() => process.exit(0));
        }
      },
    });
    try {
      await lifecycle.start();
    } catch (error) {
      console.error(
        `[runtime-worker] Failed to acquire lifecycle lock: ${(error as Error).message}`,
      );
      process.exit(3);
    }
    const agentRegistryFile = path.join(
      lifecycle.paths.rootDir,
      "agent-processes.json",
    );
    const orphanedAgents = takeOrphanedAgentProcesses(agentRegistryFile);
    if (orphanedAgents.length > 0) {
      logger.warn("worker.orphaned-agents-found", {
        agents: orphanedAgents.map(({ pid, label, command, startedAt }) => ({
          pid,
          label,
          command,
          startedAt,
        })),
      });
      void reapAgentProcesses(orphanedAgents).then(() => {
        logger.process("worker.orphaned-agents-reaped", {
          pids: orphanedAgents.map(({ pid }) => pid),
        });
      });
    }
    configureAgentProcessRegistry(agentRegistryFile);
    serverIdentity = createRuntimeServerIdentity({
      rootHash: lifecycle.paths.rootHash,
      buildStamp:
        runtimeBuildStamp !== RUNTIME_BUILD_STAMP_UNAVAILABLE
          ? runtimeBuildStamp
          : null,
      protocolVersion: STELLA_RUNTIME_CLIENT_PROTOCOL_VERSION,
    });
    logger.process("worker.identity", {
      serverId: serverIdentity.serverId,
      rootHash: serverIdentity.rootHash,
      buildStamp: serverIdentity.buildStamp,
      launchEnv: serverIdentity.launchEnv,
    });
  }

  let attachPeer = (peer: JsonRpcPeer) => broker.attach(peer);
  let protocolVersion: string | undefined;
  if (lifecycle) {
    const runtimeLifecycle = lifecycle;
    const { StellaRuntimeHost } = await import("../host/index.js");
    const clientServer = await acquire(
      Effect.acquireRelease(
        Effect.sync(
          () =>
            new RuntimeClientServer({
              ...(serverIdentity ? { identity: serverIdentity } : {}),
              createHost: (params, hostHandlers) =>
                new StellaRuntimeHost({
                  initializeParams: params.initializeParams,
                  hostHandlers,
                  workerMode: "inproc",
                  workerEntryPath: process.argv[1],
                  ...(params.disableLocalScheduler
                    ? { disableLocalScheduler: true }
                    : {}),
                  inprocWorker: {
                    attach: (peer: JsonRpcPeer) => {
                      broker.attach(peer);
                      return () => broker.detach(peer);
                    },
                    restartProcess: () => {
                      setImmediate(() => {
                        void runtimeLifecycle.shutdown("restart");
                      });
                    },
                  },
                }),
              onShutdownRequested: () => {
                void runtimeLifecycle.shutdown("restart");
              },
              onQuitRequested: () => runtimeLifecycle.requestQuit(),
            }),
        ),
        (acquired) => Effect.promise(() => acquired.close()),
      ),
    );
    attachPeer = (peer) => {
      runtimeLifecycle.noteClientConnected();
      peer.on("closed", () => runtimeLifecycle.noteClientDisconnected());
      clientServer.attach(peer);
    };
    protocolVersion = STELLA_RUNTIME_CLIENT_PROTOCOL_VERSION;
  }

  const server = await acquire(
    Effect.acquireRelease(
      Effect.tryPromise({
        try: () =>
          startWorkerTransport({
            transport,
            attach: attachPeer,
            ...(protocolVersion ? { protocolVersion } : {}),
            ...(serverIdentity ? { identity: serverIdentity } : {}),
            onError: (error) => {
              console.error("[runtime-worker] transport error:", error);
            },
          }),
        catch: (error) => error,
      }),
      (acquired) =>
        Effect.promise(() => acquired.close().catch(() => undefined)),
    ),
  );

  runtimeServer.prefetchRunner();

  if (detachedMode) {
    console.error(
      `[runtime-worker] listening on ${server.describe()} (pid=${process.pid})`,
    );
  }

  const shutdown = async (_signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (lifecycle) {
      await lifecycle.shutdown("signal");
    } else {
      await closeRootScope();
    }
    process.exit(0);
  };

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGHUP", () => void shutdown("SIGHUP"));
};

void main().catch((error) => {
  console.error("[runtime-worker] fatal:", error);
  getFileLogger()?.crash("worker.fatal", error);
  process.exit(1);
});

export {
  WorkerPeerBroker,
  parseWorkerListenUrl,
  startWorkerTransport,
};
