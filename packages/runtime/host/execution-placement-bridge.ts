import {
  AGENT_STOPPED_ERROR_CODE,
  AGENT_STOPPED_REASON,
  isAgentStopReason,
} from "@stella/contracts/agent-status";
import { socketCredentialProtocol } from "@stella/contracts/socket-ticket";
import { createHash } from "node:crypto";
import type { BackendClient } from "@stella/contracts/backend/client";
import {
  SOCKET_KEEPALIVE_PING,
  SOCKET_KEEPALIVE_PONG,
} from "@stella/contracts/backend/protocol";
import WebSocket from "ws";
import {
  DEVICE_PRESENCE_PING_INTERVAL_MS,
  DEVICE_PRESENCE_PROOF_PREFIX,
  DEVICE_PRESENCE_PROTOCOL_VERSION,
  DEVICE_PRESENCE_SUBPROTOCOL,
  DEVICE_TERMINAL_RESULT_MAX_BYTES,
  DISPATCH_OFFER_WINDOW_MS,
  DISPATCH_SUBMIT_PATH,
  PLACEMENT_PROTOCOL,
  TERMINAL_DISPATCH_STATES,
  devicePresencePath,
  dispatchCancelPath,
  dispatchPath,
  executionDeviceRegistration,
  type AgentMessageDeviceOutcome,
  type AgentStopDeviceOutcome,
  type DeviceAvailability,
  type DevicePresenceDeviceFrame,
  type DevicePresenceServerFrame,
  type DispatchPayload,
  type DispatchSummary,
  type ExecutionCapability,
  type ExecutionKind,
  type ExecutionSubject,
  type ExecutionTargetMode,
} from "@stella/contracts/turn-plane/placement";
import { canonicalDispatchPayloadJson } from "@stella/contracts/turn-plane/pairing-proof";
import { getFileLogger } from "../observability/file-logger.js";
import {
  DeviceRequestServer,
  type ServeDeviceRequest,
} from "./device-request-server.js";
import type { SqliteDatabase } from "../kernel/storage/shared.js";
import {
  ExecutionPlacementInbox,
  type ExecutionPlacementInboxRow,
} from "./execution-placement-inbox.js";
import {
  CANCELLATION_MAX_ATTEMPTS,
  ExecutionPlacementLeases,
} from "./execution-placement-leases.js";

export { ExecutionPlacementInbox };
import {
  forkDelayed,
  forkInterval,
  type HostTimerHandle,
} from "./effect-runtime.js";

const CLAIM_RESPONSE_TIMEOUT_MS = DISPATCH_OFFER_WINDOW_MS + 1_000;
const COMPLETE_ACK_TIMEOUT_MS = 10_000;
const TOKEN_REFRESH_MARGIN_MS = 60_000;
const MIN_TOKEN_REFRESH_DELAY_MS = 30_000;
const HTTP_TIMEOUT_MS = 15_000;
const CANCELLATION_RPC_TIMEOUT_MS = 60_000;
const DISPATCH_WATCH_POLL_MS = 750;
const DEVICE_PRESENCE_SILENCE_MS = 3 * DEVICE_PRESENCE_PING_INTERVAL_MS + 2_000;

type PlacementKind = ExecutionKind;
type PlacementCapability = ExecutionCapability;
type PlacementSubject = ExecutionSubject;

export type ExecutionPlacementDesktopSubmit = {
  idempotencyKey: string;
  kind: PlacementKind;
  subject: PlacementSubject;
  conversationId: string;
  parentTurnId?: string;
  threadId?: string;
  requestedTargetMode: ExecutionTargetMode;
  requestedExecutorDeviceId?: string;
  requiredCapabilities: PlacementCapability[];
  payload: DispatchPayload;
};

export type ExecutionPlacementAvailability = DeviceAvailability;

const remoteCancellation = (
  remote: Pick<DispatchSummary, "cancelReason"> | null | undefined,
): { errorCode?: string; errorMessage: string } =>
  isAgentStopReason(remote?.cancelReason)
    ? { errorCode: AGENT_STOPPED_ERROR_CODE, errorMessage: AGENT_STOPPED_REASON }
    : { errorMessage: "Canceled by the user." };

export type ExecutionPlacementRunResult = {
  status: "ok" | "error" | "canceled";
  stopped?: boolean;
  finalText?: string;
  error?: string;
};

export type ExecutionPlacementClient = Pick<BackendClient, "call">;

export type ExecutionPlacementSocket = {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate?(): void;
  on(event: "open", listener: () => void): unknown;
  on(event: "message", listener: (data: unknown) => void): unknown;
  on(
    event: "close",
    listener: (code: number, reason: unknown) => void,
  ): unknown;
  on(event: "error", listener: (error: unknown) => void): unknown;
};

type DeviceIdentity = {
  deviceId: string;
  publicKey: string;
};

type PlacementBridgeOptions = {
  client: ExecutionPlacementClient;
  database: SqliteDatabase;
  deviceIdentity: DeviceIdentity;
  signPresenceProof: (message: string) => Promise<string>;
  appVersion: string;
  deviceName?: string;
  platform?: string;
  getAuthToken?: () => string | null;
  getAvailability: () =>
    | ExecutionPlacementAvailability
    | Promise<ExecutionPlacementAvailability>;
  runExecution: (args: {
    dispatch: DispatchSummary;
    payload: Record<string, unknown>;
    ownerGeneration: string;
  }) => Promise<ExecutionPlacementRunResult>;
  cancelExecution: (args: {
    dispatchId: string;
    kind: PlacementKind;
    conversationId: string;
    payload?: Record<string, unknown>;
    stopped?: boolean;
  }) => Promise<void>;
  steerExecution?: (args: {
    dispatchId: string;
    payload: Record<string, unknown>;
    messageId: string;
    text: string;
  }) => Promise<boolean>;
  deliverAgentMessage?: (args: {
    threadId: string;
    messageId: string;
    text: string;
    ownerGeneration: string;
  }) => Promise<AgentMessageDeviceOutcome>;
  stopLocalAgent?: (args: {
    threadId: string;
    ownerGeneration: string;
  }) => Promise<AgentStopDeviceOutcome>;
  onRemoteExecutionRequest?: (request: {
    requestedAt: number;
    requesterLabel?: string;
  }) => void;
  serveDeviceRequest?: ServeDeviceRequest;
  log?: (level: "warn" | "error", message: string, error?: unknown) => void;
  now?: () => number;
  leaseRenewalGraceMs?: number;
  claimAckRetryBaseMs?: number;
  createSocket?: (url: string, protocols: string[]) => ExecutionPlacementSocket;
  fetch?: typeof fetch;
};

const sha256 = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");

export const placementLocalAgentThreadId = (dispatchId: string) =>
  `placement-agent:${sha256(dispatchId).slice(0, 32)}`;

export const placementLocalChatRunId = (dispatchId: string) =>
  `placement-chat:${sha256(dispatchId).slice(0, 32)}`;

const parseRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Execution placement returned an invalid object.");
  }
  return value as Record<string, unknown>;
};

const parseDispatch = (value: unknown): DispatchSummary => {
  const row = parseRecord(value);
  if (
    typeof row.dispatchId !== "string" ||
    (row.kind !== "chat" && row.kind !== "agent") ||
    typeof row.conversationId !== "string" ||
    typeof row.state !== "string"
  ) {
    throw new Error("Execution placement returned an invalid dispatch.");
  }
  return row as unknown as DispatchSummary;
};

const isTerminalState = (state: string) =>
  (TERMINAL_DISPATCH_STATES as readonly string[]).includes(state);

const utf8Bytes = (value: string) => Buffer.byteLength(value, "utf8");

const fitWithinBytes = (
  value: string,
  render: (text: string, omittedChars: number) => string,
): string => {
  if (utf8Bytes(render(value, 0)) <= DEVICE_TERMINAL_RESULT_MAX_BYTES) {
    return render(value, 0);
  }
  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = render(value.slice(0, mid), value.length - mid);
    if (utf8Bytes(candidate) <= DEVICE_TERMINAL_RESULT_MAX_BYTES) low = mid;
    else high = mid - 1;
  }
  return render(value.slice(0, low), value.length - low);
};

const withOmissionNote = (text: string, omittedChars: number) =>
  omittedChars > 0
    ? `${text}\n\n[Report shortened for delivery: ${omittedChars} more characters exceeded the ${DEVICE_TERMINAL_RESULT_MAX_BYTES}-byte terminal record limit.]`
    : text;

