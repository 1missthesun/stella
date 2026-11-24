import {
  METHOD_NAMES,
  STELLA_RUNTIME_PROTOCOL_VERSION,
  type HostDeviceIdentity,
} from "@stella/contracts/protocol";
import { performance } from "node:perf_hooks";
import {
  BootTimeline,
  getActiveBootTimeline,
  setActiveBootTimeline,
  workerReadyTelemetry,
  type BootOutcome,
} from "../../observability/boot-timing.js";
import { getFileLogger } from "@stella/node-shared/observability/file-logger.js";
import {
  configureRuntimeTelemetry,
  recordRuntimeTelemetry,
  updateRuntimeTelemetryAuth,
} from "../../observability/runtime-telemetry.js";
import { forkDelayed } from "../effect-runtime.js";
import { ProtocolMismatchError } from "./errors.js";
import type * as HostBus from "./host-bus.js";
import type * as ModelCatalog from "./model-catalog.js";
import type * as RunnerModule from "./runner-module.js";
import {
  closePiChats,
  quitPiChats,
  trackTaskShells,
  piChatsBusy,
  piBackgroundExitTarget,
  piDeliverReport,
  piAgentHistory,
  reconcileComputerAgents,
  resumePiChats,
} from "./pi-chats.js";
import * as SessionConfig from "./session/config.js";
import * as SessionStorage from "./session/storage.js";
import * as CredentialBrokers from "./session/brokers.js";
import * as CliBridge from "./session/cli-bridge.js";
import * as RunnerCell from "./session/runner-cell.js";
import * as RunnerHandle from "./session/runner.js";
import * as AgentRuns from "./session/agent-runs.js";
import type { WorkerInitializationState } from "./types.js";

const BOOT_PROBE_INTERVAL_MS = 25;
const BOOT_PROBE_MAX_MS = 15 * 60_000;

const startBootStallProbe = (timeline: BootTimeline): void => {
  let last = performance.now();
  const tick = () => {
    const now = performance.now();
    timeline.noteEventLoopStall(now - last - BOOT_PROBE_INTERVAL_MS);
    last = now;
    if (timeline.isFinished || timeline.elapsed() > BOOT_PROBE_MAX_MS) {
      return;
    }
    forkDelayed(BOOT_PROBE_INTERVAL_MS, tick);
  };
  forkDelayed(BOOT_PROBE_INTERVAL_MS, tick);
};

const reportBoot = (
  timeline: BootTimeline,
  outcome: BootOutcome,
  fields?: Record<string, string | number | boolean>,
): void => {
  if (timeline.isFinished) return;
  for (const [name, value] of Object.entries(fields ?? {})) {
    timeline.set(name, value);
  }
  if (getActiveBootTimeline() === timeline) setActiveBootTimeline(null);
  const timing = timeline.finish(outcome);
  if (!timing) return;
  const logger = getFileLogger();
  if (logger) {
    logger.process("worker.ready.timing", timing);
  } else {
    console.error(
      `[stella:boot] worker.ready.timing ${JSON.stringify(timing)}`,
    );
  }
  recordRuntimeTelemetry(workerReadyTelemetry(timing));
};

const makeAsyncMutex = () => {
  let tail: Promise<void> = Promise.resolve();
  return async <A>(fn: () => Promise<A>): Promise<A> => {
    const prev = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  };
};

type SessionKey = {
  stellaAppDir: string;
  stellaDataDirPath: string;
  stellaWorkspacePath: string;
};

export type OpenSession = {
  readonly key: SessionKey;
  readonly close: (succeeded?: boolean) => Promise<void>;
  readonly config: SessionConfig.Interface;
  readonly storage: SessionStorage.Interface;
  readonly brokers: CredentialBrokers.Interface;
  readonly runnerCell: RunnerCell.Interface;
  readonly runner: RunnerHandle.Interface;
  readonly agentRuns: AgentRuns.Interface;
};

export type InitializeResult = {
  protocolVersion: string;
  pid: number;
  deviceId: string | null;
};

