import { REQUEST_BUDGET_MS } from "@stella/contracts/request-deadline";
import { existsSync } from "node:fs";
import path from "node:path";
import { METHOD_NAMES } from "@stella/contracts/protocol";
import { resolveBundledRuntimeFile } from "../../../kernel/shared/runtime-paths.js";
import type { StellaHostRunnerOptions } from "../../../kernel/runner.js";
import { RunnerUnavailableError } from "../errors.js";
import {
  invalidateSecureValueFingerprints,
  setSecureValueFingerprintSource,
} from "../../../kernel/shared/secure-value-redaction.js";
import type * as HostBus from "../host-bus.js";
import type * as RunnerModule from "../runner-module.js";
import type * as SessionConfig from "./config.js";
import type * as SessionStorage from "./storage.js";
import type * as CliBridge from "./cli-bridge.js";
import type * as RunnerCell from "./runner-cell.js";
import type { RuntimeRunner } from "../types.js";
import { HOST_CHALLENGE_TOKEN_METHOD } from "../../../host/challenge-token-method.js";
import {
  createRemoteDeviceSigner,
  HOST_DEVICE_SIGNING_METHOD,
} from "../../../host/device-signing-method.js";

const resolveDesktopCliEntrypoint = (
  stellaAppDir: string,
  packageName: string,
  entrypoint: string,
): string => {
  const resourcesPath = process.env.STELLA_APP_RESOURCES_PATH?.trim();
  if (resourcesPath) {
    const packaged = path.join(resourcesPath, packageName, "bin", entrypoint);
    if (existsSync(packaged)) {
      return packaged;
    }
  }
  return path.join(stellaAppDir, "packages", packageName, "bin", entrypoint);
};

const resolveRuntimeCliPath = (fileName: string) =>
  resolveBundledRuntimeFile(`kernel/cli/${fileName}`);

/**
 * Owns the session's runner lifecycle. The runner is built in the background
 * (dynamic import — its module subgraph is only needed once a turn runs and
 * code-splitting keeps it out of the eager worker bundle) and registered into
 * RunnerCell when ready. The session finalizer awaits any in-flight build and
 * then stops the runner, so a re-init can never strand a
 * started-but-unreferenced runner.
 */
export interface Interface {
  readonly tryCurrent: () => RuntimeRunner | null;
  readonly current: () => RuntimeRunner;
  readonly joined: () => Promise<RuntimeRunner>;
  readonly ensureInitialized: () => Promise<RuntimeRunner>;
  readonly awaitBuildSettled: () => Promise<RuntimeRunner | null>;
  readonly readyError: () => string | null;
}