const boundedResult = (value: string | undefined) =>
  value ? fitWithinBytes(value, withOmissionNote) : undefined;

const terminalResultJson = (finalText: string) =>
  fitWithinBytes(finalText, (text, omittedChars) =>
    JSON.stringify({ finalText: withOmissionNote(text, omittedChars) }),
  );

const isOwnerLifecycleFenceError = (error: unknown) => {
  const record =
    error && typeof error === "object"
      ? (error as {
          code?: unknown;
          data?: { code?: unknown };
          message?: unknown;
        })
      : undefined;
  const code = record?.data?.code ?? record?.code;
  const message =
    typeof record?.message === "string"
      ? record.message
      : error instanceof Error
        ? error.message
        : String(error);
  return (
    code === "owner_purged" ||
    code === "generation_stale" ||
    code === "OWNER_DATA_PURGE_ACTIVE" ||
    code === "OWNER_DATA_GENERATION_STALE" ||
    message.includes("owner_purged") ||
    message.includes("generation_stale") ||
    message.includes("OWNER_DATA_PURGE_ACTIVE") ||
    message.includes("OWNER_DATA_GENERATION_STALE")
  );
};

export class PlacementRouteError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryable: boolean;
  constructor(args: {
    code: string;
    status: number;
    message: string;
    retryable: boolean;
  }) {
    super(args.message);
    this.name = "PlacementRouteError";
    this.code = args.code;
    this.status = args.status;
    this.retryable = args.retryable;
  }
}

const socketOriginOf = (builderOrigin: string) =>
  builderOrigin.replace(/^http/u, "ws");

const jwtExpiryMs = (token: string): number | null => {
  const segments = token.split(".");
  if (segments.length < 2 || !segments[1]) return null;
  try {
    const claims = JSON.parse(
      Buffer.from(segments[1], "base64url").toString("utf8"),
    ) as { exp?: unknown };
    return typeof claims.exp === "number" && Number.isFinite(claims.exp)
      ? claims.exp * 1000
      : null;
  } catch {
    return null;
  }
};

type PendingFrameWait<T> = {
  resolve: (value: T) => void;
  reject: (error: Error) => void;
  timer: HostTimerHandle;
};

export type DispatchWatchHandle = { unsubscribe(): void };

type ServerFrameHandlers = {
  [Type in Exclude<DevicePresenceServerFrame["type"], "challenge">]: (
    frame: Extract<DevicePresenceServerFrame, { type: Type }>,
    socket: ExecutionPlacementSocket,
  ) => void | Promise<void>;
};

export class ExecutionPlacementBridge {
  readonly client: ExecutionPlacementClient;
  private readonly inbox: ExecutionPlacementInbox;
  private readonly fetchImpl: typeof fetch;
  private openingSocket = false;
  private readonly leases: ExecutionPlacementLeases;
  private ownerId: string | null = null;
  private ownerGeneration: string | null = null;
  private builderOrigin: string | null = null;
  private presenceSessionId: string | null = null;
  private sessionReady = false;
  private started = false;
  private stopped = false;
  private lifecycleEpoch = 0;
  private socket: ExecutionPlacementSocket | null = null;
  private socketProven = false;
  private pendingConsent: boolean | null = null;
  private socketPingTimer: HostTimerHandle | null = null;
  private socketHeardAt = 0;
  private socketTokenTimer: HostTimerHandle | null = null;
  private advertisedAvailability = "";
  private stopTask: Promise<void> | null = null;
  private readonly offerTasks = new Set<Promise<void>>();
  private readonly offersInFlight = new Set<string>();
  private readonly executing = new Set<string>();
  private readonly executionTasks = new Map<string, Promise<void>>();
  private readonly terminalFlushes = new Map<string, Promise<void>>();
  private readonly pendingClaims = new Map<string, PendingFrameWait<number>>();
  private readonly pendingCompletes = new Map<
    string,
    PendingFrameWait<DispatchSummary>
  >();
  private readonly dispatchWatchers = new Map<
    string,
    Set<(dispatch: DispatchSummary) => void>
  >();

  private readonly deviceRequests: DeviceRequestServer;

  constructor(private readonly options: PlacementBridgeOptions) {
    this.client = options.client;
    this.inbox = new ExecutionPlacementInbox(options.database);
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.leases = new ExecutionPlacementLeases({
      now: () => this.now(),
      leaseRenewalGraceMs: options.leaseRenewalGraceMs,
      claimAckRetryBaseMs: options.claimAckRetryBaseMs,
    });
    this.deviceRequests = new DeviceRequestServer({
      serve: options.serveDeviceRequest,
      send: (frame) => this.send(frame),
      log: (message, error) => this.log("warn", message, error),
    });
  }

  get isRunning() {
    return this.started && !this.stopped;
  }

  get ownerGateOrigin(): string | null {
    return this.builderOrigin;
  }

  private now() {
    return (this.options.now ?? Date.now)();
  }

  private log(level: "warn" | "error", message: string, error?: unknown) {
    this.options.log?.(level, message, error);
  }

  private requireSession() {
    if (!this.ownerId || !this.ownerGeneration || !this.presenceSessionId) {
      throw new Error("Execution placement session is not initialized.");
    }
    return {
      ownerId: this.ownerId,
      ownerGeneration: this.ownerGeneration,
      presenceSessionId: this.presenceSessionId,
    };
  }

  private requireOwnerGate() {
    const origin = this.builderOrigin;
    if (!origin) {
      throw new Error("Execution placement owner gate is unavailable.");
    }
    return origin;
  }

  private isLiveEpoch(epoch: number) {
    return this.started && !this.stopped && epoch === this.lifecycleEpoch;
  }