export interface Interface {
  readonly initialize: (
    init: WorkerInitializationState,
    options?: { readonly timeline?: BootTimeline },
  ) => Promise<InitializeResult>;
  readonly configure: (
    patch: Partial<WorkerInitializationState>,
  ) => Promise<{ ok: true; queued?: true }>;
  readonly shutdown: () => Promise<void>;
  readonly current: () => OpenSession | null;
  readonly interruptWork: () => Promise<void>;
  readonly holdsWorkerAlive: () => boolean;
}

export const requireSession = <E extends Error>(
  sessions: Interface,
  onMissing: () => E,
): OpenSession => {
  const session = sessions.current();
  if (!session) {
    throw onMissing();
  }
  return session;
};

type RunnerGate = {
  readonly published: Promise<void>;
  readonly open: () => void;
  readonly fail: (error: Error) => void;
};

const makeRunnerGate = (): RunnerGate => {
  let open: () => void = () => undefined;
  let fail: (error: Error) => void = () => undefined;
  const published = new Promise<void>((resolve, reject) => {
    open = resolve;
    fail = reject;
  });
  published.catch(() => undefined);
  return { published, open, fail };
};

const sessionRunnerModule = (
  runnerModule: RunnerModule.Interface,
  timeline: BootTimeline,
  gate: RunnerGate,
): RunnerModule.Interface => ({
  prefetch: runnerModule.prefetch,
  load: async () => {
    await gate.published;
    const waitStartedAt = performance.now();
    const loaded = await runnerModule.load();
    timeline.step("runnerModuleWait", performance.now() - waitStartedAt);
    return {
      ...loaded,
      createStellaHostRunner: (
        ...args: Parameters<typeof loaded.createStellaHostRunner>
      ) =>
        timeline.time("runnerConstruct", () =>
          loaded.createStellaHostRunner(...args),
        ),
    };
  },
});

