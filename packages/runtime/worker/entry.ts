import "@stella/node-shared/shared/http-proxy.js";
import path from "node:path";
import {
  getFileLogger,
  initFileLogger,
  installWorkerCrashHandling,
} from "@stella/node-shared/observability/file-logger.js";
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
import { sleepMs } from "./effect-runtime.js";
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
import { ensureRuntimeAuthKey } from "./runtime-auth.js";
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
  const cliArgs = parseEntryArgs(process.argv.slice(2));
  const transportResult = parseWorkerListenUrl(cliArgs.listenUrl);
  if (!transportResult.ok) {
    console.error(`[runtime-worker] ${transportResult.error}`);
    process.exit(2);
  }
  const transport = transportResult.transport;

  const finalizers: Array<() => Promise<void> | void> = [];
  let rootScopeClosed = false;
  const closeRootScope = async () => {
    if (rootScopeClosed) return;
    rootScopeClosed = true;
    for (let i = finalizers.length - 1; i >= 0; i -= 1) {
      try {
        await finalizers[i]?.();
      } catch {
      }
    }
    await closeRuntimeTelemetry();
  };

  const broker = new WorkerPeerBroker();
  finalizers.push(() => {
    try {
      broker.dispose();
    } catch {
    }
  });
  const runtimeServer = createRuntimeWorkerServer(broker);
  finalizers.push(async () => {
    await runtimeServer.shutdown().catch(() => undefined);
  });
  let shuttingDown = false;

  let lifecycle: WorkerLifecycleServer | null = null;
  let serverIdentity: RuntimeServerIdentity | undefined;
  let authKey: Buffer | undefined;
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
        const closed = await Promise.race([
          closeRootScope().then(() => true),
          sleepMs(SHUTDOWN_DEADLINE_MS).then(() => false),
        ]);
        logger.process(closed ? "worker.shutdown-closed" : "worker.shutdown-deadline", {
          reason,
          elapsedMs: Date.now() - startedAt,
        });
        if (reason === "idle" || reason === "quit" || reason === "restart") {
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
    authKey = await ensureRuntimeAuthKey(lifecycle.paths.authKeyFile);
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
    const [{ StellaRuntimeHost }, { RuntimeClientServer }] = await Promise.all([
      import("../host/index.js"),
      import("../host/client-server.js"),
    ]);
    const clientServer = new RuntimeClientServer({
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
      onRelaunching: () => runtimeLifecycle.noteRelaunching(),
    });
    finalizers.push(() => clientServer.close());
    attachPeer = (peer) => {
      runtimeLifecycle.noteClientConnected();
      peer.on("closed", () => runtimeLifecycle.noteClientDisconnected());
      clientServer.attach(peer);
    };
    protocolVersion = STELLA_RUNTIME_CLIENT_PROTOCOL_VERSION;
  }

  const server = await startWorkerTransport({
    transport,
    attach: attachPeer,
    ...(protocolVersion ? { protocolVersion } : {}),
    ...(serverIdentity ? { identity: serverIdentity } : {}),
    ...(authKey ? { authKey } : {}),
    onError: (error) => {
      console.error("[runtime-worker] transport error:", error);
    },
  });
  finalizers.push(async () => {
    await server.close().catch(() => undefined);
  });

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