  private async ownerGateRequest(
    path: string,
    init: { method: "GET" | "POST"; body?: unknown },
  ): Promise<Response> {
    const origin = this.requireOwnerGate();
    const token = this.options.getAuthToken?.()?.trim();
    if (!token) {
      throw new PlacementRouteError({
        code: "unauthorized",
        status: 0,
        message: "This computer is not signed in to Stella.",
        retryable: true,
      });
    }
    return await this.fetchImpl(`${origin}${path}`, {
      method: init.method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(init.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
  }

  private async throwRouteError(response: Response): Promise<never> {
    let code = "internal";
    let message = `The owner gate refused this request (${response.status}).`;
    let retryable = response.status >= 500 || response.status === 429;
    try {
      const body = (await response.json()) as {
        error?: { code?: unknown; message?: unknown; retryable?: unknown };
      } | null;
      const error = body?.error;
      if (error && typeof error === "object") {
        if (typeof error.code === "string") code = error.code;
        if (typeof error.message === "string" && error.message.trim()) {
          message = error.message.trim();
        }
        if (typeof error.retryable === "boolean") retryable = error.retryable;
      }
    } catch {
      // A terse body keeps the status-derived defaults.
    }
    throw new PlacementRouteError({
      code,
      status: response.status,
      message,
      retryable,
    });
  }

  async submitDesktopExecution(
    args: ExecutionPlacementDesktopSubmit,
  ): Promise<DispatchSummary> {
    if (!this.isRunning || !this.sessionReady) {
      throw new Error("Execution placement is not ready on this computer.");
    }
    const requestedExecutorDeviceId =
      args.requestedExecutorDeviceId?.trim() || undefined;
    const requiredCapabilities = [
      ...new Set<PlacementCapability>([
        args.kind,
        ...args.requiredCapabilities,
      ]),
    ].sort();
    const body = {
      protocol: PLACEMENT_PROTOCOL,
      idempotencyKey: args.idempotencyKey.trim(),
      kind: args.kind,
      ingress: "desktop" as const,
      subject: args.subject,
      targetMode: args.requestedTargetMode,
      ...(requestedExecutorDeviceId
        ? { targetDeviceId: requestedExecutorDeviceId }
        : {}),
      requestingDeviceId: this.options.deviceIdentity.deviceId,
      conversationId: args.conversationId.trim(),
      ...(args.parentTurnId?.trim()
        ? { parentTurnId: args.parentTurnId.trim() }
        : {}),
      ...(args.threadId?.trim() ? { threadId: args.threadId.trim() } : {}),
      requiredCapabilities,
      payload: args.payload,
    };
    const requestAt = Date.now();
    const requestStarted = performance.now();
    const response = await this.ownerGateRequest(DISPATCH_SUBMIT_PATH, {
      method: "POST",
      body,
    });
    if (!response.ok) await this.throwRouteError(response);
    const dispatch = parseDispatch(parseRecord(await response.json()).dispatch);
    getFileLogger()?.process("chat.dispatch-response", {
      originUserMessageId: args.payload.userMessageEventId,
      dispatchId: dispatch.dispatchId,
      requestAt,
      responseMs: Math.round(performance.now() - requestStarted),
    });
    this.notifyDispatchWatchers(dispatch);
    await this.adoptCommittedDispatch(dispatch, args.payload);
    return dispatch;
  }

  async getDispatchStatus(dispatchId: string): Promise<DispatchSummary | null> {
    const response = await this.ownerGateRequest(dispatchPath(dispatchId), {
      method: "GET",
    });
    if (response.status === 404) return null;
    if (!response.ok) await this.throwRouteError(response);
    const dispatch = parseDispatch(parseRecord(await response.json()).dispatch);
    this.notifyDispatchWatchers(dispatch);
    return dispatch;
  }

  async cancelDispatch(args: {
    dispatchId: string;
    cancelRequestId: string;
    reason?: string;
  }): Promise<DispatchSummary> {
    const response = await this.ownerGateRequest(
      dispatchCancelPath(args.dispatchId),
      {
        method: "POST",
        body: {
          protocol: PLACEMENT_PROTOCOL,
          cancelRequestId: args.cancelRequestId,
          ...(args.reason ? { reason: args.reason } : {}),
        },
      },
    );
    if (!response.ok) await this.throwRouteError(response);
    const dispatch = parseDispatch(parseRecord(await response.json()).dispatch);
    this.notifyDispatchWatchers(dispatch);
    return dispatch;
  }

  watchDispatch(
    dispatchId: string,
    onStatus: (dispatch: DispatchSummary) => void,
  ): DispatchWatchHandle {
    let active = true;
    const listeners =
      this.dispatchWatchers.get(dispatchId) ??
      new Set<(dispatch: DispatchSummary) => void>();
    const listener = (dispatch: DispatchSummary) => {
      if (active) onStatus(dispatch);
    };
    listeners.add(listener);
    this.dispatchWatchers.set(dispatchId, listeners);
    const poll = forkInterval(DISPATCH_WATCH_POLL_MS, () => {
      if (!active) return;
      void this.getDispatchStatus(dispatchId)
        .then((dispatch) => {
          if (dispatch && isTerminalState(dispatch.state)) handle.unsubscribe();
        })
        .catch(() => undefined);
    });
    const handle: DispatchWatchHandle = {
      unsubscribe: () => {
        if (!active) return;
        active = false;
        poll.cancel();
        const current = this.dispatchWatchers.get(dispatchId);
        current?.delete(listener);
        if (current && current.size === 0) {
          this.dispatchWatchers.delete(dispatchId);
        }
      },
    };
    return handle;
  }

  private notifyDispatchWatchers(dispatch: DispatchSummary) {
    const listeners = this.dispatchWatchers.get(dispatch.dispatchId);
    if (!listeners) return;
    for (const listener of [...listeners]) {
      try {
        listener(dispatch);
      } catch (error) {
        this.log("warn", "A dispatch status observer failed.", error);
      }
    }
  }

  private sendKeepalive(): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1 || !this.socketProven) return;
    try {
      socket.send(SOCKET_KEEPALIVE_PING);
    } catch (error) {
      this.log("warn", "A device presence keepalive could not be sent.", error);
    }
  }

  private send(frame: DevicePresenceDeviceFrame): boolean {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1) return false;
    if (
      frame.type !== "begin" &&
      frame.type !== "proof" &&
      !this.socketProven
    ) {
      return false;
    }
    try {
      socket.send(JSON.stringify(frame));
      return true;
    } catch (error) {
      this.log("warn", "A device presence frame could not be sent.", error);
      return false;
    }
  }

  private closeSocket(code = 1000, reason = "desktop_stopped") {
    this.leases.cancelReconnect();
    this.socketPingTimer?.cancel();
    this.socketPingTimer = null;
    this.socketTokenTimer?.cancel();
    this.socketTokenTimer = null;
    const socket = this.socket;
    this.socket = null;
    this.socketProven = false;
    this.advertisedAvailability = "";
    if (socket && socket.readyState < 2) socket.close(code, reason);
  }

  private scheduleReconnect() {
    if (
      this.stopped ||
      !this.started ||
      !this.sessionReady ||
      !this.builderOrigin
    ) {
      return;
    }
    this.leases.scheduleReconnect(() => this.openSocket());
  }

  private openSocket() {
    if (
      this.stopped ||
      !this.started ||
      !this.sessionReady ||
      !this.builderOrigin ||
      this.socket ||
      this.openingSocket
    ) {
      return;
    }
    const token = this.options.getAuthToken?.()?.trim();
    if (!token) {
      this.scheduleReconnect();
      return;
    }
    const session = this.requireSession();
    const deviceId = this.options.deviceIdentity.deviceId;
    const url = `${socketOriginOf(this.builderOrigin)}${devicePresencePath(
      deviceId,
    )}`;
    this.openingSocket = true;
    void socketCredentialProtocol({
      socketUrl: url,
      token,
      purpose: "presence",
      resource: deviceId,
      fetchImpl: (input, init) => this.fetchImpl(input, init),
    }).then(
      (credential) => {
        this.openingSocket = false;
        if (
          this.stopped ||
          !this.started ||
          !this.sessionReady ||
          this.socket
        ) {
          return;
        }
        this.attachSocket(url, token, credential, session.presenceSessionId);
      },
      (error: unknown) => {
        this.openingSocket = false;
        this.log("warn", "The device presence socket ticket failed.", error);
        this.scheduleReconnect();
      },
    );
  }