export const make = (args: {
  hostBus: HostBus.Interface;
  config: SessionConfig.Interface;
  storage: SessionStorage.Interface;
  cliBridge: CliBridge.Interface;
  runnerCell: RunnerCell.Interface;
  runnerModule: RunnerModule.Interface;
  addFinalizer: (finalizer: SessionStorage.SessionFinalizer) => void;
}): Interface => {
  const {
    hostBus,
    config,
    storage,
    cliBridge,
    runnerCell,
    runnerModule,
    addFinalizer,
  } = args;
  const init = config.get();
  setSecureValueFingerprintSource(() =>
    hostBus.request(METHOD_NAMES.HOST_SECURE_VALUE_FINGERPRINTS, {}),
  );
  let deviceSignerPromise: ReturnType<typeof createRemoteDeviceSigner> | null =
    null;
  const getDeviceSigner = () => {
    const pending =
      deviceSignerPromise ??
      createRemoteDeviceSigner((input) =>
        hostBus.request(
          HOST_DEVICE_SIGNING_METHOD,
          { input },
          { retryOnDisconnect: true },
        ),
      );
    deviceSignerPromise = pending;
    void pending.catch(() => {
      if (deviceSignerPromise === pending) deviceSignerPromise = null;
    });
    return pending;
  };

  const runnerOptions: StellaHostRunnerOptions = {
    deviceId: config.deviceId,
    stellaAppDir: init.stellaAppDir,
    stellaDataDir: init.stellaDataDirPath,
    runtimeStore: storage.runtimeStore,
    appendLocalChatEvent: (eventArgs) => {
      storage.appendChatEventAndNotify(eventArgs);
    },
    askUser: (payload, signal) =>
      hostBus.requestUserAsk(
        METHOD_NAMES.HOST_ASK_USER_REQUEST,
        payload,
        signal,
      ),
    requestSecureInput: (payload, signal) =>
      hostBus
        .requestUserAsk(METHOD_NAMES.HOST_SECURE_INPUT_REQUEST, payload, signal)
        .finally(invalidateSecureValueFingerprints),
    useSecureValue: async (payload) =>
      await hostBus.request(METHOD_NAMES.HOST_SECURE_VALUE_USE, payload, {
        retryOnDisconnect: true,
      }),
    revealSecureValueForFill: async (payload) =>
      await hostBus.request(
        METHOD_NAMES.HOST_SECURE_VALUE_REVEAL_FOR_FILL,
        payload,
        { retryOnDisconnect: true },
      ),
    requestBrowserExtensionConnect: (payload, signal) =>
      hostBus.requestConnectCard(
        METHOD_NAMES.HOST_BROWSER_EXTENSION_CONNECT_REQUEST,
        payload as Record<string, unknown>,
        signal,
      ),
    requestConnectorConnection: (payload, signal) =>
      hostBus.requestConnectCard(
        METHOD_NAMES.HOST_CONNECTOR_CONNECT_REQUEST,
        payload as Record<string, unknown>,
        signal,
      ),
    requestRuntimeAuthRefresh: async (payload) =>
      await hostBus.request(METHOD_NAMES.HOST_RUNTIME_AUTH_REFRESH, payload, {
        retryOnDisconnect: true,
        timeoutMs: REQUEST_BUDGET_MS.call,
      }),
    requestChallengeToken: async () => {
      const token = await hostBus.request(
        HOST_CHALLENGE_TOKEN_METHOD,
        undefined,
        { retryOnDisconnect: true },
      );
      return typeof token === "string" && token.trim()
        ? token.trim()
        : undefined;
    },
    getDeviceSigner,
    scheduleApi: {
      listCronJobs: async () =>
        await hostBus.request(
          METHOD_NAMES.INTERNAL_SCHEDULE_LIST_CRON_JOBS,
          undefined,
          { retryOnDisconnect: true },
        ),
      listHeartbeats: async () =>
        await hostBus.request(
          METHOD_NAMES.INTERNAL_SCHEDULE_LIST_HEARTBEATS,
          undefined,
          { retryOnDisconnect: true },
        ),
      addCronJob: async (input) =>
        await hostBus.request(
          METHOD_NAMES.INTERNAL_SCHEDULE_ADD_CRON_JOB,
          input,
          { retryOnDisconnect: true },
        ),
      updateCronJob: async (jobId, patch) =>
        await hostBus.request(
          METHOD_NAMES.INTERNAL_SCHEDULE_UPDATE_CRON_JOB,
          {
            jobId,
            patch,
          },
          { retryOnDisconnect: true },
        ),
      removeCronJob: async (jobId) =>
        await hostBus.request(
          METHOD_NAMES.INTERNAL_SCHEDULE_REMOVE_CRON_JOB,
          {
            jobId,
          },
          { retryOnDisconnect: true },
        ),
      runCronJob: async (jobId) =>
        await hostBus.request(
          METHOD_NAMES.INTERNAL_SCHEDULE_RUN_CRON_JOB,
          {
            jobId,
          },
          { retryOnDisconnect: true },
        ),
      getHeartbeatConfig: async (conversationId) =>
        await hostBus.request(
          METHOD_NAMES.INTERNAL_SCHEDULE_GET_HEARTBEAT_CONFIG,
          {
            conversationId,
          },
          { retryOnDisconnect: true },
        ),
      upsertHeartbeat: async (input) =>
        await hostBus.request(
          METHOD_NAMES.INTERNAL_SCHEDULE_UPSERT_HEARTBEAT,
          input,
          { retryOnDisconnect: true },
        ),
      runHeartbeat: async (conversationId) =>
        await hostBus.request(
          METHOD_NAMES.INTERNAL_SCHEDULE_RUN_HEARTBEAT,
          {
            conversationId,
          },
          { retryOnDisconnect: true },
        ),
    },
    stellaBrowserBinPath: resolveDesktopCliEntrypoint(
      init.stellaAppDir,
      "stella-browser",
      "stella-browser.js",
    ),
    stellaOfficeBinPath: resolveDesktopCliEntrypoint(
      init.stellaAppDir,
      "stella-office",
      "stella-office.js",
    ),
    stellaComputerCliPath: resolveRuntimeCliPath("stella-computer.js"),
    stellaMediaCliPath: resolveRuntimeCliPath("stella-media.js"),
    stellaXApiCliPath: resolveRuntimeCliPath("stella-x-api.js"),
    ...(cliBridge.socketPath
      ? { cliBridgeSocketPath: cliBridge.socketPath }
      : {}),
  };

  let runnerReadyError: string | null = null;
  const buildPromise: Promise<RuntimeRunner | null> = (async () => {
    const { createStellaHostRunner } = await runnerModule.load();
    const runner = createStellaHostRunner(runnerOptions);
    // Apply the latest config (config patches that arrived during the
    // import fanned out against an empty RunnerCell, so re-apply).
    const cfg = config.get();
    runner.setBackendUrl(cfg.backendUrl ?? null);
    runner.setAuthToken(cfg.authToken);
    runner.setHasConnectedAccount(cfg.hasConnectedAccount);
    runner.setCloudSyncEnabled(cfg.cloudSyncEnabled);
    runnerCell.set(runner);
    runner.start();
    return runner;
  })().catch((error: unknown) => {
    const message =
      error instanceof Error
        ? error.message
        : String(error ?? "Runtime runner failed to start.");
    runnerReadyError = message;
    console.error("[runtime-worker] Runner failed to start:", message);
    throw error;
  });
  const settled = buildPromise.catch(() => null);

  addFinalizer(async () => {
    await settled;
    const runner = runnerCell.get();
    runnerCell.set(null);
    await runner?.stop();
  });

  const tryCurrent = () => runnerCell.get();

  const notReadyError = (): RunnerUnavailableError | Error =>
    runnerReadyError ? new Error(runnerReadyError) : new RunnerUnavailableError();

  const current = (): RuntimeRunner => {
    const runner = runnerCell.get();
    if (!runner) {
      throw notReadyError();
    }
    return runner;
  };

  const joined = async (): Promise<RuntimeRunner> => {
    await settled;
    return current();
  };

  const ensureInitialized = async (): Promise<RuntimeRunner> => {
    const runner = await joined();
    await runner.waitUntilInitialized();
    return runner;
  };

  return {
    tryCurrent,
    current,
    joined,
    ensureInitialized,
    awaitBuildSettled: () => settled,
    readyError: () => runnerReadyError,
  };
};
