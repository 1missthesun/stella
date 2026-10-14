import { EventEmitter } from "node:events";
import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { hostname } from "node:os";
import { AGENT_STOP_WIRE_REASON } from "@stella/contracts/agent-status";
import { readAgentLineage } from "@stella/contracts/agent-depth";
import { DISPATCH_PAYLOAD_MAX_BYTES } from "@stella/contracts/turn-plane/placement";
import { canonicalDispatchPayloadJson } from "@stella/contracts/turn-plane/pairing-proof";
import { PlacedChatTooLargeError, placedChatContext } from "./placed-chat-context.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BackendClient,
  BackendRequestError,
  backendTokenExpiryMs,
} from "@stella/contracts/backend/client";
import { resolveBundledRuntimeFile } from "../kernel/shared/runtime-paths.js";
import { getFileLogger } from "../observability/file-logger.js";
import { LocalSchedulerService } from "../kernel/local-scheduler-service.js";
import {
  createCloudSchedules,
  isCloudScheduleId,
  isCloudSchedulePayload,
} from "./cloud-schedules.js";
import { createScheduleScriptAuthEnv } from "../kernel/shared/schedule-scripts.js";
import {
  createExecutionPlacementBridge,
  PlacementRouteError,
  placementLocalAgentThreadId,
  placementLocalChatRunId,
} from "./execution-placement-bridge.js";
import { isExecutionPlacementEligible } from "./execution-placement-eligibility.js";
import {
  ConversationPlacements,
  isCloudHandedOff,
  isDispatchEnded,
  type SubmittingPlacement,
} from "./placed-dispatch.js";
import { AGENT_RUN_RPC_OPTIONS } from "./agent-run-request.js";
import {
  placementAttachmentPaths,
  resolvePlacementAttachments,
} from "./placement-attachments.js";
import {
  getDesktopDatabasePath,
  initializeDesktopDatabase,
} from "../kernel/storage/database-init.js";
import {
  METHOD_NAMES,
  NOTIFICATION_NAMES,
  STELLA_RUNTIME_PROTOCOL_VERSION,
} from "@stella/contracts/protocol";
import {
  DEVICE_REQUEST_CLOUD_ASKER,
  isDeviceClaudeLoginRequestMethod,
} from "@stella/contracts/turn-plane/device-requests";
import { createRuntimeUnavailableError } from "@stella/contracts/protocol/rpc-peer";
import { RuntimeWorkerLifecycleController } from "./worker-lifecycle.js";
import { buildStdioConnectionFactory } from "./stdio-connection.js";
import { buildInprocConnectionFactory } from "./inproc-connection.js";
import { resolveRuntimePaths } from "../worker/runtime-paths.js";
import { Cause, Effect, Exit, Fiber } from "effect";
import { forkDelayed, hostRuntime, type HostTimerHandle } from "./effect-runtime.js";
import {
  clearPendingWorkerRestartFlag,
  evaluateWorkerStaleness,
  persistPendingWorkerRestartFlag,
  quiescencePollEffect,
} from "./staleness.js";
import { HOST_CHALLENGE_TOKEN_METHOD } from "./challenge-token-method.js";
import {
  HOST_DEVICE_SIGNING_METHOD,
  MAX_DEVICE_SIGNING_INPUT_LENGTH,
} from "./device-signing-method.js";
import { isDelegatedDeviceSigningInput } from "@stella/contracts/gateway/dpop";
import { piBrainHandoffPrompt } from "@stella/contracts/turn-plane/pi-brain";
import type { BrowserType } from "@stella/contracts";
import type {
  HostDeviceIdentity,
  RuntimeAttachmentRef,
  RuntimeAutomationTurnResult,
  RuntimeChatPayload,
  RuntimeConfigureParams,
} from "@stella/contracts/protocol";
import type { JsonRpcPeer } from "@stella/contracts/protocol/rpc-peer";
import type { RuntimeClientAttachParams } from "@stella/contracts/protocol/runtime-client";
import type {
  LocalCronJobCreateInput,
  LocalCronJobUpdatePatch,
  LocalHeartbeatUpsertInput,
} from "@stella/contracts/scheduling";
import type {
  AgentMessageDeviceOutcome,
  AgentStopDeviceOutcome,
  DispatchPayload,
  DispatchSummary,
} from "@stella/contracts/turn-plane/placement";
import type { SqliteDatabase } from "../kernel/storage/shared.js";
import type { CloudSchedules } from "./cloud-schedules.js";
import type { RuntimeHostHandler } from "./client-protocol.js";
import type {
  DispatchWatchHandle,
  ExecutionPlacementAvailability,
  ExecutionPlacementBridge,
} from "./execution-placement-bridge.js";
import type {
  PiChatBrainResult,
  PiChatRequest,
  PiChatSend,
} from "@stella/contracts/pi-chat";
import type { InprocWorkerAttach } from "./inproc-connection.js";
import type { PendingWorkerRestartRecord } from "./staleness.js";
import type {
  WorkerConnection,
  WorkerHealthSnapshot,
} from "./worker-lifecycle.js";
/**
 * The app's side of the host (see RUNTIME_HOST_HANDLERS). Results cross a
 * process boundary untyped, so each call site reads what it needs.
 */
type HostHandler = (...args: any[]) => any;
export type StellaRuntimeHostHandlers = Partial<
  Record<RuntimeHostHandler, HostHandler>
> &
  Record<
    | "getDeviceIdentity"
    | "askUser"
    | "requestSecureInput"
    | "useSecureValue"
    | "displayUpdate",
    HostHandler
  >;
export type StellaRuntimeHostOptions = {
  initializeParams: RuntimeClientAttachParams["initializeParams"];
  hostHandlers: StellaRuntimeHostHandlers;
  workerMode?: "child" | "inproc";
  workerEntryPath?: string;
  disableLocalScheduler?: boolean;
  inprocWorker?: {
    attach: InprocWorkerAttach;
    restartProcess: (reason: string) => void;
  };
};
/** Worker RPC params are untyped JSON; each handler reads what it needs. */
type WorkerRequestHandler = (params: any) => unknown;
type WorkerNotificationHandler = (params: any) => void;
type WorkerPeerRegistrar = {
  registerRequestHandler(method: string, handler: WorkerRequestHandler): void;
  registerNotificationHandler(
    method: string,
    handler: WorkerNotificationHandler,
  ): void;
};
type WorkerRequestOptions = {
  ensureWorker: boolean;
  recordActivity: boolean;
  retryOnceOnDisconnect?: boolean;
  rpc?: Parameters<JsonRpcPeer["request"]>[2];
};
type PlacedChatPayload = RuntimeChatPayload & {
  handoff?: boolean;
  idempotencyKey?: string;
};
type PlacedChatTarget =
  | { mode: "cloud" }
  | { mode: "device"; deviceId: string };
type PlacedDispatch = {
  dispatchId: string;
  runId: string;
  requestId: string | undefined;
  conversationId: string;
  userMessageId: string;
  subscription: DispatchWatchHandle | null;
};
const requireRuntime = createRequire(import.meta.url);
const loadSqliteDatabaseCtorSync = (): new (path: string) => SqliteDatabase => {
  if (process.versions.bun) {
    const bunSqlite = requireRuntime("bun:sqlite");
    if (typeof bunSqlite.Database === "function") return bunSqlite.Database;
  } else {
    const nodeSqlite = requireRuntime("node:sqlite");
    if (typeof nodeSqlite.DatabaseSync === "function") {
      return nodeSqlite.DatabaseSync;
    }
  }
  throw new Error("No compatible SQLite builtin is available.");
};
const DESTINATION_HANDOFF_DELAY_MS = 500;
const PLACED_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;
const parseDisplayUpdateParams = (params: unknown) => {
  if (params && typeof params === "object") {
    const record = params as Record<string, unknown>;
    if (record.payload && typeof record.payload === "object") {
      return record.payload;
    }
    if (typeof record.kind === "string") {
      return record;
    }
  }
  throw new Error("Invalid host display update payload.");
};
export const isWorkerBusyForRestart = (
  health: WorkerHealthSnapshot | null | undefined,
) => health != null && health.piBusy === true;
class HostEvents extends EventEmitter {
  anyListeners = new Set<(eventName: string, payload: unknown) => void>();
  emit(eventName: string, ...args: unknown[]) {
    for (const listener of this.anyListeners) {
      try {
        listener(eventName, args[0]);
      } catch (error) {
        console.error("[runtime-host] event tap failed:", error);
      }
    }
    return super.emit(eventName, ...args);
  }
}
const placementUnavailable = (error: unknown) =>
  !(error instanceof PlacementRouteError) || error.retryable;