  private attachSocket(
    url: string,
    token: string,
    credential: string,
    presenceSessionId: string,
  ) {
    const create =
      this.options.createSocket ??
      ((target: string, protocols: string[]) =>
        new WebSocket(
          target,
          protocols,
        ) as unknown as ExecutionPlacementSocket);
    let socket: ExecutionPlacementSocket;
    try {
      socket = create(url, [DEVICE_PRESENCE_SUBPROTOCOL, credential]);
    } catch (error) {
      this.log("warn", "The device presence socket could not open.", error);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    this.socketProven = false;
    this.socketHeardAt = this.now();
    this.socketPingTimer?.cancel();
    this.socketPingTimer = forkInterval(DEVICE_PRESENCE_PING_INTERVAL_MS, () => {
      if (this.socket !== socket) return;
      if (this.now() - this.socketHeardAt > DEVICE_PRESENCE_SILENCE_MS) {
        this.log("warn", "The device presence socket went silent; reconnecting.");
        this.dropSocket(socket, 4001, "silent");
        return;
      }
      this.sendKeepalive();
    });
    const expiresAt = jwtExpiryMs(token);
    if (expiresAt !== null) {
      const delay = Math.max(
        MIN_TOKEN_REFRESH_DELAY_MS,
        expiresAt - TOKEN_REFRESH_MARGIN_MS - this.now(),
      );
      this.socketTokenTimer?.cancel();
      this.socketTokenTimer = forkDelayed(delay, () => {
        if (this.socket !== socket) return;
        this.leases.resetReconnectBackoff();
        socket.close(1000, "token_refresh");
      });
    }

    socket.on("message", (data: unknown) => {
      if (this.socket === socket) this.socketHeardAt = this.now();
      let frame: DevicePresenceServerFrame;
      try {
        const text =
          typeof data === "string"
            ? data
            : Buffer.from(data as ArrayBufferLike).toString("utf8");
        if (text === SOCKET_KEEPALIVE_PONG) return;
        const value = JSON.parse(text) as unknown;
        if (!value || typeof value !== "object" || Array.isArray(value)) return;
        frame = value as DevicePresenceServerFrame;
      } catch {
        socket.close(4000, "bad_frame");
        return;
      }
      if (frame.type === "challenge") {
        const connectionId =
          typeof frame.connectionId === "string" ? frame.connectionId : "";
        const nonce = typeof frame.nonce === "string" ? frame.nonce : "";
        if (!connectionId || !nonce) {
          socket.close(4000, "bad_frame");
          return;
        }
        void this.proveConnection(socket, presenceSessionId, {
          connectionId,
          nonce,
        }).catch((error) => {
          this.log("warn", "The device presence handshake failed.", error);
          socket.close(4500, "handshake_failed");
        });
        return;
      }
      void this.handleServerFrame(socket, frame).catch((error) =>
        this.log("error", "A device presence frame failed.", error),
      );
    });
    socket.on("close", () => this.dropSocket(socket));
    socket.on("error", (error: unknown) => {
      this.log("warn", "The device presence socket disconnected.", error);
    });
  }

  private dropSocket(socket: ExecutionPlacementSocket, code?: number, reason?: string) {
    if (this.socket !== socket) return;
    this.socket = null;
    this.socketProven = false;
    this.advertisedAvailability = "";
    this.socketPingTimer?.cancel();
    this.socketPingTimer = null;
    this.socketTokenTimer?.cancel();
    this.socketTokenTimer = null;
    if (code !== undefined) {
      try {
        if (socket.terminate) socket.terminate();
        else if (socket.readyState < 2) socket.close(code, reason);
      } catch (error) {
        this.log("warn", "A silent device presence socket could not be closed.", error);
      }
    }
    this.rejectPendingWaits("The device presence socket closed.");
    this.scheduleReconnect();
  }

  private async proveConnection(
    socket: ExecutionPlacementSocket,
    presenceSessionId: string,
    challenge: { connectionId: string; nonce: string },
  ) {
    const availability = await this.currentAvailability();
    if (this.socket !== socket || socket.readyState !== 1) return;
    const begin: DevicePresenceDeviceFrame = {
      type: "begin",
      presenceSessionId,
      protocolVersion: DEVICE_PRESENCE_PROTOCOL_VERSION,
      availability,
    };
    socket.send(JSON.stringify(begin));
    const message = [
      DEVICE_PRESENCE_PROOF_PREFIX,
      challenge.connectionId,
      challenge.nonce,
    ].join("\u0000");
    let signature: string;
    try {
      signature = await this.options.signPresenceProof(message);
    } catch (error) {
      this.log("warn", "The device presence proof could not be signed.", error);
      return;
    }
    const proof: DevicePresenceDeviceFrame = { type: "proof", signature };
    if (this.socket !== socket || socket.readyState !== 1) return;
    socket.send(JSON.stringify(proof));
    this.advertisedAvailability = JSON.stringify(availability);
  }

  private readonly serverFrameHandlers: ServerFrameHandlers = {
    connected: async () => {
      this.socketProven = true;
      this.leases.resetReconnectBackoff();
      this.sendKeepalive();
      this.sendPendingConsent();
      await this.resumeAfterConnect();
    },
    offer: (frame) => {
      const task = this.handleOffer(frame).catch((error) =>
        this.log("error", "Execution placement offer handling failed.", error),
      );
      this.offerTasks.add(task);
      void task.finally(() => this.offerTasks.delete(task));
    },
    "offer.withdrawn": (frame) => {
      this.settleClaim(frame.dispatchId, {
        error: new Error(`The offer was withdrawn (${frame.reason}).`),
      });
    },
    claimed: (frame) => {
      this.settleClaim(frame.dispatchId, {
        claimExpiresAt: frame.claimExpiresAt,
      });
    },
    cancel: async (frame) => {
      const local = this.inbox.get(frame.dispatchId);
      if (local) await this.cancelAccepted(local, { cancelReason: frame.reason });
    },
    steer: async (frame) => {
      await this.steerAccepted(frame.dispatchId, frame.messageId, frame.text);
    },
    "agent-message": async (frame) => {
      await this.deliverAgentMessage(frame);
    },
    "agent-pause": async (frame) => {
      await this.stopLocalAgent(frame);
    },
    "consent.request": (frame) => {
      this.options.onRemoteExecutionRequest?.({
        requestedAt: frame.requestedAt,
        ...(frame.requesterLabel
          ? { requesterLabel: frame.requesterLabel }
          : {}),
      });
    },
    dispatch: async (frame) => {
      await this.applyDispatchUpdate(frame.dispatch);
    },
    request: (frame) => {
      this.deviceRequests.handle(frame);
    },
    "request.cancel": (frame) => {
      this.deviceRequests.cancel(frame.requestId);
    },
    error: (frame, socket) => {
      this.log(
        "warn",
        `The owner gate refused a presence frame (${frame.code}): ${frame.message}`,
      );
      if (!frame.retryable) socket.close(4000, frame.code);
    },
    pong: () => {},
  };

  private async handleServerFrame(
    socket: ExecutionPlacementSocket,
    frame: DevicePresenceServerFrame,
  ) {
    if (this.socket !== socket) return;
    if (!Object.hasOwn(this.serverFrameHandlers, frame.type)) return;
    const handler = this.serverFrameHandlers[
      frame.type as keyof ServerFrameHandlers
    ] as (
      frame: DevicePresenceServerFrame,
      socket: ExecutionPlacementSocket,
    ) => void | Promise<void>;
    await handler(frame, socket);
  }

  private async steerAccepted(
    dispatchId: string,
    messageId: string,
    text: string,
  ): Promise<void> {
    const local = this.inbox.get(dispatchId);
    let delivered = false;
    if (local?.kind === "agent" && this.options.steerExecution) {
      try {
        delivered = await this.options.steerExecution({
          dispatchId,
          payload: parseRecord(JSON.parse(local.payloadJson)),
          messageId,
          text,
        });
      } catch (error) {
        this.log("warn", "Execution placement steer was not delivered.", error);
      }
    }
    this.send({ type: "steer.ack", dispatchId, messageId, delivered });
  }

  private async deliverAgentMessage(
    frame: Extract<DevicePresenceServerFrame, { type: "agent-message" }>,
  ): Promise<void> {
    const { messageId, threadId } = frame;
    if (typeof messageId !== "string" || typeof threadId !== "string") return;
    let outcome: AgentMessageDeviceOutcome = "refused";
    if (
      typeof frame.text === "string" &&
      frame.ownerGeneration === this.ownerGeneration &&
      this.options.deliverAgentMessage
    ) {
      try {
        outcome = await this.options.deliverAgentMessage({
          threadId,
          messageId,
          text: frame.text,
          ownerGeneration: frame.ownerGeneration,
        });
      } catch (error) {
        this.log("warn", "An agent message was not delivered.", error);
      }
    }
    this.send({ type: "agent-message.ack", messageId, threadId, outcome });
  }

  private async stopLocalAgent(
    frame: Extract<DevicePresenceServerFrame, { type: "agent-pause" }>,
  ): Promise<void> {
    const { commandId, threadId } = frame;
    if (typeof commandId !== "string" || typeof threadId !== "string") return;
    let outcome: AgentStopDeviceOutcome = "refused";
    if (
      frame.ownerGeneration === this.ownerGeneration &&
      this.options.stopLocalAgent
    ) {
      try {
        outcome = await this.options.stopLocalAgent({
          threadId,
          ownerGeneration: frame.ownerGeneration,
        });
      } catch (error) {
        this.log("warn", "An agent stop was not applied.", error);
      }
    }
    // Gates from before `stop_agent` read a stop's ack as `paused`.
    this.send({ type: "agent-pause.ack", commandId, threadId, outcome: outcome === "stopped" ? "paused" : outcome });
  }

  private settleClaim(
    dispatchId: string,
    outcome: { claimExpiresAt?: number; error?: Error },
  ) {
    const pending = this.pendingClaims.get(dispatchId);
    if (!pending) return;
    this.pendingClaims.delete(dispatchId);
    pending.timer.cancel();
    if (outcome.error) pending.reject(outcome.error);
    else pending.resolve(outcome.claimExpiresAt ?? 0);
  }

  private rejectPendingWaits(reason: string) {
    for (const [dispatchId, pending] of [...this.pendingClaims]) {
      this.pendingClaims.delete(dispatchId);
      pending.timer.cancel();
      pending.reject(new Error(reason));
    }
    for (const [dispatchId, pending] of [...this.pendingCompletes]) {
      this.pendingCompletes.delete(dispatchId);
      pending.timer.cancel();
      pending.reject(new Error(reason));
    }
  }

  private waitForClaim(dispatchId: string): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      const timer = forkDelayed(CLAIM_RESPONSE_TIMEOUT_MS, () => {
        this.pendingClaims.delete(dispatchId);
        reject(new Error("The owner gate did not answer this claim."));
      });
      this.pendingClaims.set(dispatchId, { resolve, reject, timer });
    });
  }

  private waitForCompletion(dispatchId: string): Promise<DispatchSummary> {
    return new Promise<DispatchSummary>((resolve, reject) => {
      const timer = forkDelayed(COMPLETE_ACK_TIMEOUT_MS, () => {
        this.pendingCompletes.delete(dispatchId);
        reject(new Error("The owner gate did not acknowledge the outcome."));
      });
      this.pendingCompletes.set(dispatchId, { resolve, reject, timer });
    });
  }

  private async applyDispatchUpdate(value: unknown) {
    let dispatch: DispatchSummary;
    try {
      dispatch = parseDispatch(value);
    } catch (error) {
      this.log("warn", "Ignored a malformed dispatch frame.", error);
      return;
    }
    this.notifyDispatchWatchers(dispatch);
    const pending = this.pendingCompletes.get(dispatch.dispatchId);
    if (pending && isTerminalState(dispatch.state)) {
      this.pendingCompletes.delete(dispatch.dispatchId);
      pending.timer.cancel();
      pending.resolve(dispatch);
      return;
    }
    const local = this.inbox.get(dispatch.dispatchId);
    if (!local) return;
    if (dispatch.state === "cancel_pending") {
      await this.cancelAccepted(local, dispatch);
      return;
    }
    if (isTerminalState(dispatch.state)) {
      if (local.state === "terminal_pending" && !local.cancelRpcPending) {
        this.inbox.markTerminal(dispatch.dispatchId, dispatch, this.now());
        void this.heartbeat();
      }
      return;
    }
    if (
      dispatch.placement === "computer" &&
      (dispatch.state === "computer_accepted" ||
        dispatch.state === "computer_running") &&
      !this.executing.has(dispatch.dispatchId) &&
      !local.cancelRpcPending
    ) {
      this.launchLocal(local, dispatch);
    }
  }

  private async currentAvailability(): Promise<DeviceAvailability> {
    const availability = await this.options.getAvailability();
    return {
      ready: availability.ready,
      capabilities: [...new Set(availability.capabilities)].sort(),
    };
  }

  async answerRemoteExecutionRequest(allow: boolean): Promise<void> {
    this.pendingConsent = allow;
    this.sendPendingConsent();
    if (this.pendingConsent === false) {
      await this.client.call("devices.setRemoteExecution", {
        deviceId: this.options.deviceIdentity.deviceId,
        enabled: false,
      });
    }
  }

  private sendPendingConsent() {
    if (this.pendingConsent === null || !this.socketProven) return;
    if (this.send({ type: "consent", allow: this.pendingConsent })) {
      this.pendingConsent = null;
    }
  }

  private async publishAvailability() {
    if (!this.socketProven) return;
    const availability = await this.currentAvailability();
    const serialized = JSON.stringify(availability);
    if (serialized === this.advertisedAvailability) return;
    if (this.send({ type: "availability", availability })) {
      this.advertisedAvailability = serialized;
    }
  }

  private async readIdentity() {
    const identity = parseRecord(
      await this.client.call("devices.identity", {
        deviceId: this.options.deviceIdentity.deviceId,
      }),
    );
    if (
      typeof identity.ownerId !== "string" ||
      typeof identity.ownerGeneration !== "string"
    ) {
      throw new Error("Execution placement identity is incompatible.");
    }
    const builderOrigin =
      typeof identity.builderOrigin === "string"
        ? identity.builderOrigin.replace(/\/+$/u, "")
        : "";
    if (!/^https?:\/\//u.test(builderOrigin)) {
      throw new Error("Execution placement has no owner gate configured.");
    }
    return {
      ownerId: identity.ownerId,
      ownerGeneration: identity.ownerGeneration,
      builderOrigin,
    };
  }

  private async registerDevice() {
    const availability = await this.options.getAvailability();
    await this.client.call(
      "devices.register",
      executionDeviceRegistration({
        deviceId: this.options.deviceIdentity.deviceId,
        devicePublicKey: this.options.deviceIdentity.publicKey,
        deviceName: this.options.deviceName,
        platform: this.options.platform,
        capabilities: availability.capabilities,
      }),
    );
  }

  async start(): Promise<void> {
    if (this.started) return;
    if (this.stopTask) {
      throw new Error("A stopped execution placement bridge cannot restart.");
    }
    this.stopped = false;
    const epoch = ++this.lifecycleEpoch;
    const identity = await this.readIdentity();
    if (this.stopped || epoch !== this.lifecycleEpoch) {
      throw new Error("Execution placement stopped while starting.");
    }
    this.ownerId = identity.ownerId;
    this.ownerGeneration = identity.ownerGeneration;
    this.builderOrigin = identity.builderOrigin;
    const session = this.inbox.openSession({
      ownerId: identity.ownerId,
      ownerGeneration: identity.ownerGeneration,
      now: this.now(),
    });
    this.presenceSessionId = session.presenceSessionId;
    await this.stageRestartCancellations();
    this.started = true;
    await this.registerDevice();
    if (this.stopped || epoch !== this.lifecycleEpoch) {
      throw new Error("Execution placement stopped while registering.");
    }
    this.sessionReady = true;
    this.openSocket();
    this.leases.startHeartbeat(() => {
      void this.heartbeat();
    });
    this.settleCancellationsInBackground();
    await this.reconcileInbox();
  }

  private settleCancellationsInBackground() {
    void this.retryPendingCancellations().catch((error) =>
      this.log(
        "warn",
        "Execution placement cancellation retry was deferred.",
        error,
      ),
    );
  }

  async stop(): Promise<void> {
    if (this.stopTask) return await this.stopTask;
    const task = this.stopAndQuiesce();
    this.stopTask = task;
    try {
      await task;
    } catch (error) {
      if (this.stopTask === task) this.stopTask = null;
      throw error;
    }
  }

  private async stopAndQuiesce(): Promise<void> {
    this.stopped = true;
    this.started = false;
    this.sessionReady = false;
    this.leases.stopHeartbeat();
    this.leases.cancelReconnect();
    this.leases.clearLeaseHistory();
    this.dispatchWatchers.clear();

    await this.leases.joinHeartbeat();
    await Promise.allSettled([...this.offerTasks]);

    const now = this.now();
    for (const row of this.inbox.listAllUnfinished()) {
      if (["claimed", "accepted", "running"].includes(row.state)) {
        this.inbox.stageCancellation(row.dispatchId, {
          outcome: "canceled",
          errorCode: "LOCAL_EXECUTION_BRIDGE_STOPPED",
          errorMessage:
            "The desktop execution bridge stopped before the local run settled.",
          orphanOnAck:
            row.ownerGeneration !== this.ownerGeneration ||
            row.presenceSessionId !== this.presenceSessionId,
          now,
        });
      }
    }

    const cancellationResults = await Promise.all(
      this.inbox
        .listCancellationPending()
        .map((row) => this.retryCancellation(row.dispatchId)),
    );
    const cancellationsAcknowledged = cancellationResults.every(Boolean);
    if (cancellationsAcknowledged) {
      await Promise.allSettled([...this.executionTasks.values()]);
    }
    await Promise.allSettled(this.leases.cancellationsInFlight());

    for (const row of this.inbox.listAllUnfinished()) {
      if (row.state === "terminal_pending" && !row.cancelRpcPending) {
        await this.flushTerminal(row).catch((error) =>
          this.log(
            "warn",
            "Execution placement terminal receipt during stop was deferred.",
            error,
          ),
        );
      }
    }
    this.closeSocket(1000, "desktop_stopped");
    this.rejectPendingWaits("The execution placement bridge stopped.");
    this.lifecycleEpoch += 1;
    if (!cancellationsAcknowledged) {
      throw new Error(
        "Execution placement stopped with an unacknowledged local cancellation.",
      );
    }
  }

  private async stageRestartCancellations() {
    const now = this.now();
    for (const row of this.inbox.listAllUnfinished()) {
      if (
        row.cancelRpcPending ||
        !["claimed", "accepted", "running"].includes(row.state)
      ) {
        continue;
      }
      let remoteCanceled = false;
      let remote: DispatchSummary | null = null;
      try {
        remote = await this.getDispatchStatus(row.dispatchId);
        remoteCanceled =
          remote?.state === "cancel_pending" || remote?.state === "canceled";
      } catch (error) {
        this.log(
          "warn",
          "Execution placement restart status reconciliation was deferred.",
          error,
        );
      }
      this.inbox.stageCancellation(row.dispatchId, {
        outcome: remoteCanceled ? "canceled" : "failed",
        ...(remoteCanceled
          ? remoteCancellation(remote)
          : {
              errorCode: "LOCAL_EXECUTION_INTERRUPTED",
              errorMessage:
                "The desktop restarted after local execution ownership was recorded.",
            }),
        now,
      });
    }
  }

  private async refreshIdentityAfterFence() {
    if (this.stopped || !this.started) return;
    const identity = await this.readIdentity();
    if (
      identity.ownerId === this.ownerId &&
      identity.ownerGeneration === this.ownerGeneration
    ) {
      this.builderOrigin = identity.builderOrigin;
      if (!this.sessionReady) {
        this.settleCancellationsInBackground();
        await this.registerDevice();
        this.sessionReady = true;
        this.openSocket();
        await this.reconcileInbox();
      }
      return;
    }

    this.closeSocket(1000, "owner_rotated");
    this.leases.clearLeaseHistory();
    this.sessionReady = false;
    this.lifecycleEpoch += 1;
    await Promise.allSettled([...this.offerTasks]);
    this.ownerId = identity.ownerId;
    this.ownerGeneration = identity.ownerGeneration;
    this.builderOrigin = identity.builderOrigin;
    const nextSession = this.inbox.openSession({
      ownerId: identity.ownerId,
      ownerGeneration: identity.ownerGeneration,
      now: this.now(),
    });
    this.presenceSessionId = nextSession.presenceSessionId;
    this.settleCancellationsInBackground();
    await this.registerDevice();
    this.sessionReady = true;
    this.openSocket();
    await this.reconcileInbox();
  }

  private heartbeat(): Promise<void> {
    return this.leases.heartbeat(() =>
      !this.started || this.stopped ? null : this.runHeartbeat(),
    );
  }

  private async runHeartbeat() {
    let identityRefreshNeeded = false;
    this.settleCancellationsInBackground();
    if (!this.sessionReady) {
      await this.refreshIdentityAfterFence();
      return;
    }
    const active = this.inbox.listUnfinished(this.requireSession());
    try {
      await this.publishAvailability();
    } catch (error) {
      identityRefreshNeeded = true;
      this.log("warn", "Execution placement availability failed.", error);
    }
    const now = this.now();
    for (const row of active) {
      if (this.stopped) break;
      if (row.cancelRpcPending) {
        try {
          await this.renew(row);
          this.leases.clearRenewalFailure(row.dispatchId);
        } catch (error) {
          identityRefreshNeeded = true;
          this.log(
            "warn",
            "Execution placement cancellation lease renewal failed.",
            error,
          );
        }
        continue;
      }
      if (row.state === "claimed") {
        this.leases.clearRenewalFailure(row.dispatchId);
        if (this.leases.claimAckRetryIsDue(row.dispatchId)) {
          let remote: DispatchSummary | null = null;
          try {
            remote = await this.getDispatchStatus(row.dispatchId);
          } catch (error) {
            this.leases.noteClaimAckFailure(row.dispatchId);
            this.log(
              "warn",
              "Execution placement claim-ACK status retry was deferred.",
              error,
            );
            continue;
          }
          if (
            !remote ||
            remote.placement === "cloud" ||
            isTerminalState(remote.state)
          ) {
            this.leases.clearClaimAckRetry(row.dispatchId);
            this.inbox.markOrphaned(row.dispatchId, now);
          } else {
            this.launchLocal(row, remote);
          }
        }
        continue;
      }
      if (row.state === "terminal_pending") {
        this.leases.clearRenewalFailure(row.dispatchId);
        await this.flushTerminal(row).catch((error) =>
          this.log(
            "warn",
            "Execution placement terminal receipt retry was deferred.",
            error,
          ),
        );
        continue;
      }
      try {
        await this.renew(row);
        this.leases.clearRenewalFailure(row.dispatchId);
      } catch (error) {
        identityRefreshNeeded = true;
        const leaseLost = this.leases.noteRenewalFailure(row.dispatchId, now);
        this.log("warn", "Execution placement lease renewal failed.", error);
        if (isOwnerLifecycleFenceError(error) || leaseLost) {
          await this.cancelForLostLease(row);
        }
      }
    }
    this.inbox.pruneTerminal(now - 7 * 86_400_000);
    if (identityRefreshNeeded) {
      await this.refreshIdentityAfterFence().catch((error) =>
        this.log(
          "warn",
          "Execution placement identity refresh was deferred.",
          error,
        ),
      );
    }
  }

  private async cancelForLostLease(row: ExecutionPlacementInboxRow) {
    this.leases.clearRenewalFailure(row.dispatchId);
    this.inbox.stageCancellation(row.dispatchId, {
      outcome: "canceled",
      errorCode: "LOCAL_EXECUTION_LEASE_EXPIRED",
      errorMessage:
        "The desktop stopped executing because its server lease could not be renewed.",
      now: this.now(),
    });
    await this.retryCancellation(row.dispatchId);
  }

  private async retryPendingCancellations() {
    let acknowledged = true;
    for (const row of this.inbox.listCancellationPending()) {
      if (!(await this.retryCancellation(row.dispatchId))) acknowledged = false;
    }
    return acknowledged;
  }

  private retryCancellation(dispatchId: string): Promise<boolean> {
    return this.leases.retryCancellation(dispatchId, async () => {
      const row = this.inbox.get(dispatchId);
      if (!row?.cancelRpcPending) return true;
      try {
        let payload: Record<string, unknown> | undefined;
        try {
          payload = parseRecord(JSON.parse(row.payloadJson));
        } catch {
          payload = undefined;
        }
        await this.withCancellationTimeout(
          this.options.cancelExecution({
            dispatchId: row.dispatchId,
            kind: row.kind,
            conversationId: row.conversationId,
            ...(payload ? { payload } : {}),
            ...(row.errorCode === AGENT_STOPPED_ERROR_CODE ? { stopped: true } : {}),
          }),
        );
        this.leases.clearCancellationFailure(row.dispatchId);
      } catch (error) {
        const attempts = this.leases.noteCancellationFailure(row.dispatchId);
        if (attempts < CANCELLATION_MAX_ATTEMPTS) {
          this.log(
            "warn",
            `Execution placement local cancellation of ${row.dispatchId} (${row.kind}) was deferred (attempt ${attempts}/${CANCELLATION_MAX_ATTEMPTS}).`,
            error,
          );
          return false;
        }
        this.leases.clearCancellationFailure(row.dispatchId);
        this.log(
          "error",
          `Execution placement local cancellation of ${row.dispatchId} (${row.kind}) failed ${attempts} times; settling it as canceled.`,
          error,
        );
      }
      const afterLocalCancel = this.inbox.get(row.dispatchId);
      if (!afterLocalCancel?.cancelRpcPending) return true;
      if (
        afterLocalCancel.ownerId !== this.ownerId ||
        afterLocalCancel.ownerGeneration !== this.ownerGeneration ||
        afterLocalCancel.presenceSessionId !== this.presenceSessionId
      ) {
        this.inbox.acknowledgeCancellation(
          afterLocalCancel.dispatchId,
          this.now(),
        );
        return true;
      }
      if (afterLocalCancel.state === "claimed") {
        if (
          !this.send({
            type: "release",
            dispatchId: afterLocalCancel.dispatchId,
            reason: "local execution canceled before claim acceptance",
          })
        ) {
          this.log(
            "warn",
            "Execution placement pre-acceptance claim release was deferred.",
          );
          return false;
        }
        this.inbox.acknowledgeClaimRelease(
          afterLocalCancel.dispatchId,
          this.now(),
        );
        this.leases.clearClaimAckRetry(afterLocalCancel.dispatchId);
        return true;
      }
      this.inbox.acknowledgeCancellation(
        afterLocalCancel.dispatchId,
        this.now(),
      );
      const acknowledged = this.inbox.get(afterLocalCancel.dispatchId);
      if (acknowledged?.state === "terminal_pending") {
        await this.flushTerminal(acknowledged).catch((error) =>
          this.log(
            "warn",
            "Execution placement cancellation receipt was deferred.",
            error,
          ),
        );
      }
      return true;
    });
  }

  private withCancellationTimeout(task: Promise<void>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timer = forkDelayed(CANCELLATION_RPC_TIMEOUT_MS, () =>
        reject(new Error("The local cancellation did not answer in time.")),
      );
      task.then(
        () => {
          timer.cancel();
          resolve();
        },
        (error: unknown) => {
          timer.cancel();
          reject(error);
        },
      );
    });
  }

  private async handleOffer(frame: {
    dispatch: DispatchSummary;
    payloadJson: string;
    payloadHash: string;
    offerExpiresAt: number;
  }) {
    if (!this.started || this.stopped) return;
    const epoch = this.lifecycleEpoch;
    let dispatch: DispatchSummary;
    try {
      dispatch = parseDispatch(frame.dispatch);
    } catch (error) {
      this.log("warn", "Ignored a malformed offer.", error);
      return;
    }
    if (
      this.executing.has(dispatch.dispatchId) ||
      this.offersInFlight.has(dispatch.dispatchId) ||
      this.inbox.get(dispatch.dispatchId)
    ) {
      return;
    }
    this.offersInFlight.add(dispatch.dispatchId);
    try {
      await this.claimOffer(frame, dispatch, epoch);
    } finally {
      this.offersInFlight.delete(dispatch.dispatchId);
    }
  }

  private async claimOffer(
    frame: { payloadJson: string; payloadHash: string },
    dispatch: DispatchSummary,
    epoch: number,
  ) {
    if (typeof frame.payloadJson !== "string" || !frame.payloadJson) return;
    if (sha256(frame.payloadJson) !== frame.payloadHash) {
      this.log("warn", "Refused an offer whose payload hash did not match.");
      return;
    }
    const availability = await this.currentAvailability();
    if (!this.isLiveEpoch(epoch)) return;
    if (!availability.ready) return;

    const claimRequestId = `claim:${this.presenceSessionId}:${dispatch.dispatchId}`;
    const claimed = this.waitForClaim(dispatch.dispatchId);
    if (
      !this.send({
        type: "claim",
        dispatchId: dispatch.dispatchId,
        claimRequestId,
      })
    ) {
      this.settleClaim(dispatch.dispatchId, {
        error: new Error("The presence socket was not connected."),
      });
      await claimed.catch(() => undefined);
      return;
    }
    let claimExpiresAt: number;
    try {
      claimExpiresAt = await claimed;
    } catch (error) {
      this.log("warn", "Execution placement claim lost its race.", error);
      return;
    }
    const session = this.requireSession();
    try {
      this.inbox.persistClaim({
        ...session,
        claimToken: claimRequestId,
        claimed: {
          dispatch,
          payloadJson: frame.payloadJson,
          payloadHash: frame.payloadHash,
          claimExpiresAt,
        },
        now: this.now(),
      });
    } catch (error) {
      this.send({
        type: "release",
        dispatchId: dispatch.dispatchId,
        reason: "local inbox transaction failed",
      });
      throw error;
    }
    const local = this.inbox.get(dispatch.dispatchId)!;
    if (!this.isLiveEpoch(epoch)) {
      this.inbox.stageCancellation(dispatch.dispatchId, {
        outcome: "canceled",
        errorCode: "LOCAL_EXECUTION_BRIDGE_STOPPED",
        errorMessage:
          "The desktop execution bridge stopped before claim acceptance.",
        now: this.now(),
      });
      await this.retryCancellation(dispatch.dispatchId);
      return;
    }
    this.launchLocal(local, dispatch);
  }

  private async adoptCommittedDispatch(
    dispatch: DispatchSummary,
    payload: DispatchPayload,
  ) {
    if (
      dispatch.executorDeviceId !== this.options.deviceIdentity.deviceId ||
      (dispatch.state !== "computer_claimed" &&
        dispatch.state !== "computer_accepted")
    ) {
      return;
    }
    if (
      this.executing.has(dispatch.dispatchId) ||
      this.inbox.get(dispatch.dispatchId)
    ) {
      return;
    }
    const payloadJson = canonicalDispatchPayloadJson(payload);
    const session = this.requireSession();
    this.inbox.persistClaim({
      ...session,
      claimToken: `desktop:${dispatch.dispatchId}`,
      claimed: {
        dispatch,
        payloadJson,
        payloadHash: sha256(payloadJson),
        claimExpiresAt: this.now() + CLAIM_RESPONSE_TIMEOUT_MS,
      },
      now: this.now(),
    });
    if (dispatch.state === "computer_accepted") {
      this.inbox.markAccepted(dispatch.dispatchId, dispatch, this.now());
    }
    this.launchLocal(this.inbox.get(dispatch.dispatchId)!, dispatch);
  }

  private async resumeAfterConnect() {
    await this.publishAvailability().catch((error) =>
      this.log("warn", "Execution placement availability failed.", error),
    );
    if (!this.sessionReady) return;
    for (const row of this.inbox.listUnfinished(this.requireSession())) {
      if (row.cancelRpcPending) {
        await this.retryCancellation(row.dispatchId);
        continue;
      }
      if (row.state === "terminal_pending") {
        await this.flushTerminal(row).catch((error) =>
          this.log(
            "warn",
            "Execution placement terminal receipt after reconnect was deferred.",
            error,
          ),
        );
        continue;
      }
      if (row.state === "running") {
        this.send({ type: "running", dispatchId: row.dispatchId });
      }
    }
  }

  private async reconcileInbox() {
    const session = this.requireSession();
    for (const row of this.inbox.listUnfinished(session)) {
      if (row.cancelRpcPending) {
        await this.retryCancellation(row.dispatchId);
        continue;
      }
      let remote: DispatchSummary | null = null;
      try {
        remote = await this.getDispatchStatus(row.dispatchId);
      } catch (error) {
        this.log("warn", "Execution inbox reconciliation was deferred.", error);
        continue;
      }
      if (!remote || remote.placement === "cloud") {
        if (["claimed", "accepted", "running"].includes(row.state)) {
          this.inbox.stageCancellation(row.dispatchId, {
            outcome: "canceled",
            errorCode: "LOCAL_EXECUTION_NO_LONGER_OWNED",
            errorMessage:
              "The server no longer assigned this execution to the desktop.",
            orphanOnAck: true,
            now: this.now(),
          });
          await this.retryCancellation(row.dispatchId);
        } else {
          this.inbox.markOrphaned(row.dispatchId, this.now());
        }
        continue;
      }
      if (isTerminalState(remote.state)) {
        if (["claimed", "accepted", "running"].includes(row.state)) {
          this.inbox.stageCancellation(row.dispatchId, {
            outcome: "canceled",
            errorCode: "LOCAL_EXECUTION_REMOTE_TERMINAL",
            errorMessage:
              "The server reached a terminal state before local reconciliation.",
            orphanOnAck: true,
            now: this.now(),
          });
          await this.retryCancellation(row.dispatchId);
        } else {
          this.inbox.markTerminal(row.dispatchId, remote, this.now());
        }
        continue;
      }
      if (remote.state === "cancel_pending") {
        await this.launchLocal(row, remote);
      } else if (row.state === "terminal_pending") {
        void this.flushTerminal(row).catch(() => undefined);
      } else if (row.state === "running") {
        this.inbox.stageCancellation(row.dispatchId, {
          outcome: "failed",
          errorCode: "LOCAL_EXECUTION_INTERRUPTED",
          errorMessage:
            "The desktop restarted after local execution began; Stella did not replay it because effects may already have occurred.",
          now: this.now(),
        });
        await this.retryCancellation(row.dispatchId);
      } else {
        this.launchLocal(row, remote);
      }
    }
  }

  private launchLocal(
    row: ExecutionPlacementInboxRow,
    remote: DispatchSummary,
  ): Promise<void> | undefined {
    if (this.executing.has(row.dispatchId) || this.stopped) return;
    this.executing.add(row.dispatchId);
    const epoch = this.lifecycleEpoch;
    const task = this.resumeLocal(row, remote, epoch);
    this.executionTasks.set(row.dispatchId, task);
    const clear = () => {
      if (this.executionTasks.get(row.dispatchId) === task) {
        this.executionTasks.delete(row.dispatchId);
        this.executing.delete(row.dispatchId);
      }
      void this.heartbeat();
    };
    void task.then(clear, clear);
    return task;
  }

  private async resumeLocal(
    row: ExecutionPlacementInboxRow,
    remote: DispatchSummary,
    epoch: number,
  ) {
    try {
      if (row.cancelRpcPending) {
        await this.retryCancellation(row.dispatchId);
        return;
      }
      if (remote.state === "cancel_pending") {
        await this.cancelAccepted(row, remote);
        return;
      }
      if (row.state === "claimed") {
        if (!this.send({ type: "ack", dispatchId: row.dispatchId })) {
          this.leases.noteClaimAckFailure(row.dispatchId);
          return;
        }
        const accepted: DispatchSummary = {
          ...remote,
          state: "computer_accepted",
          placement: "computer",
          executorDeviceId: this.options.deviceIdentity.deviceId,
        };
        this.inbox.markAccepted(row.dispatchId, accepted, this.now());
        this.leases.clearClaimAckRetry(row.dispatchId);
        remote = accepted;
        row = this.inbox.get(row.dispatchId)!;
        if (!this.isLiveEpoch(epoch)) {
          this.inbox.stageCancellation(row.dispatchId, {
            outcome: "canceled",
            errorCode: "LOCAL_EXECUTION_BRIDGE_STOPPED",
            errorMessage:
              "The desktop execution bridge stopped after claim acceptance.",
            now: this.now(),
          });
          await this.retryCancellation(row.dispatchId);
          return;
        }
        if (row.cancelRpcPending) {
          await this.retryCancellation(row.dispatchId);
          return;
        }
      }
      if (row.state === "terminal_pending") {
        await this.flushTerminal(row).catch((error) =>
          this.log(
            "warn",
            "Execution placement terminal receipt was deferred.",
            error,
          ),
        );
        return;
      }
      this.inbox.markRunning(row.dispatchId, this.now());
      this.send({ type: "running", dispatchId: row.dispatchId });
      void this.publishAvailability().catch(() => undefined);
      row = this.inbox.get(row.dispatchId)!;
      if (!this.isLiveEpoch(epoch)) {
        this.inbox.stageCancellation(row.dispatchId, {
          outcome: "canceled",
          errorCode: "LOCAL_EXECUTION_BRIDGE_STOPPED",
          errorMessage:
            "The desktop execution bridge stopped before local launch.",
          now: this.now(),
        });
        await this.retryCancellation(row.dispatchId);
        return;
      }
      if (row.cancelRpcPending) {
        await this.retryCancellation(row.dispatchId);
        return;
      }
      let payload: Record<string, unknown>;
      try {
        payload = parseRecord(JSON.parse(row.payloadJson));
      } catch {
        this.inbox.markTerminalPending(row.dispatchId, {
          outcome: "failed",
          errorCode: "LOCAL_PAYLOAD_INVALID",
          errorMessage: "The durably accepted local payload was invalid.",
          now: this.now(),
        });
        await this.flushTerminal(this.inbox.get(row.dispatchId)!).catch(
          () => undefined,
        );
        return;
      }
      const result = await this.options.runExecution({
        dispatch: remote,
        payload,
        ownerGeneration: row.ownerGeneration,
      });
      const cancellation = this.inbox.get(row.dispatchId);
      if (
        cancellation?.cancelRpcPending ||
        cancellation?.state === "terminal" ||
        (cancellation?.state === "terminal_pending" &&
          cancellation.terminalOutcome === "canceled")
      ) {
        if (cancellation.state === "terminal_pending") {
          await this.flushTerminal(cancellation).catch(() => undefined);
        }
        return;
      }
      const stopped = result.status === "canceled" && result.stopped === true;
      const canceled = result.status === "canceled";
      const failed = result.status === "error";
      const resultJson =
        result.status === "ok"
          ? terminalResultJson(result.finalText ?? "")
          : undefined;
      this.inbox.markTerminalPending(row.dispatchId, {
        outcome: canceled ? "canceled" : failed ? "failed" : "completed",
        ...(resultJson ? { resultJson } : {}),
        ...(failed ? { errorCode: "LOCAL_EXECUTION_FAILED" } : {}),
        ...(stopped ? { errorCode: AGENT_STOPPED_ERROR_CODE } : {}),
        ...((failed || canceled) && (result.error || result.finalText)
          ? { errorMessage: boundedResult(result.error || result.finalText) }
          : {}),
        now: this.now(),
      });
      await this.flushTerminal(this.inbox.get(row.dispatchId)!).catch((error) =>
        this.log(
          "warn",
          "Execution placement terminal receipt was deferred.",
          error,
        ),
      );
    } catch (error) {
      const current = this.inbox.get(row.dispatchId);
      if (
        current?.state === "claimed" &&
        !current.cancelRpcPending &&
        this.isLiveEpoch(epoch)
      ) {
        this.leases.noteClaimAckFailure(row.dispatchId);
        this.log(
          "warn",
          "Execution placement claim acknowledgement was deferred.",
          error,
        );
        return;
      }
      this.log("error", "Accepted local execution failed.", error);
      if (
        current &&
        !current.cancelRpcPending &&
        current.state !== "terminal_pending" &&
        current.state !== "terminal"
      ) {
        this.inbox.stageCancellation(row.dispatchId, {
          outcome: "failed",
          errorCode: "LOCAL_EXECUTION_FAILED",
          errorMessage:
            error instanceof Error
              ? error.message.slice(0, 2_000)
              : "Local execution failed.",
          now: this.now(),
        });
        await this.retryCancellation(row.dispatchId);
      }
    }
  }

  private async renew(row: ExecutionPlacementInboxRow) {
    if (!this.send({ type: "renew", dispatchId: row.dispatchId })) {
      throw new Error("The presence socket is not connected.");
    }
  }

  private async cancelAccepted(
    row: ExecutionPlacementInboxRow,
    remote?: Pick<DispatchSummary, "cancelReason"> | null,
  ) {
    if (row.state === "terminal" || row.state === "orphaned") return;
    this.inbox.stageCancellation(row.dispatchId, {
      outcome: "canceled",
      ...remoteCancellation(remote),
      now: this.now(),
    });
    await this.retryCancellation(row.dispatchId);
  }

  private flushTerminal(row: ExecutionPlacementInboxRow): Promise<void> {
    const existing = this.terminalFlushes.get(row.dispatchId);
    if (existing) return existing;
    const task = this.flushTerminalOnce(row);
    this.terminalFlushes.set(row.dispatchId, task);
    const clear = () => {
      if (this.terminalFlushes.get(row.dispatchId) === task) {
        this.terminalFlushes.delete(row.dispatchId);
      }
    };
    void task.then(clear, clear);
    return task;
  }

  private async flushTerminalOnce(row: ExecutionPlacementInboxRow) {
    const current = this.inbox.get(row.dispatchId);
    if (
      !current ||
      current.cancelRpcPending ||
      current.state !== "terminal_pending" ||
      !current.terminalOutcome
    ) {
      return;
    }
    row = current;
    const outcome = current.terminalOutcome;
    const acknowledged = this.waitForCompletion(row.dispatchId);
    if (
      !this.send({
        type: "complete",
        dispatchId: row.dispatchId,
        outcome,
        ...(row.resultJson ? { resultJson: row.resultJson } : {}),
        ...(row.errorCode ? { errorCode: row.errorCode } : {}),
        ...(row.errorMessage ? { errorMessage: row.errorMessage } : {}),
      })
    ) {
      const pending = this.pendingCompletes.get(row.dispatchId);
      this.pendingCompletes.delete(row.dispatchId);
      pending?.timer.cancel();
      pending?.reject(new Error("The presence socket is not connected."));
      await acknowledged.catch(() => undefined);
      throw new Error(
        "The terminal receipt could not be delivered to the owner gate.",
      );
    }
    let dispatch: DispatchSummary | null = null;
    try {
      dispatch = await acknowledged;
    } catch {
      dispatch = await this.getDispatchStatus(row.dispatchId).catch(() => null);
      if (dispatch && !isTerminalState(dispatch.state)) dispatch = null;
    }
    if (!dispatch) {
      throw new Error(
        "The owner gate has not acknowledged the terminal receipt yet.",
      );
    }
    this.inbox.markTerminal(row.dispatchId, dispatch, this.now());
    void this.publishAvailability().catch(() => undefined);
  }
}

export const createExecutionPlacementBridge = (
  options: PlacementBridgeOptions,
) => new ExecutionPlacementBridge(options);