export const make = (deps: {
  hostBus: HostBus.Interface;
  modelCatalog: ModelCatalog.Interface;
  runnerModule: RunnerModule.Interface;
}): Interface => {
  const { hostBus, modelCatalog: catalog, runnerModule } = deps;
  const withSessionLock = makeAsyncMutex();

  let currentSession: OpenSession | null = null;
  let pendingConfigPatch: Partial<WorkerInitializationState> | null = null;

  const applyConfigPatch = (
    session: OpenSession,
    patch: Partial<WorkerInitializationState>,
  ) => {
    session.config.patch(patch);
    const runner = session.runnerCell.get();
    if (patch.backendUrl !== undefined) {
      runner?.setBackendUrl(patch.backendUrl);
    }
    if (patch.authToken !== undefined) {
      runner?.setAuthToken(patch.authToken);
      updateRuntimeTelemetryAuth(patch.authToken);
      if (patch.authToken && runner) {
        void reconcileComputerAgents(session, hostBus).catch((error) => {
          console.warn(
            "[runtime-worker] computer agent reconcile failed:",
            (error as Error).message,
          );
        });
      }
    }
    if (patch.hasConnectedAccount !== undefined) {
      runner?.setHasConnectedAccount(patch.hasConnectedAccount);
    }
    if (patch.cloudSyncEnabled !== undefined) {
      runner?.setCloudSyncEnabled(patch.cloudSyncEnabled);
    }
    if (patch.authToken !== undefined || patch.backendUrl !== undefined) {
      catalog.scheduleWarm(() => session.runnerCell.get());
    }
  };

  const closeCurrent = async (): Promise<void> => {
    const session = currentSession;
    currentSession = null;
    if (!session) return;
    await closePiChats(session).catch((error) => {
      console.warn(
        "[runtime-worker] pi chat close failed:",
        (error as Error).message,
      );
    });
    await session.close(true);
  };

  const hasSessionWork = () => {
    const session = currentSession;
    const requestPinned = hostBus.activeRequestHandlerCount() > 0;
    return Boolean((session ? piChatsBusy(session) : false) || requestPinned);
  };

  const initialize: Interface["initialize"] = (init, options) => {
    const timeline = options?.timeline ?? new BootTimeline();
    const lockRequestedAt = performance.now();
    return withSessionLock(async () => {
      timeline.step("sessionLockWait", performance.now() - lockRequestedAt);
      if (
        init.protocolVersion &&
        init.protocolVersion !== STELLA_RUNTIME_PROTOCOL_VERSION
      ) {
        throw new ProtocolMismatchError({
          hostVersion: init.protocolVersion,
        });
      }
      const existing = currentSession;
      const sameRuntimeRoot =
        existing?.key.stellaAppDir === init.stellaAppDir &&
        existing?.key.stellaDataDirPath === init.stellaDataDirPath &&
        existing?.key.stellaWorkspacePath === init.stellaWorkspacePath;
      if (existing && sameRuntimeRoot && existing.runnerCell.get()) {
        applyConfigPatch(existing, init);
        return {
          protocolVersion: STELLA_RUNTIME_PROTOCOL_VERSION,
          pid: process.pid,
          deviceId: existing.config.deviceId,
        };
      }
      setActiveBootTimeline(timeline);
      startBootStallProbe(timeline);
      let bootStep = "closePrevious";
      const closeStartedAt = performance.now();
      try {
        await closeCurrent();
      } finally {
        timeline.step("closePrevious", performance.now() - closeStartedAt);
      }

      bootStep = "deviceIdentity";
      let deviceIdentity: HostDeviceIdentity;
      try {
        deviceIdentity = await timeline.timeAsync("deviceIdentity", () =>
          hostBus.request<HostDeviceIdentity>(
            METHOD_NAMES.HOST_DEVICE_IDENTITY_GET,
          ),
        );
      } catch (error) {
        reportBoot(timeline, "failure", { failedStep: bootStep });
        throw error;
      }

      bootStep = "sessionBuild";
      const buildStartedAt = performance.now();
      const runnerGate = makeRunnerGate();
      const finalizers: SessionStorage.SessionFinalizer[] = [];
      let sessionClosed = false;
      const closeSession = async (succeeded = true) => {
        if (sessionClosed) return;
        sessionClosed = true;
        for (let i = finalizers.length - 1; i >= 0; i -= 1) {
          try {
            await finalizers[i]?.(succeeded);
          } catch {
          }
        }
      };
      const addFinalizer = (finalizer: SessionStorage.SessionFinalizer) => {
        finalizers.push(finalizer);
      };

      const timedSync = <A>(name: string, build: () => A): A => {
        const startedAt = performance.now();
        const result = build();
        timeline.step(name, performance.now() - startedAt);
        return result;
      };
      const timedAsync = async <A>(
        name: string,
        build: () => Promise<A>,
      ): Promise<A> => {
        const startedAt = performance.now();
        const result = await build();
        timeline.step(name, performance.now() - startedAt);
        return result;
      };

      let session: OpenSession;
      try {
        const config = SessionConfig.make(init, deviceIdentity.deviceId);
        const runnerCell = RunnerCell.make();
        const storage = timedSync("layerStorage", () =>
          SessionStorage.make({ hostBus, config, addFinalizer }),
        );
        const brokers = await timedAsync("layerBrokers", () =>
          CredentialBrokers.make({ hostBus, addFinalizer }),
        );
        const cliBridge = await timedAsync("layerCliBridge", () =>
          CliBridge.make({ hostBus, config, runnerCell, addFinalizer }),
        );
        const runner = timedSync("layerRunnerHandle", () =>
          RunnerHandle.make({
            hostBus,
            config,
            storage,
            cliBridge,
            runnerCell,
            runnerModule: sessionRunnerModule(
              runnerModule,
              timeline,
              runnerGate,
            ),
            addFinalizer,
          }),
        );
        addFinalizer((succeeded) => {
          if (succeeded) {
            runnerGate.open();
          } else {
            runnerGate.fail(
              new Error(
                "Runtime session initialization did not complete; runner not started.",
              ),
            );
          }
        });
        const agentRuns = timedSync("layerAgentRuns", () =>
          AgentRuns.make({ hostBus, config }),
        );

        timeline.step("sessionBuild", performance.now() - buildStartedAt);

        session = {
          key: {
            stellaAppDir: init.stellaAppDir,
            stellaDataDirPath: init.stellaDataDirPath,
            stellaWorkspacePath: init.stellaWorkspacePath,
          },
          close: closeSession,
          config,
          storage,
          brokers,
          runnerCell,
          runner,
          agentRuns,
        };
      } catch (error) {
        await closeSession(false);
        reportBoot(timeline, "failure", { failedStep: bootStep });
        throw error;
      }

      currentSession = session;
      forkDelayed(0, runnerGate.open);
      session.storage.maintenance.start({
        isIdle: () => currentSession === session && !hasSessionWork(),
        attachedClientCount: () => hostBus.attachedClientCount(),
      });
      configureRuntimeTelemetry({
        stellaDataDirPath: init.stellaDataDirPath,
        authToken: init.authToken,
        ...(typeof init.isDev === "boolean" ? { isDev: init.isDev } : {}),
        ...(init.clientVersion ? { release: init.clientVersion } : {}),
      });

      const initializedAtMs = timeline.elapsed();
      forkDelayed(0, () => {
        void (async () => {
          const startupStartedAt = Date.now();
          let runnerOutcome: BootOutcome = "success";
          await Promise.allSettled([
            (async () => {
              const builtRunner = await session.runner.awaitBuildSettled();
              if (!builtRunner) runnerOutcome = "failure";
              builtRunner?.setPiReportDelivery((report) =>
                piDeliverReport(session, hostBus, report),
              );
              builtRunner?.setAgentHistoryQuery((request) =>
                piAgentHistory(session, hostBus, request),
              );
              builtRunner?.setBackgroundExitTarget(
                piBackgroundExitTarget(session, hostBus),
              );
              if (builtRunner) trackTaskShells(session, builtRunner);
              if (builtRunner && currentSession === session) {
                catalog.scheduleWarm(() => session.runnerCell.get());
              }
              await builtRunner?.waitUntilInitialized().catch((error) => {
                runnerOutcome = "failure";
                console.warn(
                  "[runtime-worker] Runner initialization finished with an error:",
                  (error as Error).message,
                );
              });
              if (builtRunner && currentSession === session) {
                void resumePiChats(session, hostBus)
                  .catch((error) => {
                    console.warn(
                      "[runtime-worker] pi chat resume failed:",
                      (error as Error).message,
                    );
                  })
                  .then(() => reconcileComputerAgents(session, hostBus))
                  .catch((error) => {
                    console.warn(
                      "[runtime-worker] computer agent reconcile failed:",
                      (error as Error).message,
                    );
                  });
              }
            })(),
          ]);
          getFileLogger()?.process("startup.post-ready-complete", {
            ms: Date.now() - startupStartedAt,
          });
          reportBoot(timeline, runnerOutcome, {
            readyAfterInitializeMs:
              Math.round((timeline.elapsed() - initializedAtMs) * 10) / 10,
          });
        })();
      });

      if (pendingConfigPatch) {
        applyConfigPatch(session, pendingConfigPatch);
        pendingConfigPatch = null;
      }
      catalog.scheduleWarm(() => session.runnerCell.get());

      timeline.mark("initialized");
      return {
        protocolVersion: STELLA_RUNTIME_PROTOCOL_VERSION,
        pid: process.pid,
        deviceId: deviceIdentity.deviceId,
      };
    });
  };

  const configure: Interface["configure"] = async (patch) => {
    const session = currentSession;
    if (!session) {
      pendingConfigPatch = { ...pendingConfigPatch, ...patch };
      return { ok: true as const, queued: true as const };
    }
    applyConfigPatch(session, patch);
    if (patch.localLlmCredentialsUpdatedAt !== undefined) {
      await session.brokers.refreshLocalLlmCredentialAccess();
    }
    return { ok: true as const };
  };

  const holdsWorkerAlive = () =>
    currentSession?.storage.maintenance.holdsWorkerAlive() ?? false;

  const interruptWork = async (): Promise<void> => {
    const session = currentSession;
    if (!session) return;
    await quitPiChats(session, () =>
      session.runnerCell.get()?.killAllShells(),
    ).catch(() => undefined);
  };

  return {
    initialize,
    configure,
    shutdown: () => withSessionLock(closeCurrent),
    current: () => currentSession,
    interruptWork,
    holdsWorkerAlive,
  };
};