export class StellaRuntimeHost {
  options: StellaRuntimeHostOptions;
  workerMode: "child" | "inproc" = "child";
  events = new HostEvents();
  workerController: RuntimeWorkerLifecycleController;
  workerHealthCache: WorkerHealthSnapshot | null = null;
  schedulerService: LocalSchedulerService | null = null;
  schedulerSubscription: (() => void) | null = null;
  cloudScheduleUnsubscribe: (() => void) | null = null;
  cloudSchedules: CloudSchedules | null = null;
  deferredRuntimeReload = false;
  restartInProgress = false;
  restartRequestedDuringRestart = false;
  pendingStaleWorkerRestart: PendingWorkerRestartRecord | null = null;
  staleWorkerQuiescencePollFiber: Fiber.Fiber<void, never> | null = null;
  workerRestartCheckInFlight = false;
  reloadQueue: Promise<void> = Promise.resolve();
  configCache: RuntimeConfigureParams = {};
  deviceIdentity:
    | (HostDeviceIdentity & { supersededDeviceId?: string })
    | null = null;
  workerGeneration = 0;
  staleWorkerFrameDrops = 0;
  started = false;
  hostReady = false;
  hostBackendClient: BackendClient | null = null;
  hostBackendClientUrl: string | null = null;
  hostAuthTokenForcePromise: Promise<string> | null = null;
  deviceSuccessionClaimPromise: Promise<void> | null = null;
  hostAccountServicesKey: string | null = null;
  hostExecutionPlacementBridge: ExecutionPlacementBridge | null = null;
  hostExecutionPlacementSyncQueue: Promise<void> = Promise.resolve();
  hostExecutionPlacementRetryTimer: HostTimerHandle | null = null;
  hostExecutionPlacementRetryAttempt = 0;
  placedDispatchByRunId = new Map<string, PlacedDispatch>();
  placements = new ConversationPlacements();
  claudeCodeLogin: { signedIn: boolean; at: number; pending?: Promise<void> } = { signedIn: false, at: 0 };
  pendingDestinationHandoffs = new Map<string, { canceled: boolean }>();
  hostDatabase: SqliteDatabase | null = null;
  constructor(options: StellaRuntimeHostOptions) {
    this.options = options;
    this.workerMode = this.options.workerMode === "inproc" ? "inproc" : "child";
    const onWorkerRpcError = (error: unknown) => {
      console.error("[runtime-host] worker RPC error:", error);
    };
    const createConnectionAsync =
      this.workerMode === "inproc"
        ? buildInprocConnectionFactory(this.options.inprocWorker!.attach, {
            onError: onWorkerRpcError,
          })
        : buildStdioConnectionFactory({
            ...(process.env.STELLA_BUN_PATH?.trim()
              ? { bunBinaryPath: process.env.STELLA_BUN_PATH.trim() }
              : {}),
            onError: onWorkerRpcError,
          });
    this.workerController = new RuntimeWorkerLifecycleController({
      workerEntryPath: resolveDefaultWorkerEntryPath(this.options),
      isHostStarted: () => this.started,
      killWorkerOnStop: this.workerMode === "inproc" ? () => false : () => true,
      createConnectionAsync,
      initializeConnection: async (connection) => {
        const fencedPeer = this.fenceWorkerPeer(connection.peer);
        this.registerHostHandlers(fencedPeer);
        this.registerNotifications(fencedPeer);
        const initializeResult = await connection.peer.request<{
          protocolVersion?: string;
        }>(
          METHOD_NAMES.INTERNAL_WORKER_INITIALIZE,
          this.buildWorkerInitializationState(),
        );
        if (
          initializeResult.protocolVersion !== STELLA_RUNTIME_PROTOCOL_VERSION
        ) {
          throw new Error(
            `Runtime worker protocol mismatch: host=${STELLA_RUNTIME_PROTOCOL_VERSION} worker=${initializeResult.protocolVersion ?? "unknown"}.`,
          );
        }
        if (Object.keys(this.configCache).length > 0) {
          await connection.peer.request(
            METHOD_NAMES.INTERNAL_WORKER_CONFIGURE,
            this.configCache,
          );
        }
      },
      onConnectionStarted: async (connection) => {
        this.workerGeneration += 1;
        getFileLogger()?.process("host.worker-connected", {
          pid: connection.pid,
          generation: this.workerGeneration,
          attached: connection.attachedToExistingWorker === true,
        });
        this.workerHealthCache = await this.workerController.getHealth({
          ensureWorker: false,
        });
        try {
          await this.evaluateWorkerStalenessOnConnect(connection);
        } catch (error) {
          console.warn(
            "[runtime-host] Worker staleness handshake failed:",
            (error as Error).message,
          );
        }
        this.events.emit("runtime-ready", await this.health());
      },
      onUnexpectedExit: async () => {
        getFileLogger()?.error("host.worker-unexpected-exit", {
          generation: this.workerGeneration,
        });
        this.workerHealthCache = null;
        if (this.started) {
          this.events.emit("runtime-ready", await this.health());
        }
      },
      onAfterStop: async (reason) => {
        if (reason !== "idle") {
          getFileLogger()?.process("host.worker-stopped", { reason });
        }
        this.workerHealthCache = null;
        if (this.started) {
          this.events.emit("runtime-reloading", { reason: `worker-${reason}` });
          this.events.emit("runtime-ready", await this.health());
        }
      },
      onStateChange: (_state) => {
        if (_state === "idle" && !this.workerController.getConnection()) {
          this.workerHealthCache = null;
        }
      },
      fetchHealth: async (connection) => {
        const snapshot =
          await connection.peer.request<WorkerHealthSnapshot | null>(
            METHOD_NAMES.INTERNAL_WORKER_HEALTH,
          );
        this.workerHealthCache = snapshot;
        return snapshot;
      },
    });
  }
  async requestRuntimeRestart() {
    this.deferredRuntimeReload = true;
    void this.flushWorkerRestart();
    return { ok: true };
  }
  getRuntimeControlPaths() {
    return resolveRuntimePaths(this.options.initializeParams.stellaAppDir);
  }
  async markPendingWorkerRestart(reason: string) {
    if (!this.pendingStaleWorkerRestart) {
      this.pendingStaleWorkerRestart = { reason, detectedAtMs: Date.now() };
    }
    const record = this.pendingStaleWorkerRestart;
    getFileLogger()?.process("host.worker-restart-pending", { reason });
    console.warn(
      `[runtime-host] Runtime update pending (${reason}); the worker restarts when current work finishes.`,
    );
    const persistExit = await hostRuntime.runPromiseExit(
      persistPendingWorkerRestartFlag(this.getRuntimeControlPaths(), record),
    );
    if (Exit.isFailure(persistExit)) {
      console.warn(
        "[runtime-host] Failed to persist pending worker restart flag:",
        (Cause.squash(persistExit.cause) as Error).message,
      );
    }
    this.startStaleWorkerQuiescencePoll();
    // Nudge the unified gate soon: restart now if already quiescent, otherwise
    // an unblock hook (pause release, morph settle, worker idle) or the poll
    // retries. Forked as a 1s fiber so it stays off this call stack — a
    // caller still inside the startup / apply sequence isn't restarted from
    // under itself.
    forkDelayed(1_000, () => {
      void this.flushWorkerRestart();
    });
    if (this.started) {
      this.events.emit("runtime-ready", await this.health());
    }
  }
  async clearPendingWorkerRestart() {
    this.stopStaleWorkerQuiescencePoll();
    this.pendingStaleWorkerRestart = null;
    await hostRuntime.runPromise(
      clearPendingWorkerRestartFlag(this.getRuntimeControlPaths()),
    );
  }
  startStaleWorkerQuiescencePoll() {
    if (this.staleWorkerQuiescencePollFiber) return;
    // Safety net for busy signals that don't end in a RUN_FINISHED event
    // (e.g. voice-only activity) or a missed event during churn. Fixed-rate
    // 30s ticks with a leading delay, matching the old setInterval cadence
    // (see quiescencePollEffect).
    this.staleWorkerQuiescencePollFiber = hostRuntime.runFork(
      quiescencePollEffect(() => this.flushWorkerRestart()),
    );
  }
  stopStaleWorkerQuiescencePoll() {
    const fiber = this.staleWorkerQuiescencePollFiber;
    if (!fiber) return;
    this.staleWorkerQuiescencePollFiber = null;
    hostRuntime.runFork(Fiber.interrupt(fiber));
  }
  async evaluateWorkerStalenessOnConnect(_connection: WorkerConnection) {
    if (this.workerMode === "child") {
      return;
    }
    await this.clearPendingWorkerRestart();
  }
  async checkRuntimeStaleness() {
    if (this.workerMode !== "inproc" || !this.started) return;
    const verdict = await hostRuntime.runPromise(
      evaluateWorkerStaleness({
        attachedToExistingWorker: true,
        paths: this.getRuntimeControlPaths(),
        workerEntryPath: resolveDefaultWorkerEntryPath(this.options),
      }),
    );
    if (
      !verdict.stale ||
      (verdict.reason === "pending-restart-flag" &&
        this.pendingStaleWorkerRestart)
    ) {
      return;
    }
    getFileLogger()?.process("host.runtime-stale-detected", {
      reason: verdict.reason,
    });
    await this.markPendingWorkerRestart(verdict.reason);
  }
  canRestartWorkerNow(health = this.workerHealthCache) {
    return !isWorkerBusyForRestart(health);
  }
  hasPendingWorkerRestartIntent() {
    return this.deferredRuntimeReload || this.pendingStaleWorkerRestart != null;
  }
  async flushWorkerRestart() {
    if (!this.started || !this.hasPendingWorkerRestartIntent()) return;
    if (this.workerRestartCheckInFlight) return;
    this.workerRestartCheckInFlight = true;
    try {
      const health = await this.getWorkerHealth({ ensureWorker: false }).catch(
        () => null,
      );
      if (!this.canRestartWorkerNow(health)) {
        // pi work ends without a RUN_FINISHED notification, so keep a
        // re-check armed for any deferred restart, not only stale ones.
        this.startStaleWorkerQuiescencePoll();
        return;
      }
      this.executeWorkerRestart();
    } finally {
      this.workerRestartCheckInFlight = false;
    }
  }
  executeWorkerRestart() {
    if (this.restartInProgress) {
      this.restartRequestedDuringRestart = true;
      return;
    }
    this.restartInProgress = true;
    this.reloadQueue = this.reloadQueue
      .catch(() => undefined)
      .then(async () => {
        try {
          if (!this.started || !this.hasPendingWorkerRestartIntent()) return;
          const health = await this.getWorkerHealth({
            ensureWorker: false,
          }).catch(() => null);
          if (!this.canRestartWorkerNow(health)) return;
          const reason =
            this.pendingStaleWorkerRestart?.reason ?? "runtime-reload";
          // Consume the requested intent before the replacement worker starts.
          // Worker initialization resets reload pauses and flushes pending
          // restart intent; leaving this bit set there re-arms the restart
          // forever, producing a spawn/ready/kill loop until Electron exits.
          const consumedDeferredRuntimeReload = this.deferredRuntimeReload;
          this.deferredRuntimeReload = false;
          getFileLogger()?.process("host.worker-restart", { reason });
          console.warn(`[runtime-host] Restarting runtime worker (${reason}).`);
          try {
            await this.restartWorker(reason);
          } catch (error) {
            if (consumedDeferredRuntimeReload) {
              this.deferredRuntimeReload = true;
            }
            throw error;
          }
        } finally {
          this.restartInProgress = false;
          if (this.restartRequestedDuringRestart) {
            this.restartRequestedDuringRestart = false;
            forkDelayed(0, () => {
              void this.flushWorkerRestart();
            });
          }
          // `restartWorker()` emits readiness while restartInProgress is still
          // true, so that snapshot intentionally remains send-blocked. Publish
          // the authoritative post-transition state after clearing the flag so
          // waitUntilReady callers are released without polling or retrying.
          if (this.started) {
            void this.health().then((snapshot) => {
              this.events.emit("runtime-ready", snapshot);
            });
          }
        }
      });
  }
  getConfiguredHostAuthToken() {
    return this.configCache.authToken?.trim() || null;
  }
  getConfiguredHostBackendUrl() {
    const value = (
      this.configCache.backendUrl ??
      process.env.STELLA_BACKEND_URL ??
      ""
    )
      .trim()
      .replace(/\/+$/, "");
    return /^https?:\/\//.test(value) ? value : null;
  }
  disposeHostBackendClient() {
    this.hostBackendClient?.dispose();
    this.hostBackendClient = null;
    this.hostBackendClientUrl = null;
  }
  async forceHostAuthToken(): Promise<string> {
    if (this.hostAuthTokenForcePromise) {
      return await this.hostAuthTokenForcePromise;
    }
    const previous = this.getConfiguredHostAuthToken();
    const previousExpiry = backendTokenExpiryMs(previous);
    const attempt = (async () => {
      const refreshed =
        await this.options.hostHandlers.requestRuntimeAuthRefresh?.({
          source: "subscription",
        });
      const minted = refreshed?.authenticated
        ? refreshed.token?.trim() || null
        : null;
      const next = minted ?? this.getConfiguredHostAuthToken();
      const nextExpiry = backendTokenExpiryMs(next);
      if (
        !next ||
        next === previous ||
        (previousExpiry !== null &&
          nextExpiry !== null &&
          nextExpiry <= previousExpiry)
      ) {
        throw new Error("Stella could not mint a newer cloud token.");
      }
      return next;
    })();
    this.hostAuthTokenForcePromise = attempt;
    try {
      return await attempt;
    } finally {
      if (this.hostAuthTokenForcePromise === attempt) {
        this.hostAuthTokenForcePromise = null;
      }
    }
  }
  ensureHostBackendClient() {
    const baseUrl = this.getConfiguredHostBackendUrl();
    if (!baseUrl) {
      this.disposeHostBackendClient();
      return null;
    }
    if (this.hostBackendClient && this.hostBackendClientUrl === baseUrl) {
      return this.hostBackendClient;
    }
    this.disposeHostBackendClient();
    this.hostBackendClient = new BackendClient({
      baseUrl,
      getToken: async (options) =>
        options?.force
          ? await this.forceHostAuthToken()
          : this.getConfiguredHostAuthToken() || null,
    });
    this.hostBackendClientUrl = baseUrl;
    return this.hostBackendClient;
  }
  resubscribeCloudSchedules() {
    this.cloudScheduleUnsubscribe?.();
    this.cloudScheduleUnsubscribe = null;
    if (!this.schedulerService || !this.hostAccountServicesKey) return;
    this.cloudScheduleUnsubscribe = this.getCloudSchedules().subscribe(() => {
      this.events.emit("schedule-updated", undefined);
    });
  }
  /** Move the retired device id's pairings onto this identity; retried until the backend accepts. */
  async claimDeviceIdentitySuccession(): Promise<void> {
    const previousDeviceId = this.deviceIdentity?.supersededDeviceId;
    const deviceId = this.deviceIdentity?.deviceId;
    if (!previousDeviceId || !deviceId || previousDeviceId === deviceId) {
      return;
    }
    if (this.deviceSuccessionClaimPromise) {
      return await this.deviceSuccessionClaimPromise;
    }
    this.deviceSuccessionClaimPromise = this.runDeviceIdentitySuccessionClaim(
      previousDeviceId,
      deviceId,
    );
    try {
      return await this.deviceSuccessionClaimPromise;
    } finally {
      this.deviceSuccessionClaimPromise = null;
    }
  }
  async runDeviceIdentitySuccessionClaim(
    previousDeviceId: string,
    deviceId: string,
  ) {
    const client = this.getConfiguredHostAuthToken()
      ? this.ensureHostBackendClient()
      : null;
    if (!client) {
      return;
    }
    try {
      await client.call("devices.adoptSuccession", {
        previousDeviceId,
        deviceId,
      });
    } catch (error) {
      const code = error instanceof BackendRequestError ? error.code : null;
      if (code !== "CONFLICT" && code !== "BAD_REQUEST") {
        console.warn(
          "[device-identity] Failed to claim device identity succession; will retry.",
          error,
        );
        return;
      }
    }
    await this.options.hostHandlers
      .clearSupersededDeviceId?.()
      .catch(() => undefined);
    if (this.deviceIdentity) {
      delete this.deviceIdentity.supersededDeviceId;
    }
  }
  async syncHostExecutionPlacement() {
    const operation = this.hostExecutionPlacementSyncQueue.then(() =>
      this.syncHostExecutionPlacementNow(),
    );
    this.hostExecutionPlacementSyncQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return await operation;
  }
  scheduleHostExecutionPlacementRetry() {
    if (this.hostExecutionPlacementRetryTimer) return;
    const attempt = this.hostExecutionPlacementRetryAttempt++;
    const base = Math.min(60_000, 1_000 * 2 ** Math.min(attempt, 6));
    const delay = base / 2 + Math.random() * (base / 2);
    this.hostExecutionPlacementRetryTimer = forkDelayed(delay, () => {
      this.hostExecutionPlacementRetryTimer = null;
      void this.syncHostExecutionPlacement().catch((error) =>
        console.warn("[execution-placement] Desktop placement bridge retry failed.", error),
      );
    });
  }
  cancelHostExecutionPlacementRetry() {
    if (this.hostExecutionPlacementRetryTimer) {
      this.hostExecutionPlacementRetryTimer.cancel();
      this.hostExecutionPlacementRetryTimer = null;
    }
  }
  async syncHostExecutionPlacementNow() {
    this.cancelHostExecutionPlacementRetry();
    const eligible = isExecutionPlacementEligible({
      started: this.started,
      hostReady: this.hostReady,
      deviceIdentity: this.deviceIdentity,
      hasDatabase: Boolean(this.hostDatabase),
      hasConnectedAccount: this.configCache.hasConnectedAccount,
      cloudSyncEnabled: this.configCache.cloudSyncEnabled,
      authToken: this.getConfiguredHostAuthToken(),
      backendUrl: this.getConfiguredHostBackendUrl(),
      canSignDeviceInput:
        typeof this.options.hostHandlers.signDeviceInput === "function",
    });
    const client = eligible ? this.ensureHostBackendClient() : null;
    if (
      this.hostExecutionPlacementBridge &&
      client &&
      this.hostExecutionPlacementBridge.client === client &&
      this.hostExecutionPlacementBridge.isRunning
    ) {
      return;
    }
    const previous = this.hostExecutionPlacementBridge;
    this.hostExecutionPlacementBridge = null;
    if (previous) {
      try {
        await previous.stop();
      } catch (error) {
        this.hostExecutionPlacementBridge = previous;
        this.scheduleHostExecutionPlacementRetry();
        throw error;
      }
    }
    if (!eligible || !client || !this.hostDatabase) {
      this.hostExecutionPlacementRetryAttempt = 0;
      return;
    }
    const bridge = createExecutionPlacementBridge({
      client,
      database: this.hostDatabase,
      deviceIdentity: this.deviceIdentity!,
      signPresenceProof: async (message) => {
        const signed =
          await this.options.hostHandlers.signDeviceInput!(message);
        if (
          !signed ||
          typeof signed.signature !== "string" ||
          !signed.signature
        ) {
          throw new Error("Stella device signing returned no signature.");
        }
        return signed.signature;
      },
      appVersion: "stella-desktop-v2",
      deviceName: hostname().trim().slice(0, 96) || undefined,
      platform: process.platform,
      getAuthToken: () => this.getConfiguredHostAuthToken(),
      onRemoteExecutionRequest: (request) => {
        void Promise.resolve(
          this.options.hostHandlers.notifyRemoteExecutionRequest?.(request),
        ).catch((error) =>
          console.warn(
            "[execution-placement] the remote execution prompt could not be shown.",
            error,
          ),
        );
      },
      serveDeviceRequest: async (request) => {
        if (request.method === "mcp.listTools" || request.method === "mcp.callTool") {
          if (request.mobileDeviceId !== DEVICE_REQUEST_CLOUD_ASKER) {
            return {
              ok: false,
              code: "forbidden",
              message: "Only Stella's cloud reaches this computer's MCP servers.",
            };
          }
          try {
            const value = await this.requestWorker(
              METHOD_NAMES.INTERNAL_WORKER_MCP_DEVICE_REQUEST,
              { method: request.method, params: request.params },
              { ensureWorker: true, recordActivity: true },
            );
            return {
              ok: true,
              contentType: "application/json",
              bodyBase64: Buffer.from(JSON.stringify(value ?? null), "utf8").toString("base64"),
            };
          } catch (error) {
            const message =
              error instanceof Error && error.message.trim()
                ? error.message.trim().slice(0, 500)
                : "This computer could not run that MCP request.";
            return {
              ok: false,
              code: /isn't on this computer|is not on this computer/u.test(message)
                ? "not_found"
                : "failed",
              message,
            };
          }
        }
        if (
          isDeviceClaudeLoginRequestMethod(request.method) &&
          request.mobileDeviceId !== DEVICE_REQUEST_CLOUD_ASKER
        ) {
          return {
            ok: false,
            code: "forbidden",
            message: "Only Stella's cloud starts a Claude sign-in on this computer.",
          };
        }
        const serve = this.options.hostHandlers.serveDeviceRequest;
        if (typeof serve !== "function") {
          return {
            ok: false,
            code: "failed",
            message: "This computer can't answer phone requests.",
          };
        }
        return await serve(request);
      },
      getAvailability: async () => {
        const platformCapabilities: ExecutionPlacementAvailability["capabilities"] =
          process.platform === "darwin" || process.platform === "win32"
            ? ["computer-use"]
            : [];
        const claudeCode = await this.claudeCodeSignedIn();
        return {
          ready: Boolean(
            this.started &&
              this.hostReady &&
              this.configCache.hasConnectedAccount &&
              this.configCache.cloudSyncEnabled,
          ),
          capabilities: [
            "chat",
            "agent",
            "local-files",
            "attachments",
            ...platformCapabilities,
            ...(claudeCode ? (["claude-code"] as const) : []),
          ],
        };
      },
      runExecution: async ({ dispatch, payload, ownerGeneration }) => {
        const prompt =
          typeof payload.prompt === "string" ? payload.prompt.trim() : "";
        const contextOnly =
          dispatch.kind === "chat" &&
          (Boolean(
            payload.context &&
              typeof payload.context === "object" &&
              typeof (payload.context as { text?: unknown }).text === "string" &&
              (payload.context as { text: string }).text.trim(),
          ) ||
            placementAttachmentPaths(payload).length > 0);
        if (!prompt && !contextOnly) {
          return {
            status: "error",
            error: "The accepted execution payload did not contain a prompt.",
          };
        }
        const userMessageEventId =
          typeof payload.userMessageEventId === "string" &&
          payload.userMessageEventId.trim()
            ? payload.userMessageEventId.trim()
            : dispatch.dispatchId;
        const attachments = await resolvePlacementAttachments({
          paths: placementAttachmentPaths(payload),
          resolve: async (path) => await client.call("drive.fileUrl", { path }),
          onSkipped: (path, error) =>
            console.warn(
              `[execution-placement] attachment ${path} could not be resolved from the drive.`,
              error,
            ),
        });
        if (dispatch.kind === "agent") {
          const description =
            typeof payload.description === "string" &&
            payload.description.trim()
              ? payload.description.trim()
              : prompt.slice(0, 160);
          const remoteThreadId =
            typeof payload.threadId === "string" && payload.threadId.trim()
              ? payload.threadId.trim()
              : null;
          const requestedModel =
            typeof payload.model === "string" && payload.model.trim()
              ? payload.model.trim()
              : null;
          const lineage = readAgentLineage(payload.lineage);
          const result = await this.requestWorker<{
            status: string;
            finalText?: string;
            error?: string;
            stopped?: boolean;
          }>(
            METHOD_NAMES.INTERNAL_WORKER_RUN_BLOCKING_AGENT,
            {
              conversationId: dispatch.conversationId,
              description,
              prompt,
              agentType: "general",
              ...(requestedModel ? { requestedModel } : {}),
              ...(lineage ? { lineage } : {}),
              ...(remoteThreadId
                ? {
                    threadId: remoteThreadId,
                    executionId: placementLocalAgentThreadId(
                      dispatch.dispatchId,
                    ),
                    remoteThreadId,
                  }
                : {
                    threadId: placementLocalAgentThreadId(dispatch.dispatchId),
                  }),
              ...(attachments.length > 0 ? { attachments } : {}),
            },
            {
              ensureWorker: true,
              recordActivity: true,
              retryOnceOnDisconnect: false,
              rpc: AGENT_RUN_RPC_OPTIONS,
            },
          );
          if (result.status === "ok") {
            return { status: "ok", finalText: result.finalText };
          }
          if (result.status === "canceled") {
            return {
              status: "canceled",
              error: result.error || "The agent was stopped.",
              ...(result.stopped ? { stopped: true } : {}),
            };
          }
          return {
            status: "error",
            error: result.error || "The local agent failed.",
          };
        }
        const handoff = payload.handoff === true;
        const scheduled = dispatch.ingress === "schedule";
        const scheduledAgent =
          scheduled &&
          payload.scheduledAgent &&
          typeof payload.scheduledAgent === "object" &&
          typeof (payload.scheduledAgent as { description?: unknown }).description === "string"
            ? (payload.scheduledAgent as { description: string })
            : null;
        if (scheduledAgent) {
          await this.createBackgroundAgent({
            conversationId: dispatch.conversationId,
            threadId: dispatch.dispatchId,
            description: scheduledAgent.description.trim() || prompt.slice(0, 160),
            prompt,
          });
          return { status: "ok", finalText: "" };
        }
        const userAuthored = !handoff && !scheduled;
        const result = await this.requestWorker<RuntimeAutomationTurnResult>(
          METHOD_NAMES.INTERNAL_WORKER_RUN_AUTOMATION,
          {
            conversationId: dispatch.conversationId,
            userPrompt: prompt,
            userMessageEventId,
            userAuthoredPrompt: userAuthored,
            ...(scheduled ? { scheduled: true } : {}),
            ...(handoff ? { handoff: true } : {}),
            rejectIfBusy: false,
            executionPlacementRunId: placementLocalChatRunId(
              dispatch.dispatchId,
            ),
            ownerGeneration,
            ...(attachments.length > 0 ? { attachments } : {}),
            ...(userAuthored && payload.context !== undefined
              ? { context: payload.context }
              : {}),
          },
          {
            ensureWorker: true,
            recordActivity: true,
            retryOnceOnDisconnect: false,
          },
        );
        if (result.status === "ok") {
          return { status: "ok", finalText: result.finalText };
        }
        return {
          status: "error",
          error: result.error || "The local execution failed.",
        };
      },
      steerExecution: async ({ dispatchId, payload, messageId, text }) => {
        const remoteThreadId =
          typeof payload.threadId === "string" && payload.threadId.trim()
            ? payload.threadId.trim()
            : null;
        const result = await this.requestWorker<{
          delivered?: boolean;
        } | null>(
          METHOD_NAMES.INTERNAL_WORKER_STEER_BLOCKING_AGENT,
          {
            agentId: remoteThreadId ?? placementLocalAgentThreadId(dispatchId),
            text,
            messageId,
          },
          {
            ensureWorker: true,
            recordActivity: true,
            retryOnceOnDisconnect: false,
          },
        );
        return result?.delivered === true;
      },
      deliverAgentMessage: async ({
        threadId,
        messageId,
        text,
        ownerGeneration,
      }) => {
        const result = await this.requestWorker<{
          outcome?: AgentMessageDeviceOutcome;
        } | null>(
          METHOD_NAMES.INTERNAL_WORKER_DELIVER_AGENT_MESSAGE,
          { threadId, text, messageId, ownerGeneration },
          {
            ensureWorker: true,
            recordActivity: true,
            retryOnceOnDisconnect: false,
          },
        );
        return result?.outcome ?? "refused";
      },
      stopLocalAgent: async ({ threadId, ownerGeneration }) => {
        const result = await this.requestWorker<{
          outcome?: AgentStopDeviceOutcome;
        } | null>(
          METHOD_NAMES.INTERNAL_WORKER_STOP_LOCAL_AGENT,
          { threadId, ownerGeneration },
          {
            ensureWorker: true,
            recordActivity: true,
            retryOnceOnDisconnect: false,
          },
        );
        return result?.outcome ?? "refused";
      },
      cancelExecution: async ({
        dispatchId,
        kind,
        conversationId,
        payload,
        stopped,
      }) => {
        if (kind === "agent") {
          const remoteThreadId =
            typeof payload?.threadId === "string" && payload.threadId.trim()
              ? payload.threadId.trim()
              : null;
          const reason = stopped
            ? AGENT_STOP_WIRE_REASON
            : "Canceled by execution placement.";
          const result = remoteThreadId
            ? await this.cancelBlockingLocalAgent(
                remoteThreadId,
                reason,
                placementLocalAgentThreadId(dispatchId),
              )
            : await this.cancelBlockingLocalAgent(
                placementLocalAgentThreadId(dispatchId),
                reason,
              );
          if (result?.canceled !== true) {
            throw new Error(
              "The exact local-agent cancellation was not acknowledged.",
            );
          }
          return;
        }
        const result = await this.cancelPlacementAutomation(
          placementLocalChatRunId(dispatchId),
          "Canceled by execution placement.",
        );
        if (result?.canceled !== true) {
          throw new Error(
            "The exact local-chat cancellation was not acknowledged.",
          );
        }
      },
      log: (level, message, error) => {
        const logger = level === "error" ? console.error : console.warn;
        if (error === undefined) {
          logger(`[execution-placement] ${message}`);
        } else {
          logger(`[execution-placement] ${message}`, error);
        }
      },
    });
    this.hostExecutionPlacementBridge = bridge;
    try {
      await bridge.start();
      this.hostExecutionPlacementRetryAttempt = 0;
    } catch (error) {
      if (this.hostExecutionPlacementBridge === bridge) {
        this.hostExecutionPlacementBridge = null;
      }
      try {
        await bridge.stop();
      } catch (stopError) {
        this.hostExecutionPlacementBridge = bridge;
        this.scheduleHostExecutionPlacementRetry();
        throw new Error(
          "Execution placement startup cleanup did not reach its cancellation/drain barrier.",
          { cause: stopError },
        );
      }
      console.warn(
        "[execution-placement] Desktop placement bridge did not start; retrying.",
        error,
      );
      this.scheduleHostExecutionPlacementRetry();
    }
  }
  syncHostAccountServices() {
    const authToken = this.getConfiguredHostAuthToken();
    const backendUrl = this.getConfiguredHostBackendUrl();
    const signedIn =
      this.started &&
      this.hostReady &&
      Boolean(authToken && backendUrl) &&
      Boolean(this.configCache.hasConnectedAccount);
    const key = signedIn ? `${backendUrl}\n${authToken}` : null;
    if (signedIn) {
      void this.claimDeviceIdentitySuccession();
    }
    if (key === this.hostAccountServicesKey) return;
    this.hostAccountServicesKey = key;
    this.resubscribeCloudSchedules();
  }
  on(eventName: string, listener: (...args: any[]) => void) {
    this.events.on(eventName, listener);
    return () => {
      this.events.removeListener(eventName, listener);
    };
  }
  onAny(listener: (eventName: string, payload: unknown) => void) {
    this.events.anyListeners.add(listener);
    return () => {
      this.events.anyListeners.delete(listener);
    };
  }
  async start() {
    if (this.started) return;
    this.started = true;
    await this.initializeHostServices();
    this.syncHostAccountServices();
    await this.syncHostExecutionPlacement();
    this.events.emit("runtime-connected", undefined);
    this.events.emit("runtime-ready", await this.health());
  }
  async stop(options?: { killWorker?: boolean }) {
    this.started = false;
    this.hostReady = false;
    this.workerHealthCache = null;
    this.workerGeneration = 0;
    this.deferredRuntimeReload = false;
    this.restartInProgress = false;
    this.restartRequestedDuringRestart = false;
    this.pendingStaleWorkerRestart = null;
    this.stopStaleWorkerQuiescencePoll();
    await this.workerController.stop(
      options?.killWorker ? "restart" : "stopped",
    );
    await this.stopHostServices();
    this.deviceIdentity = null;
    this.configCache = {};
    this.events.emit("runtime-disconnected", { reason: "stopped" });
  }
  async configure(params: RuntimeConfigureParams) {
    this.configCache = { ...this.configCache, ...params };
    this.syncHostAccountServices();
    await this.syncHostExecutionPlacement();
    const connection = this.workerController.getConnection();
    if (!connection?.peer) {
      return { ok: true };
    }
    return await connection.peer.request(
      METHOD_NAMES.INTERNAL_WORKER_CONFIGURE,
      params,
    );
  }
  async health() {
    return await this.buildHealthSnapshot();
  }
  async restartWorker(reason = "runtime-reload") {
    const startedAt = Date.now();
    this.events.emit("runtime-reloading", { reason: "worker-restart" });
    if (this.workerMode === "inproc") {
      getFileLogger()?.process("host.runtime-restart", { reason });
      this.options.inprocWorker!.restartProcess(reason);
      return { ok: true };
    }
    await this.workerController.stop("restart");
    const stoppedAt = Date.now();
    await this.workerController.ensureStarted();
    const readyAt = Date.now();
    getFileLogger()?.process("host.worker-restart-latency", {
      stopMs: stoppedAt - startedAt,
      startMs: readyAt - stoppedAt,
      totalMs: readyAt - startedAt,
      generation: this.workerGeneration,
    });
    return { ok: true };
  }
  async ensureWorkerStarted() {
    await this.workerController.ensureStarted();
    return { ok: true };
  }
  async readPlacedAttachment(attachment: {
    url?: unknown;
    name?: unknown;
    mimeType?: unknown;
  }) {
    const source =
      typeof attachment?.url === "string" ? attachment.url.trim() : "";
    if (!source) throw new Error("A remote attachment is missing its source.");
    let bytes: Buffer;
    let inferredName =
      typeof attachment.name === "string" ? attachment.name.trim() : "";
    let contentType =
      typeof attachment.mimeType === "string" && attachment.mimeType.trim()
        ? attachment.mimeType.trim()
        : "application/octet-stream";
    const dataMatch = source.match(/^data:([^;,]+)?(?:;base64)?,(.*)$/s);
    if (dataMatch) {
      const encoded = dataMatch[2] ?? "";
      bytes = source.slice(0, source.indexOf(",")).includes(";base64")
        ? Buffer.from(encoded, "base64")
        : Buffer.from(decodeURIComponent(encoded), "utf8");
      if (dataMatch[1]) contentType = dataMatch[1];
    } else {
      const filePath = source.startsWith("file:")
        ? fileURLToPath(source)
        : source;
      bytes = await fs.readFile(filePath);
      inferredName ||= path.basename(filePath);
    }
    if (
      bytes.byteLength <= 0 ||
      bytes.byteLength > PLACED_ATTACHMENT_MAX_BYTES
    ) {
      throw new Error("Remote attachments must be between 1 byte and 20 MB.");
    }
    return {
      bytes,
      contentType,
      name: inferredName || "attachment",
    };
  }
  async uploadPlacedAttachments(
    payload: PlacedChatPayload,
    idempotencyKey: string,
  ) {
    const attachments = Array.isArray(payload.attachments)
      ? payload.attachments.slice(0, 4)
      : [];
    if (attachments.length === 0) return [];
    const drive = this.ensureHostBackendClient();
    if (!drive) {
      throw new Error("Cross-device execution is not ready on this computer.");
    }
    const scope = createHash("sha256")
      .update(idempotencyKey)
      .digest("hex")
      .slice(0, 24);
    const uploaded: string[] = [];
    for (let index = 0; index < attachments.length; index += 1) {
      const attachment = await this.readPlacedAttachment(attachments[index]!);
      const rawExtension = path.extname(attachment.name).toLowerCase();
      const extension = /^\.[a-z0-9]{1,10}$/.test(rawExtension)
        ? rawExtension
        : "";
      const drivePath = `execution-attachments/${scope}/${String(index + 1).padStart(2, "0")}${extension}`;
      const prepared = await drive.call("drive.prepareUpload", {
        path: drivePath,
        sizeBytes: attachment.bytes.byteLength,
        contentType: attachment.contentType,
      });
      const response = await fetch(prepared.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": prepared.contentType },
        body: attachment.bytes,
      });
      if (!response.ok) {
        throw new Error(
          `Remote attachment upload failed (${response.status}).`,
        );
      }
      await drive.call("drive.finalizeUpload", {
        path: prepared.path,
        uploadId: prepared.uploadId,
        contentType: prepared.contentType,
        source: "execution-placement",
      });
      uploaded.push(prepared.path);
    }
    return uploaded;
  }
  async startPlacedChat(
    payload: PlacedChatPayload,
    target: PlacedChatTarget,
    onUntaken?: (status: DispatchSummary) => void,
  ) {
    const submitting = this.placements.submitting(payload.conversationId);
    try {
      return await this.submitPlacedChat(payload, target, submitting, onUntaken);
    } finally {
      this.placements.submitted(submitting);
    }
  }
  private async claudeCodeSignedIn(): Promise<boolean> {
    const known = this.claudeCodeLogin;
    if (Date.now() - known.at >= 60_000 && !known.pending) {
      known.pending = (async () => {
        const answer = (await this.options.hostHandlers
          .requestLlmCredentials?.({ operation: "claude-config" })
          .catch(() => undefined)) as { ok?: boolean; signedIn?: boolean } | undefined;
        this.claudeCodeLogin = { signedIn: answer?.ok === true && answer.signedIn === true, at: Date.now() };
      })();
      if (known.at === 0) await known.pending;
    }
    return this.claudeCodeLogin.signedIn;
  }

  private async submitPlacedChat(
    payload: PlacedChatPayload,
    target: PlacedChatTarget,
    submitting: SubmittingPlacement,
    onUntaken?: (status: DispatchSummary) => void,
  ) {
    const enteredAt = Date.now();
    const preparationAt = performance.now();
    await this.syncHostExecutionPlacement();
    const placementReadyMs = Math.round(performance.now() - preparationAt);
    const bridge = this.hostExecutionPlacementBridge;
    if (!bridge?.isRunning) {
      throw new Error("Cross-device execution is not ready on this computer.");
    }
    const idempotencyKey = (
      payload.idempotencyKey?.trim() ||
      payload.userMessageEventId?.trim() ||
      payload.requestId?.trim() ||
      `desktop:${crypto.randomUUID()}`
    ).slice(0, 128);
    const attachmentAt = performance.now();
    const attachments = await this.uploadPlacedAttachments(
      payload,
      idempotencyKey,
    );
    const attachmentsMs = Math.round(performance.now() - attachmentAt);
    const prompt =
      typeof payload.userPrompt === "string" ? payload.userPrompt.trim() : "";
    const context = payload.handoff === true ? undefined : placedChatContext(payload);
    if (!prompt && !context?.text && attachments.length === 0) {
      throw new Error("A prompt is required.");
    }
    const dispatchPayload: DispatchPayload = {
      schemaVersion: 1,
      prompt,
      conversationId: payload.conversationId,
      clientMsgId: idempotencyKey,
      userMessageEventId: payload.userMessageEventId ?? idempotencyKey,
      ...(payload.locale ? { locale: payload.locale } : {}),
      ...(attachments.length ? { attachments } : {}),
      ...(context ? { context } : {}),
      ...(payload.handoff === true ? { handoff: true } : {}),
    };
    const payloadBytes = Buffer.byteLength(canonicalDispatchPayloadJson(dispatchPayload), "utf8");
    if (payloadBytes > DISPATCH_PAYLOAD_MAX_BYTES) {
      throw new PlacedChatTooLargeError(
        `This message is too large to send to where Stella runs (${Math.ceil(payloadBytes / 1024)} KB; the limit is ${DISPATCH_PAYLOAD_MAX_BYTES / 1024} KB). Attach the long text as a file instead.`,
      );
    }
    getFileLogger()?.process("chat.dispatch-prepared", {
      requestId: payload.requestId,
      originUserMessageId: payload.userMessageEventId,
      enteredAt,
      dispatchAt: Date.now(),
      placementReadyMs,
      attachmentsMs,
      preparationMs: Math.round(performance.now() - preparationAt),
      payloadBytes,
    });
    const dispatch = await bridge.submitDesktopExecution({
      idempotencyKey,
      requestedTargetMode: target.mode,
      ...(target.mode === "device"
        ? { requestedExecutorDeviceId: target.deviceId }
        : {}),
      payload: dispatchPayload,
      kind: "chat",
      subject: "portable",
      conversationId: payload.conversationId,
      requiredCapabilities: [
        "chat",
        ...(attachments.length ? ["attachments" as const] : []),
      ],
    });
    if (!dispatch?.dispatchId)
      throw new Error("Execution placement returned an invalid dispatch.");
    this.placements.submitted(submitting, dispatch.dispatchId);
    if (submitting.stopped) void this.stopPlacedDispatches([dispatch.dispatchId]);
    void this.forgetEndedPlacements(payload.conversationId, dispatch.dispatchId);
    const runId = `placed:${dispatch.dispatchId}`;
    const requestId = payload.requestId;
    const userMessageId =
      target.mode === "cloud"
        ? dispatch.dispatchId
        : (payload.userMessageEventId ?? idempotencyKey);
    let terminal = false;
    const placed: PlacedDispatch = {
      dispatchId: dispatch.dispatchId,
      runId,
      requestId,
      conversationId: payload.conversationId,
      userMessageId,
      subscription: null,
    };
    this.placedDispatchByRunId.set(runId, placed);
    const finish = () => {
      if (terminal) return;
      terminal = true;
      placed.subscription?.unsubscribe();
      this.placedDispatchByRunId.delete(runId);
    };
    const onStatus = (status: DispatchSummary | null | undefined) => {
      if (!status || status.dispatchId !== dispatch.dispatchId || terminal)
        return;
      if (isDispatchEnded(status)) {
        this.placements.ended(status.dispatchId);
        finish();
        if (status.state === "failed" || status.state === "blocked") {
          onUntaken?.(status);
        }
        return;
      }
      if (status.state === "reconciliation_required") {
        finish();
        onUntaken?.(status);
        return;
      }
      if (isCloudHandedOff(status)) finish();
    };
    placed.subscription = bridge.watchDispatch(dispatch.dispatchId, onStatus);
    onStatus(dispatch);
    return { runId, userMessageId };
  }
  async healthCheck() {
    const health = await this.getWorkerHealth({ ensureWorker: false });
    return health?.health ?? null;
  }
  async listModels(request: unknown = {}) {
    return await this.requestWorker(
      METHOD_NAMES.INTERNAL_WORKER_LIST_MODELS,
      request,
      { ensureWorker: true, recordActivity: false },
    );
  }
  async switchExecutionDestination(
    params:
      | {
          conversationId?: unknown;
          target?: { mode?: unknown; deviceId?: unknown } | null;
          prompt?: unknown;
          brain?: unknown;
        }
      | null
      | undefined,
  ) {
    const conversationId =
      typeof params?.conversationId === "string"
        ? params.conversationId.trim()
        : "";
    const requested =
      params?.target && typeof params.target === "object"
        ? params.target
        : null;
    if (!conversationId || !requested) {
      return {
        ok: false,
        error: "A conversation and a destination are required.",
      };
    }
    const deviceId =
      typeof requested.deviceId === "string" ? requested.deviceId.trim() : "";
    const target: PlacedChatTarget | { mode: "automatic" } =
      requested.mode === "cloud"
        ? { mode: "cloud" }
        : requested.mode === "device" &&
            deviceId &&
            deviceId !== this.deviceIdentity?.deviceId
          ? { mode: "device", deviceId }
          : { mode: "automatic" };
    const prompt =
      typeof params?.prompt === "string" ? params.prompt.trim() : "";
    if (target.mode !== "automatic") {
      if (!prompt) {
        return {
          ok: false,
          error: "A brief is required to continue at the destination.",
        };
      }
      await this.syncHostExecutionPlacement();
      if (!this.hostExecutionPlacementBridge?.isRunning) {
        return {
          ok: false,
          error:
            "Cross-device execution is not ready on this computer yet. Try again in a moment, or spawn an agent with that destination instead.",
        };
      }
    }
    if (params?.brain !== true) {
      try {
        await this.options.hostHandlers.setExecutionTarget?.({ target });
      } catch (error) {
        console.warn(
          "[execution-destination] the app's destination picker could not be updated.",
          error,
        );
      }
    }
    if (target.mode === "automatic") return { ok: true };
    const handoffId = crypto.randomUUID();
    const placedPayload: PlacedChatPayload = {
      conversationId,
      userPrompt: piBrainHandoffPrompt(
        hostname().trim() || "another computer",
        prompt,
      ),
      requestId: `handoff:${handoffId}`,
      userMessageEventId: `handoff-${handoffId}`,
      storageMode: "cloud",
      handoff: true,
    };
    const previous = this.pendingDestinationHandoffs.get(conversationId);
    if (previous) previous.canceled = true;
    const pending = { canceled: false };
    this.pendingDestinationHandoffs.set(conversationId, pending);
    void (async () => {
      // A moment for the turn that moved it to finish its reply here first.
      await hostRuntime.runPromise(Effect.sleep(DESTINATION_HANDOFF_DELAY_MS));
      if (pending.canceled) return;
      if (this.pendingDestinationHandoffs.get(conversationId) === pending) {
        this.pendingDestinationHandoffs.delete(conversationId);
      }
      await this.startPlacedChat(placedPayload, target);
    })().catch((error) => {
      console.warn(
        "[execution-destination] the hand-off to the new destination failed.",
        error,
      );
    });
    return { ok: true };
  }
  async placePiBrainNote(
    params:
      | {
          conversationId?: unknown;
          target?: { mode?: unknown; deviceId?: unknown } | null;
          prompt?: unknown;
          id?: unknown;
        }
      | null
      | undefined,
  ) {
    const conversationId =
      typeof params?.conversationId === "string"
        ? params.conversationId.trim()
        : "";
    const requested =
      params?.target && typeof params.target === "object"
        ? params.target
        : null;
    const deviceId =
      typeof requested?.deviceId === "string" ? requested.deviceId.trim() : "";
    const target: PlacedChatTarget | null =
      requested?.mode === "cloud"
        ? { mode: "cloud" }
        : requested?.mode === "device" &&
            deviceId &&
            deviceId !== this.deviceIdentity?.deviceId
          ? { mode: "device", deviceId }
          : null;
    const prompt =
      typeof params?.prompt === "string" ? params.prompt.trim() : "";
    const id = typeof params?.id === "string" ? params.id.trim() : "";
    if (!conversationId || !target || !prompt || !id) {
      return {
        ok: false,
        error: "A conversation, another host, a note and its id are required.",
      };
    }
    try {
      await this.startPlacedChat(
        {
          conversationId,
          userPrompt: prompt,
          requestId: id,
          userMessageEventId: id,
          storageMode: "cloud",
          handoff: true,
        },
        target,
      );
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        ...(placementUnavailable(error) ? { unavailable: true } : {}),
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
  async brainTarget(
    conversationId: string,
    storageMode: unknown,
  ): Promise<PlacedChatTarget | null> {
    if (storageMode === "local" || conversationId.startsWith("local_")) {
      return null;
    }
    const brain = await this.requestWorker<PiChatBrainResult>(
      METHOD_NAMES.INTERNAL_WORKER_PI_CHAT,
      { op: "brain", conversationId },
      {
        ensureWorker: true,
        recordActivity: false,
      },
    ).catch(() => null);
    return brain && brain.here === false && brain.target ? brain.target : null;
  }
  private async answerUntakenSend(
    request: Extract<PiChatRequest, { op: "submit" }>,
    send: PiChatSend,
    target: PlacedChatTarget,
    status: DispatchSummary,
  ): Promise<void> {
    const reason =
      status.errorMessage?.trim() ||
      (status.state === "blocked"
        ? "It was not accepted where Stella runs."
        : "It failed where Stella runs.");
    getFileLogger()?.process("chat.placed-untaken", {
      requestId: request.requestId,
      dispatchId: status.dispatchId,
      state: status.state,
      errorCode: status.errorCode,
      target: target.mode,
    });
    const pi = async (body: PiChatRequest) =>
      await this.requestWorker(METHOD_NAMES.INTERNAL_WORKER_PI_CHAT, body, {
        ensureWorker: true,
        recordActivity: false,
      });
    const tell = async (message: string) => {
      await pi({
        op: "sendFailed",
        conversationId: request.conversationId,
        requestId: request.requestId,
        message,
      }).catch(() => undefined);
    };
    if (status.state === "reconciliation_required") {
      await tell(
        "Your message reached the computer Stella runs on, but it went offline before answering. It answers once that computer is back; send it again to have it answered now.",
      );
      return;
    }
    try {
      const known = (await pi({
        op: "journaled",
        conversationId: request.conversationId,
        requestId: request.requestId,
      }).catch(() => undefined)) as { journaled?: boolean } | undefined;
      if (known?.journaled) return;
      const here = await this.brainTarget(request.conversationId, send.storageMode);
      if (!here) {
        await this.requestWorker(
          METHOD_NAMES.INTERNAL_WORKER_PI_CHAT,
          { ...request, send: { ...send, followSender: true } },
          { ensureWorker: true, recordActivity: true },
        );
        return;
      }
      const moved = await this.startPlacedChat(
        {
          conversationId: request.conversationId,
          userPrompt: request.text,
          requestId: request.requestId,
          userMessageEventId: request.requestId,
          idempotencyKey: `${request.requestId}:cloud`.slice(0, 128),
          ...(typeof send.selectedText === "string" ? { selectedText: send.selectedText } : {}),
          ...(send.chatContext && typeof send.chatContext === "object"
            ? { chatContext: send.chatContext }
            : {}),
          ...(Array.isArray(send.attachments) && send.attachments.length
            ? { attachments: send.attachments as RuntimeAttachmentRef[] }
            : {}),
          ...(send.locale ? { locale: send.locale } : {}),
        },
        { mode: "cloud" },
        (ended) =>
          void tell(
            `Your message wasn't delivered: ${reason} Stella's cloud couldn't answer it either (${ended.errorMessage?.trim() || ended.state}).`,
          ),
      );
      await pi({
        op: "sendMoved",
        conversationId: request.conversationId,
        requestId: request.requestId,
        userMessageId: moved.userMessageId,
      });
      void pi({ op: "follow", conversationId: request.conversationId }).catch(() => undefined);
    } catch (error) {
      console.warn("[pi-chat] A send where Stella runs did not take could not be answered elsewhere either.", error);
      await tell(
        `Your message wasn't delivered: ${reason} It couldn't be answered elsewhere either (${error instanceof Error ? error.message : String(error)}).`,
      );
    }
  }
  async sendAgentInput(payload: unknown) {
    return await this.requestWorker(
      METHOD_NAMES.INTERNAL_WORKER_SEND_AGENT_INPUT,
      payload,
      {
        ensureWorker: true,
        recordActivity: true,
      },
    );
  }
  async piChat(request: PiChatRequest) {
    const target =
      request?.op === "submit"
        ? await this.brainTarget(
            request.conversationId,
            request.send?.storageMode,
          )
        : null;
    if (target && request.op === "submit") {
      const submitted = request;
      const send: PiChatSend = request.send ?? {};
      try {
        const placed = await this.startPlacedChat(
          {
            conversationId: request.conversationId,
            userPrompt: request.text,
            requestId: request.requestId,
            userMessageEventId: request.requestId,
            ...(typeof send.selectedText === "string"
              ? { selectedText: send.selectedText }
              : {}),
            ...(send.chatContext && typeof send.chatContext === "object"
              ? { chatContext: send.chatContext }
              : {}),
            ...(Array.isArray(send.attachments) && send.attachments.length
              ? { attachments: send.attachments as RuntimeAttachmentRef[] }
              : {}),
            ...(send.locale ? { locale: send.locale } : {}),
          },
          target,
          (status) => void this.answerUntakenSend(submitted, send, target, status),
        );
        void this.requestWorker(
          METHOD_NAMES.INTERNAL_WORKER_PI_CHAT,
          { op: "follow", conversationId: request.conversationId },
          {
            ensureWorker: true,
            recordActivity: false,
          },
        ).catch(() => undefined);
        return {
          placed: { runId: placed.runId, userMessageId: placed.userMessageId },
        };
      } catch (error) {
        if (target.mode !== "device" && !placementUnavailable(error)) throw error;
        console.warn(
          "[pi-chat] Where Stella runs could not take this message; this computer answers it.",
          error,
        );
        request = { ...request, send: { ...send, followSender: true } };
      }
    }
    if (request?.op === "abort")
      await this.cancelPiPlacements(
        request.conversationId,
        request.dispatchIds,
      );
    return await this.requestWorker(
      METHOD_NAMES.INTERNAL_WORKER_PI_CHAT,
      request,
      {
        ensureWorker: true,
        recordActivity: request?.op === "submit",
      },
    );
  }
  async cancelPiPlacements(conversationId: string, dispatchIds: unknown) {
    const ids = new Set(
      Array.isArray(dispatchIds)
        ? dispatchIds.filter(
            (id): id is string =>
              typeof id === "string" && /^(dsp|exec):/.test(id),
          )
        : [],
    );
    for (const id of this.placements.stop(conversationId)) ids.add(id);
    for (const placed of this.placedDispatchByRunId.values()) {
      if (placed.conversationId === conversationId) ids.add(placed.dispatchId);
    }
    await this.stopPlacedDispatches([...ids]);
  }
  private async stopPlacedDispatches(dispatchIds: readonly string[]) {
    const bridge = this.hostExecutionPlacementBridge;
    if (!bridge) return;
    await Promise.all(
      dispatchIds.map((dispatchId) =>
        bridge
          .cancelDispatch({
            dispatchId,
            cancelRequestId: `cancel:${dispatchId}`,
            reason: "Canceled by the user.",
          })
          .then((status) => {
            if (isDispatchEnded(status)) this.placements.ended(dispatchId);
          })
          .catch((error: unknown) =>
            console.warn(`[placement] Could not stop ${dispatchId}.`, error),
          ),
      ),
    );
  }
  private async forgetEndedPlacements(conversationId: string, except: string) {
    const bridge = this.hostExecutionPlacementBridge;
    if (!bridge) return;
    for (const dispatchId of this.placements.placedIn(conversationId, except)) {
      const status = await bridge.getDispatchStatus(dispatchId).catch(() => undefined);
      if (status !== undefined && isDispatchEnded(status)) this.placements.ended(dispatchId);
    }
  }
  async runAutomationTurn(payload: unknown) {
    return await this.requestWorker<RuntimeAutomationTurnResult>(
      METHOD_NAMES.INTERNAL_WORKER_RUN_AUTOMATION,
      payload,
      {
        ensureWorker: true,
        recordActivity: true,
      },
    );
  }
  async cancelBlockingLocalAgent(
    agentId: string,
    reason: string,
    executionId?: string,
  ) {
    return await this.requestWorker<{ canceled?: boolean } | null>(
      METHOD_NAMES.INTERNAL_WORKER_CANCEL_BLOCKING_AGENT,
      { agentId, reason, ...(executionId ? { executionId } : {}) },
      {
        ensureWorker: true,
        recordActivity: true,
      },
    );
  }
  async cancelPlacementAutomation(runId: string, reason: string) {
    return await this.requestWorker<{ canceled?: boolean } | null>(
      METHOD_NAMES.INTERNAL_WORKER_CANCEL_PLACEMENT_AUTOMATION,
      { runId, reason },
      {
        ensureWorker: true,
        recordActivity: true,
        retryOnceOnDisconnect: false,
      },
    );
  }
  async createBackgroundAgent(payload: unknown) {
    return await this.requestWorker(
      METHOD_NAMES.INTERNAL_WORKER_CREATE_BACKGROUND_AGENT,
      payload,
      {
        ensureWorker: true,
        recordActivity: true,
      },
    );
  }
  async webSearch(query: string, options?: Record<string, unknown>) {
    return await this.requestWorker(
      METHOD_NAMES.INTERNAL_WORKER_WEB_SEARCH,
      { query, ...options },
      {
        ensureWorker: true,
        recordActivity: true,
      },
    );
  }
  async runOneShotCompletion(payload: unknown) {
    return await this.requestWorker(
      METHOD_NAMES.INTERNAL_WORKER_ONE_SHOT_COMPLETION,
      payload,
      {
        ensureWorker: true,
        recordActivity: true,
      },
    );
  }
  async persistVoiceTranscript(payload: unknown) {
    return await this.requestWorker(
      METHOD_NAMES.INTERNAL_WORKER_VOICE_PERSIST_TRANSCRIPT,
      payload,
      {
        ensureWorker: true,
        recordActivity: true,
      },
    );
  }
  async voiceOrchestratorChat(payload: unknown) {
    return await this.requestWorker(
      METHOD_NAMES.INTERNAL_WORKER_VOICE_ORCHESTRATOR_CHAT,
      payload,
      {
        ensureWorker: true,
        recordActivity: true,
      },
    );
  }
  async voiceOrchestratorConfig(payload: unknown) {
    return await this.requestWorker(
      METHOD_NAMES.INTERNAL_WORKER_VOICE_ORCHESTRATOR_CONFIG,
      payload,
      {
        ensureWorker: true,
        recordActivity: true,
      },
    );
  }
  async voiceExecuteTool(payload: unknown) {
    return await this.requestWorker(
      METHOD_NAMES.INTERNAL_WORKER_VOICE_EXECUTE_TOOL,
      payload,
      {
        ensureWorker: true,
        recordActivity: true,
      },
    );
  }
  async getOrCreateDefaultConversationId() {
    return await this.requestWorker(
      METHOD_NAMES.INTERNAL_WORKER_LOCAL_CHAT_GET_OR_CREATE_DEFAULT,
      undefined,
      { ensureWorker: true, recordActivity: false },
    );
  }
  async listLocalChatEvents(payload: unknown) {
    return await this.requestWorker(
      METHOD_NAMES.INTERNAL_WORKER_LOCAL_CHAT_LIST_EVENTS,
      payload,
      { ensureWorker: true, recordActivity: false },
    );
  }
  getCloudSchedules() {
    if (!this.cloudSchedules) {
      this.cloudSchedules = createCloudSchedules({
        getClient: () =>
          this.getConfiguredHostAuthToken()
            ? this.ensureHostBackendClient()
            : null,
        getDeviceId: () => this.deviceIdentity?.deviceId,
      });
    }
    return this.cloudSchedules;
  }
  async listCronJobs() {
    const local = this.schedulerService?.listCronJobs() ?? [];
    const cloud = await this.getCloudSchedules()
      .list()
      .catch(() => []);
    return [...cloud, ...local];
  }
  async addCronJob(input: LocalCronJobCreateInput) {
    if (isCloudSchedulePayload(input.payload)) {
      return await this.getCloudSchedules().add(input);
    }
    return this.ensureScheduler().addCronJob(input);
  }
  async listHeartbeats() {
    return this.ensureScheduler().listHeartbeats();
  }
  async runCronJob(jobId: string) {
    if (isCloudScheduleId(jobId)) {
      return await this.getCloudSchedules().runNow(jobId);
    }
    return this.ensureScheduler().runCronJob(jobId);
  }
  async removeCronJob(jobId: string) {
    if (isCloudScheduleId(jobId)) {
      return await this.getCloudSchedules().remove(jobId);
    }
    return this.ensureScheduler().removeCronJob(jobId);
  }
  async updateCronJob(jobId: string, patch: LocalCronJobUpdatePatch) {
    if (isCloudScheduleId(jobId)) {
      return await this.getCloudSchedules().update(jobId, patch);
    }
    return this.ensureScheduler().updateCronJob(jobId, patch);
  }
  async upsertHeartbeat(input: LocalHeartbeatUpsertInput) {
    return this.ensureScheduler().upsertHeartbeat(input);
  }
  async runHeartbeat(conversationId: string) {
    return this.ensureScheduler().runHeartbeat(conversationId);
  }
  async listConversationEvents(payload: {
    conversationId: string;
    maxItems?: number;
  }) {
    return this.ensureScheduler().listConversationEvents(
      payload.conversationId,
      payload.maxItems,
    );
  }
  async killAllShells() {
    return await this.requestWorker(
      METHOD_NAMES.INTERNAL_WORKER_KILL_ALL_SHELLS,
      undefined,
      { ensureWorker: false, recordActivity: true },
    );
  }
  async collectAllSignals(options: unknown) {
    return await this.requestWorker(
      METHOD_NAMES.INTERNAL_WORKER_DISCOVERY_COLLECT_ALL_SIGNALS,
      options,
      { ensureWorker: true, recordActivity: false },
    );
  }
  async writeCoreMemory(
    content: string,
    options?: { includeLocation?: boolean },
  ) {
    const { writeCoreMemory } = await import("../discovery/browser-data.js");
    await writeCoreMemory(
      this.options.initializeParams.stellaDataDirPath,
      content,
      options,
    );
  }
  async detectPreferredBrowserProfile() {
    const { detectPreferredBrowserProfile } = await import(
      "../discovery/browser-data.js"
    );
    return await detectPreferredBrowserProfile();
  }
  async listBrowserProfiles(browserType: BrowserType) {
    const { listBrowserProfiles } = await import(
      "../discovery/browser-data.js"
    );
    return await listBrowserProfiles(browserType);
  }
  ensureScheduler() {
    if (!this.schedulerService) {
      throw createRuntimeUnavailableError("Local scheduler is not available.");
    }
    return this.schedulerService;
  }
  async initializeHostServices() {
    await this.stopHostServices();
    const identityStartedAt = performance.now();
    this.deviceIdentity = await this.options.hostHandlers.getDeviceIdentity();
    const dbStartedAt = performance.now();
    const HostDatabase = loadSqliteDatabaseCtorSync();
    const hostDatabase = new HostDatabase(
      getDesktopDatabasePath(this.options.initializeParams.stellaDataDirPath),
    );
    const dbInit = initializeDesktopDatabase(hostDatabase);
    getFileLogger()?.process("host.services-init.timing", {
      deviceIdentityMs: Math.round(dbStartedAt - identityStartedAt),
      dbInitMs: Math.round(performance.now() - dbStartedAt),
      dbFromVersion: dbInit.fromVersion,
      dbToVersion: dbInit.toVersion,
      dbMigrated: dbInit.migrated,
    });
    this.hostDatabase = hostDatabase;
    if (this.options.disableLocalScheduler) {
      // Ephemeral hosts (headless CLI, tests) must not run a second
      // scheduler over the same data dir as a live desktop host — a
      // duplicate scheduler could double-fire due cron jobs.
      this.hostReady = true;
      return;
    }
    const showNotificationHandler = this.options.hostHandlers.showNotification;
    const scheduler = new LocalSchedulerService({
      stellaDataDir: this.options.initializeParams.stellaDataDirPath,
      getScriptAuthEnv: async () => {
        const auth = await this.options.hostHandlers.getScheduleScriptAuth?.();
        return createScheduleScriptAuthEnv(
          auth,
          this.getConfiguredHostBackendUrl(),
        );
      },
      runnerTarget: {
        getRunner: () => ({
          runAutomationTurn: async (payload) =>
            await this.requestWorker<RuntimeAutomationTurnResult>(
              METHOD_NAMES.INTERNAL_WORKER_RUN_AUTOMATION,
              payload,
              {
                ensureWorker: true,
                recordActivity: true,
              },
            ),
          startAgent: async ({ conversationId, key, description, prompt }) =>
            await this.createBackgroundAgent({
              conversationId,
              threadId: key,
              description,
              prompt,
            }),
        }),
      },
      ...(showNotificationHandler
        ? {
            showNotification: ({ title, body }) => {
              void showNotificationHandler({ title, body });
            },
          }
        : {}),
    });
    // Reminders and tasks moved to the backend; the local copies are dropped
    // rather than migrated. Watches keep running here.
    for (const job of scheduler.listCronJobs()) {
      if (job.payload.kind !== "watch") scheduler.removeCronJob(job.id);
    }
    scheduler.start();
    this.schedulerService = scheduler;
    this.schedulerSubscription = scheduler.subscribe(() => {
      this.events.emit("schedule-updated", undefined);
    });
    this.resubscribeCloudSchedules();
    this.hostReady = true;
  }
  async stopHostServices() {
    for (const placed of this.placedDispatchByRunId.values()) {
      placed.subscription?.unsubscribe();
    }
    this.placedDispatchByRunId.clear();
    this.placements.clear();
    this.cancelHostExecutionPlacementRetry();
    await this.hostExecutionPlacementSyncQueue;
    await this.hostExecutionPlacementBridge?.stop();
    this.hostExecutionPlacementBridge = null;
    this.hostDatabase?.close();
    this.hostDatabase = null;
    this.disposeHostBackendClient();
    this.hostAccountServicesKey = null;
    this.schedulerSubscription?.();
    this.schedulerSubscription = null;
    this.cloudScheduleUnsubscribe?.();
    this.cloudScheduleUnsubscribe = null;
    this.schedulerService?.stop();
    this.schedulerService = null;
  }
  async googleWorkspaceGetAuthStatus() {
    return await this.requestWorker(
      METHOD_NAMES.INTERNAL_WORKER_GOOGLE_WORKSPACE_AUTH_STATUS,
      undefined,
      {
        ensureWorker: true,
        recordActivity: false,
      },
    );
  }
  async googleWorkspaceConnect() {
    return await this.requestWorker(
      METHOD_NAMES.INTERNAL_WORKER_GOOGLE_WORKSPACE_CONNECT,
      undefined,
      {
        ensureWorker: true,
        recordActivity: true,
        retryOnceOnDisconnect: true,
      },
    );
  }
  async googleWorkspaceDisconnect() {
    return await this.requestWorker(
      METHOD_NAMES.INTERNAL_WORKER_GOOGLE_WORKSPACE_DISCONNECT,
      undefined,
      { ensureWorker: true, recordActivity: true },
    );
  }
  async answerRemoteExecutionRequest(
    params: { allow?: unknown } | null | undefined,
  ) {
    const allow = Boolean(params && params.allow);
    const bridge = this.hostExecutionPlacementBridge;
    if (!bridge) {
      throw new Error("Execution placement is not running on this computer.");
    }
    await bridge.answerRemoteExecutionRequest(allow);
    return { allow };
  }
  buildWorkerInitializationState() {
    return {
      protocolVersion: STELLA_RUNTIME_PROTOCOL_VERSION,
      stellaAppDir: this.options.initializeParams.stellaAppDir,
      stellaDataDirPath: this.options.initializeParams.stellaDataDirPath,
      stellaWorkspacePath: this.options.initializeParams.stellaWorkspacePath,
      authToken: this.configCache.authToken ?? null,
      backendUrl: this.configCache.backendUrl ?? null,
      hasConnectedAccount: this.configCache.hasConnectedAccount ?? false,
      cloudSyncEnabled: this.configCache.cloudSyncEnabled ?? false,
      localLlmCredentialsUpdatedAt:
        this.configCache.localLlmCredentialsUpdatedAt ?? null,
    };
  }
  async requestWorker<TResult = unknown>(
    method: string,
    params: unknown,
    options: WorkerRequestOptions,
  ): Promise<TResult> {
    return await this.workerController.request(async (peer) => {
      const result = await peer.request<TResult>(method, params, options?.rpc);
      this.workerHealthCache = null;
      return result;
    }, options);
  }
  async getWorkerHealth(args: { ensureWorker: boolean }) {
    return await this.workerController.getHealth(args);
  }
  async buildHealthSnapshot() {
    const workerHealth = await this.getWorkerHealth({
      ensureWorker: false,
    }).catch(() => null);
    return {
      ready: this.hostReady,
      hostPid: process.pid,
      workerPid: workerHealth?.pid ?? null,
      workerRunning:
        this.workerController.getState() === "running" ||
        this.workerController.getState() === "starting",
      workerGeneration: this.workerGeneration,
      deviceId: workerHealth?.deviceId ?? this.deviceIdentity?.deviceId ?? null,
      ...(this.hasPendingWorkerRestartIntent() || this.restartInProgress
        ? { pendingWorkerRestart: true }
        : {}),
      busy: workerHealth?.piBusy === true,
    };
  }
  fenceWorkerPeer(peer: JsonRpcPeer): WorkerPeerRegistrar {
    const isLive = () => this.workerController.getConnection()?.peer === peer;
    const generation = this.workerGeneration + 1;
    const noteDrop = (kind: string, method: string) => {
      this.staleWorkerFrameDrops += 1;
      getFileLogger()?.process("host.stale-worker-frame-dropped", {
        kind,
        method,
        generation,
        currentGeneration: this.workerGeneration,
        totalDropped: this.staleWorkerFrameDrops,
      });
    };
    return {
      registerRequestHandler: (method, handler) => {
        peer.registerRequestHandler(method, async (params) => {
          if (!isLive()) {
            noteDrop("request", method);
            throw createRuntimeUnavailableError(
              "This runtime worker connection was replaced; the request was dropped.",
            );
          }
          return await handler(params);
        });
      },
      registerNotificationHandler: (method, handler) => {
        peer.registerNotificationHandler(method, (params) => {
          if (!isLive()) {
            noteDrop("notification", method);
            return;
          }
          return handler(params);
        });
      },
    };
  }
  registerHostHandlers(peer: WorkerPeerRegistrar) {
    peer.registerRequestHandler(
      METHOD_NAMES.HOST_DEVICE_IDENTITY_GET,
      async () => {
        if (!this.deviceIdentity) {
          this.deviceIdentity =
            await this.options.hostHandlers.getDeviceIdentity();
        }
        return this.deviceIdentity;
      },
    );
    peer.registerRequestHandler(
      METHOD_NAMES.HOST_RUNTIME_AUTH_REFRESH,
      async (params) => {
        return (
          (await this.options.hostHandlers.requestRuntimeAuthRefresh?.(
            params,
          )) ?? {
            authenticated: false,
            token: null,
            hasConnectedAccount: false,
            reason: "signed_out",
          }
        );
      },
    );
    peer.registerRequestHandler(HOST_CHALLENGE_TOKEN_METHOD, async () => {
      return (await this.options.hostHandlers.getChallengeToken?.()) ?? null;
    });
    peer.registerRequestHandler(HOST_DEVICE_SIGNING_METHOD, async (params) => {
      const input = typeof params?.input === "string" ? params.input : "";
      if (!input || input.length > MAX_DEVICE_SIGNING_INPUT_LENGTH) {
        throw new Error("Invalid Stella device signing input.");
      }
      if (!isDelegatedDeviceSigningInput(input)) {
        throw new Error(
          "Blocked device signing input outside the DPoP contract.",
        );
      }
      if (!this.options.hostHandlers.signDeviceInput) {
        throw new Error("Stella device signing is not available.");
      }
      return await this.options.hostHandlers.signDeviceInput(input);
    });
    peer.registerRequestHandler(
      METHOD_NAMES.HOST_ASK_USER_REQUEST,
      async (params) => {
        return await this.options.hostHandlers.askUser(params);
      },
    );
    peer.registerRequestHandler(
      METHOD_NAMES.HOST_ASK_USER_CANCEL,
      async (params) => {
        if (!this.options.hostHandlers.cancelUserAsk) return { ok: false };
        return await this.options.hostHandlers.cancelUserAsk(params);
      },
    );
    peer.registerRequestHandler(
      METHOD_NAMES.HOST_SECURE_INPUT_REQUEST,
      async (params) => {
        return await this.options.hostHandlers.requestSecureInput(params);
      },
    );
    peer.registerRequestHandler(
      METHOD_NAMES.HOST_SECURE_VALUE_USE,
      async (params) => {
        return await this.options.hostHandlers.useSecureValue(params);
      },
    );
    peer.registerRequestHandler(
      METHOD_NAMES.HOST_SECURE_VALUE_REVEAL_FOR_FILL,
      async (params) => {
        if (!this.options.hostHandlers.revealSecureValueForFill) {
          return {
            ok: false,
            error: "This computer cannot fill stored values into a browser.",
          };
        }
        return await this.options.hostHandlers.revealSecureValueForFill(params);
      },
    );
    peer.registerRequestHandler(
      METHOD_NAMES.HOST_SECURE_VALUE_FINGERPRINTS,
      async () => {
        if (!this.options.hostHandlers.getSecureValueFingerprints) {
          return { baseA: 1, baseB: 1, windows: [] };
        }
        return await this.options.hostHandlers.getSecureValueFingerprints();
      },
    );
    peer.registerRequestHandler(
      METHOD_NAMES.HOST_LLM_CREDENTIALS_REQUEST,
      async (params) => {
        if (!this.options.hostHandlers.requestLlmCredentials) {
          return { ok: false, reason: "unsupported" };
        }
        return await this.options.hostHandlers.requestLlmCredentials(params);
      },
    );
    peer.registerRequestHandler(
      METHOD_NAMES.HOST_CONNECTOR_TOKEN_STORE_REQUEST,
      async (params) => {
        if (!this.options.hostHandlers.requestConnectorTokenStore) {
          return { ok: false, reason: "unsupported" };
        }
        return await this.options.hostHandlers.requestConnectorTokenStore(
          params,
        );
      },
    );
    peer.registerRequestHandler(
      METHOD_NAMES.HOST_CONNECTOR_CREDENTIAL_REQUEST,
      async (params) => {
        if (!this.options.hostHandlers.requestConnectorCredential) {
          return { ok: false, reason: "unsupported" };
        }
        return await this.options.hostHandlers.requestConnectorCredential(
          params,
        );
      },
    );
    peer.registerRequestHandler(
      METHOD_NAMES.HOST_EXECUTION_DESTINATION_SWITCH,
      async (params) => {
        return await this.switchExecutionDestination(params);
      },
    );
    peer.registerRequestHandler(
      METHOD_NAMES.HOST_PI_BRAIN_NOTE,
      async (params) => {
        return await this.placePiBrainNote(params);
      },
    );
    peer.registerRequestHandler(
      METHOD_NAMES.HOST_CONNECTOR_CONNECT_REQUEST,
      async (params) => {
        if (!this.options.hostHandlers.requestConnectorConnection) {
          return { ok: false, reason: "unsupported" };
        }
        return await this.options.hostHandlers.requestConnectorConnection(
          params,
        );
      },
    );
    peer.registerRequestHandler(
      METHOD_NAMES.HOST_CONNECTOR_CONNECT_CANCEL,
      async (params) => {
        if (!this.options.hostHandlers.cancelConnectorConnection) {
          return { ok: false };
        }
        const offerId =
          params && typeof params === "object"
            ? String(params.offerId ?? "")
            : "";
        if (!offerId) return { ok: false };
        return await this.options.hostHandlers.cancelConnectorConnection({
          offerId,
        });
      },
    );
    peer.registerRequestHandler(
      METHOD_NAMES.HOST_BROWSER_EXTENSION_CONNECT_REQUEST,
      async (params) => {
        if (!this.options.hostHandlers.requestBrowserExtensionConnect) {
          return { ok: false, reason: "unsupported" };
        }
        return await this.options.hostHandlers.requestBrowserExtensionConnect(
          params,
        );
      },
    );
    peer.registerRequestHandler(
      METHOD_NAMES.HOST_DISPLAY_UPDATE,
      async (params) => {
        await this.options.hostHandlers.displayUpdate(
          parseDisplayUpdateParams(params),
        );
        return { ok: true };
      },
    );
    peer.registerRequestHandler(
      METHOD_NAMES.HOST_NOTIFICATION_SHOW,
      async (params) => {
        await this.options.hostHandlers.showNotification?.(params);
        return { ok: true };
      },
    );
    peer.registerRequestHandler(
      METHOD_NAMES.HOST_SYSTEM_REQUEST_PERMISSION,
      async (params) => {
        const kind = String(params ?? "");
        if (kind !== "accessibility" && kind !== "screen") {
          return {
            granted: false,
            alreadyGranted: false,
            reason: "unsupported",
          };
        }
        if (!this.options.hostHandlers.requestDesktopPermission) {
          return {
            granted: false,
            alreadyGranted: false,
            reason: "unsupported",
          };
        }
        return await this.options.hostHandlers.requestDesktopPermission(kind);
      },
    );
    peer.registerRequestHandler(
      METHOD_NAMES.HOST_COMPUTER_USE_SPAWN_AUTOMATION_DAEMON,
      async (params) => {
        if (!this.options.hostHandlers.spawnAutomationDaemon) {
          return { ok: false, reason: "unsupported" };
        }
        return await this.options.hostHandlers.spawnAutomationDaemon(
          params && typeof params === "object" ? params : {},
        );
      },
    );
    peer.registerRequestHandler(
      METHOD_NAMES.HOST_SYSTEM_OPEN_EXTERNAL,
      async (params) => {
        await this.options.hostHandlers.openExternal?.(String(params ?? ""));
        return { ok: true };
      },
    );
    peer.registerRequestHandler(METHOD_NAMES.HOST_WINDOW_SHOW, async () => {
      await this.options.hostHandlers.showWindow?.();
      return { ok: true };
    });
    peer.registerRequestHandler(METHOD_NAMES.HOST_WINDOW_FOCUS, async () => {
      await this.options.hostHandlers.focusWindow?.();
      return { ok: true };
    });
    peer.registerRequestHandler(
      METHOD_NAMES.INTERNAL_SCHEDULE_LIST_CRON_JOBS,
      async () => await this.listCronJobs(),
    );
    peer.registerRequestHandler(
      METHOD_NAMES.INTERNAL_SCHEDULE_LIST_HEARTBEATS,
      async () => await this.listHeartbeats(),
    );
    peer.registerRequestHandler(
      METHOD_NAMES.INTERNAL_SCHEDULE_ADD_CRON_JOB,
      async (params) => await this.addCronJob(params),
    );
    peer.registerRequestHandler(
      METHOD_NAMES.INTERNAL_SCHEDULE_UPDATE_CRON_JOB,
      async (params) => {
        const payload = params;
        return await this.updateCronJob(payload.jobId, payload.patch);
      },
    );
    peer.registerRequestHandler(
      METHOD_NAMES.INTERNAL_SCHEDULE_REMOVE_CRON_JOB,
      async (params) => await this.removeCronJob(params.jobId),
    );
    peer.registerRequestHandler(
      METHOD_NAMES.INTERNAL_SCHEDULE_RUN_CRON_JOB,
      async (params) => await this.runCronJob(params.jobId),
    );
    peer.registerRequestHandler(
      METHOD_NAMES.INTERNAL_SCHEDULE_GET_HEARTBEAT_CONFIG,
      async (params) =>
        await this.ensureScheduler().getHeartbeatConfig(params.conversationId),
    );
    peer.registerRequestHandler(
      METHOD_NAMES.INTERNAL_SCHEDULE_UPSERT_HEARTBEAT,
      async (params) => await this.ensureScheduler().upsertHeartbeat(params),
    );
    peer.registerRequestHandler(
      METHOD_NAMES.INTERNAL_SCHEDULE_RUN_HEARTBEAT,
      async (params) =>
        await this.ensureScheduler().runHeartbeat(params.conversationId),
    );
  }
  registerNotifications(peer: WorkerPeerRegistrar) {
    peer.registerNotificationHandler(
      NOTIFICATION_NAMES.RUNTIME_READY,
      (params) => {
        this.events.emit("runtime-ready", params);
      },
    );
    peer.registerNotificationHandler(
      NOTIFICATION_NAMES.RUNTIME_RELOADING,
      (params) => {
        this.events.emit("runtime-reloading", params);
      },
    );
    peer.registerNotificationHandler(
      NOTIFICATION_NAMES.RUNTIME_LAGGED,
      (params) => {
        this.events.emit("runtime-lagged", params);
      },
    );
    peer.registerNotificationHandler(
      NOTIFICATION_NAMES.VOICE_AGENT_EVENT,
      (params) => {
        this.events.emit("voice-agent-event", params);
      },
    );
    peer.registerNotificationHandler(
      NOTIFICATION_NAMES.LOCAL_CHAT_UPDATED,
      (params) => {
        const payload = params;
        this.events.emit("local-chat-updated", payload);
      },
    );
    peer.registerNotificationHandler(
      NOTIFICATION_NAMES.PI_CHAT_EVENTS,
      (params) => {
        this.events.emit("pi-chat-events", params);
      },
    );
    peer.registerNotificationHandler(
      NOTIFICATION_NAMES.THREAD_TRANSCRIPT_UPDATED,
      (params) => {
        this.events.emit("thread-transcript-updated", params);
      },
    );
    peer.registerNotificationHandler(
      NOTIFICATION_NAMES.SCHEDULE_UPDATED,
      () => {
        this.events.emit("schedule-updated", undefined);
      },
    );
    peer.registerNotificationHandler(
      NOTIFICATION_NAMES.MODEL_CATALOG_UPDATED,
      (params) => {
        this.events.emit("model-catalog-updated", params);
      },
    );
  }
}
const resolveDefaultWorkerEntryPath = (
  options: Pick<StellaRuntimeHostOptions, "workerEntryPath">,
) => {
  if (options.workerEntryPath) {
    return options.workerEntryPath;
  }
  return resolveBundledRuntimeFile("worker/entry.js");
};
