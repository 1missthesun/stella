import {
  isRequestTimeout,
  REQUEST_BUDGET_MS,
  retryIdempotent,
  withDeadline,
} from "../request-deadline.js";
import { socketCredentialProtocol } from "../socket-ticket.js";
import { backendCallBudget } from "./call-budgets.js";
import type {
  CallArgs,
  CallName,
  CallResult,
  ViewArgs,
  ViewName,
  ViewResult,
} from "./api.js";
import {
  LIVE_CLOSE,
  LIVE_PATH,
  LIVE_SESSION_REVOKED,
  LIVE_SUBPROTOCOL,
  rpcPath,
  SOCKET_KEEPALIVE_PING,
  type BackendError,
  type LiveClientFrame,
  type LiveServerFrame,
  type RpcResponse,
} from "./protocol.js";

export class BackendRequestError extends Error {
  readonly code: BackendError["code"];
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly reason?: string;
  constructor(error: BackendError) {
    super(error.message);
    this.name = "BackendRequestError";
    this.code = error.code;
    this.retryable = error.retryable;
    if (error.retryAfterMs !== undefined) this.retryAfterMs = error.retryAfterMs;
    if (error.reason !== undefined) this.reason = error.reason;
  }
}

export type TokenProvider = (options?: {
  force?: boolean;
}) => Promise<string | null>;

const readTokenPayload = (
  token: string | null | undefined,
): { exp?: unknown; sub?: unknown } | null => {
  const segment = token?.split(".")[1];
  if (!segment) return null;
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "=",
  );
  try {
    return JSON.parse(atob(padded)) as { exp?: unknown; sub?: unknown };
  } catch {
    return null;
  }
};

export const backendTokenExpiryMs = (
  token: string | null | undefined,
): number | null => {
  const exp = readTokenPayload(token)?.exp;
  return typeof exp === "number" ? exp * 1000 : null;
};

export const backendTokenSubject = (
  token: string | null | undefined,
): string | null => {
  const sub = readTokenPayload(token)?.sub;
  return typeof sub === "string" ? sub : null;
};

type SocketLike = {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number; reason?: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
};

type SocketConstructor = new (url: string, protocols: string[]) => SocketLike;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type BackendCallOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  idempotent?: boolean;
};

export type BackendLiveTransport = {
  watch(
    view: string,
    args: unknown,
    handlers: {
      onValue: (value: unknown) => void;
      onError: (error: BackendError) => void;
      onUnavailable: () => void;
    },
  ): () => void;
  reconnect(): void;
  nudge(): void;
};

export type BackendClientOptions = {
  baseUrl: string;
  getToken: TokenProvider;
  fetch?: FetchLike;
  WebSocket?: SocketConstructor;
  maxReconnectDelayMs?: number;
  liveTransport?: BackendLiveTransport;
};

type Listener = {
  onValue: (value: unknown) => void;
  onError?: (error: BackendRequestError) => void;
};

type Subscription = {
  id: string;
  view: string;
  args: unknown;
  listeners: Set<Listener>;
  hasValue: boolean;
  value: unknown;
  stopTransport?: () => void;
};

const SOCKET_OPEN = 1;
const PING_INTERVAL_MS = 30_000;
const SILENCE_LIMIT_MS = 2 * PING_INTERVAL_MS + 5_000;
const NUDGE_ANSWER_MS = 5_000;
const IDLE_CLOSE_DELAY_MS = 5_000;

const subscriptionKey = (view: string, args: unknown): string =>
  `${view}\u0000${stableStringify(args)}`;

export const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
    .join(",")}}`;
};

const toError = (error: unknown): BackendRequestError =>
  error instanceof BackendRequestError
    ? error
    : new BackendRequestError({
        code: "UNAVAILABLE",
        message:
          error instanceof Error ? error.message : "The request failed.",
        retryable: true,
        ...(isRequestTimeout(error) ? { reason: "timeout" } : {}),
      });

const isCallerAbort = (error: unknown, signal: AbortSignal | undefined): boolean =>
  signal?.aborted === true && !isRequestTimeout(error);

export class BackendClient {
  private readonly baseUrl: string;
  private readonly getToken: TokenProvider;
  private readonly fetchImpl: FetchLike;
  private readonly SocketImpl: SocketConstructor | undefined;
  private readonly maxReconnectDelayMs: number;
  private liveTransport: BackendLiveTransport | undefined;

  private readonly subscriptions = new Map<string, Subscription>();
  private readonly subscriptionsById = new Map<string, Subscription>();
  private nextSubscriptionId = 1;
  private socket: SocketLike | null = null;
  private connecting = false;
  private connectEpoch = 0;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private nudgeTimer: ReturnType<typeof setTimeout> | null = null;
  private socketHeardAt = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private forceTokenOnConnect = false;
  private socketTokenExpiryMs: number | null = null;
  private socketSubject: string | null | undefined;
  private expectedSubject: string | null | undefined;
  private disposed = false;

  constructor(options: BackendClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.getToken = options.getToken;
    this.fetchImpl = options.fetch ?? ((input, init) => fetch(input, init));
    this.SocketImpl =
      options.WebSocket ??
      (typeof WebSocket === "undefined"
        ? undefined
        : (WebSocket as unknown as SocketConstructor));
    this.maxReconnectDelayMs = options.maxReconnectDelayMs ?? 30_000;
    this.liveTransport = options.liveTransport;
  }

  async call<K extends CallName>(
    name: K,
    args: CallArgs<K>,
    options: BackendCallOptions = {},
  ): Promise<CallResult<K>> {
    const budget = backendCallBudget(name);
    const timeoutMs = options.timeoutMs ?? budget.timeoutMs;
    const idempotent = options.idempotent ?? budget.idempotent;
    return await retryIdempotent(
      async () => {
        try {
          return await withDeadline(
            { label: name, timeoutMs, signal: options.signal },
            async (signal) => await this.callOnce(name, args, signal),
          );
        } catch (error) {
          if (isCallerAbort(error, options.signal)) throw error;
          throw toError(error);
        }
      },
      {
        attempts: idempotent ? 2 : 1,
        signal: options.signal,
        shouldRetry: (error) =>
          error instanceof BackendRequestError &&
          error.retryable &&
          (error.code === "UNAVAILABLE" || error.reason === "timeout"),
        retryAfterMs: (error) =>
          error instanceof BackendRequestError ? error.retryAfterMs : undefined,
      },
    );
  }

  private async callOnce<K extends CallName>(
    name: K,
    args: CallArgs<K>,
    signal: AbortSignal,
  ): Promise<CallResult<K>> {
    let response = await this.postCall(name, args, false, signal);
    if (response.status === 401) {
      await response.body?.cancel().catch(() => undefined);
      response = await this.postCall(name, args, true, signal);
    }
    let body: RpcResponse<CallResult<K>>;
    try {
      body = (await response.json()) as RpcResponse<CallResult<K>>;
    } catch (error) {
      if (signal.aborted) throw signal.reason ?? error;
      throw new BackendRequestError({
        code: response.status >= 500 ? "UNAVAILABLE" : "INTERNAL",
        message: `The backend returned an unreadable response (${response.status}).`,
        retryable: response.status >= 500,
      });
    }
    if (!body.ok) throw new BackendRequestError(body.error);
    return body.value;
  }

  watch<K extends ViewName>(
    view: K,
    args: ViewArgs<K>,
    onValue: (value: ViewResult<K>) => void,
    onError?: (error: BackendRequestError) => void,
  ): () => void {
    if (this.disposed) return () => {};
    const key = subscriptionKey(view, args);
    let subscription = this.subscriptions.get(key);
    if (!subscription) {
      subscription = {
        id: String(this.nextSubscriptionId++),
        view,
        args,
        listeners: new Set(),
        hasValue: false,
        value: undefined,
      };
      this.subscriptions.set(key, subscription);
      this.subscriptionsById.set(subscription.id, subscription);
      if (this.liveTransport) this.openOnTransport(subscription, this.liveTransport);
      else this.sendFrame({ t: "sub", id: subscription.id, view, args });
    }
    const listener: Listener = {
      onValue: onValue as (value: unknown) => void,
      ...(onError ? { onError } : {}),
    };
    subscription.listeners.add(listener);
    if (subscription.hasValue) onValue(subscription.value as ViewResult<K>);
    this.cancelIdleClose();
    this.ensureSocket();
    const owned = subscription;
    return () => {
      owned.listeners.delete(listener);
      if (owned.listeners.size > 0) return;
      this.subscriptions.delete(key);
      this.subscriptionsById.delete(owned.id);
      if (owned.stopTransport) {
        owned.stopTransport();
        return;
      }
      this.sendFrame({ t: "unsub", id: owned.id });
      if (this.subscriptions.size === 0) this.scheduleIdleClose();
    };
  }

  private openOnTransport(
    subscription: Subscription,
    transport: BackendLiveTransport,
  ): void {
    const live = () =>
      this.liveTransport === transport &&
      this.subscriptionsById.get(subscription.id) === subscription;
    subscription.stopTransport = transport.watch(
      subscription.view,
      subscription.args,
      {
        onValue: (value) => {
          if (live()) this.deliverValue(subscription, value);
        },
        onError: (error) => {
          if (live()) this.deliverError(subscription, error);
        },
        onUnavailable: () => {
          if (this.liveTransport === transport) this.leaveTransport();
        },
      },
    );
  }

  private leaveTransport(): void {
    this.liveTransport = undefined;
    for (const subscription of this.subscriptions.values()) {
      subscription.stopTransport?.();
      delete subscription.stopTransport;
    }
    this.ensureSocket();
  }

  read<K extends ViewName>(
    view: K,
    args: ViewArgs<K>,
    options: { signal?: AbortSignal; timeoutMs: number; timeoutMessage?: string },
  ): Promise<ViewResult<K>> {
    const cached = this.subscriptions.get(subscriptionKey(view, args));
    if (cached?.hasValue) return Promise.resolve(cached.value as ViewResult<K>);
    return new Promise((resolve, reject) => {
      const signal = options.signal;
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      let settled = false;
      let stop: (() => void) | undefined;
      const finish = (complete: () => void) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        stop?.();
        complete();
      };
      const onAbort = () => finish(() => reject(signal?.reason));
      const timer = setTimeout(
        () =>
          finish(() =>
            reject(
              new BackendRequestError({
                code: "UNAVAILABLE",
                message: options.timeoutMessage ?? `${view} did not load.`,
                retryable: true,
              }),
            ),
          ),
        options.timeoutMs,
      );
      signal?.addEventListener("abort", onAbort, { once: true });
      const unwatch = this.watch(
        view,
        args,
        (value) => finish(() => resolve(value)),
        (error) => finish(() => reject(error)),
      );
      if (settled) unwatch();
      else stop = unwatch;
    });
  }

  dispose(): void {
    this.disposed = true;
    for (const subscription of this.subscriptions.values()) {
      subscription.stopTransport?.();
    }
    this.subscriptions.clear();
    this.subscriptionsById.clear();
    this.clearTimers();
    this.closeSocket(1000, "client_disposed");
  }

  reconnect(): void {
    this.forceTokenOnConnect = true;
    this.restart();
  }

  private restart(): void {
    this.clearCachedValues();
    if (this.liveTransport) {
      this.liveTransport.reconnect();
      return;
    }
    this.connectEpoch += 1;
    this.connecting = false;
    this.closeSocket(1000, "client_reconnect");
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempt = 0;
    this.ensureSocket();
  }

  nudge(): void {
    if (this.disposed) return;
    if (this.liveTransport) {
      this.liveTransport.nudge();
      return;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
      this.reconnectAttempt = 0;
      this.ensureSocket();
      return;
    }
    const socket = this.socket;
    if (!socket || socket.readyState !== SOCKET_OPEN || this.nudgeTimer) return;
    const askedAt = Date.now();
    this.sendKeepalive();
    this.nudgeTimer = setTimeout(() => {
      this.nudgeTimer = null;
      if (this.socket !== socket || this.socketHeardAt >= askedAt) return;
      this.closeSocket(4001, "silent");
      this.reconnectAttempt = 0;
      if (this.subscriptions.size > 0) this.scheduleReconnect();
    }, NUDGE_ANSWER_MS);
  }

  noteSubject(subject: string | null): void {
    this.expectedSubject = subject;
    if (subject === null || !this.servesSubject(subject)) this.restart();
  }

  servesSubject(subject: string): boolean {
    if (this.connecting && this.socketSubject === undefined) return true;
    return (
      (this.connecting || this.socket !== null) && this.socketSubject === subject
    );
  }

  private async postCall(
    name: string,
    args: unknown,
    force: boolean,
    signal: AbortSignal,
  ): Promise<Response> {
    const token = force
      ? await this.getToken({ force: true }).catch(
          async () => await this.getToken(),
        )
      : await this.getToken();
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    if (token) headers.authorization = `Bearer ${token}`;
    try {
      return await this.fetchImpl(`${this.baseUrl}${rpcPath(name)}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ args: args ?? {} }),
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw signal.reason ?? error;
      throw toError(error);
    }
  }

  private ensureSocket(): void {
    if (
      this.disposed ||
      this.liveTransport ||
      this.socket ||
      this.connecting ||
      this.reconnectTimer ||
      this.subscriptions.size === 0 ||
      !this.SocketImpl
    ) {
      return;
    }
    this.connecting = true;
    this.socketSubject = undefined;
    const epoch = this.connectEpoch;
    const force = this.forceTokenOnConnect;
    this.forceTokenOnConnect = false;
    void withDeadline(
      { label: "Connecting to Stella's cloud", timeoutMs: REQUEST_BUDGET_MS.connect },
      async () => {
        const token = await this.getToken(force ? { force: true } : undefined);
        if (epoch === this.connectEpoch) {
          const subject = backendTokenSubject(token);
          if (subject && this.expectedSubject && subject !== this.expectedSubject) {
            throw new Error("The account changed while connecting.");
          }
          this.socketSubject = subject;
        }
        if (!token || this.disposed || this.subscriptions.size === 0) {
          return { token, credential: null };
        }
        const credential = await socketCredentialProtocol({
          socketUrl: this.liveSocketUrl(),
          token,
          purpose: "live",
          fetchImpl: this.fetchImpl,
        });
        return { token, credential };
      },
    )
      .then(({ token, credential }) => {
        if (epoch !== this.connectEpoch) return;
        this.connecting = false;
        if (this.disposed || this.subscriptions.size === 0) return;
        if (!token) {
          this.failAll({
            code: "UNAUTHENTICATED",
            message: "Sign in to load this.",
            retryable: false,
          });
          this.scheduleReconnect();
          return;
        }
        if (credential) this.openSocket(token, credential);
      })
      .catch(() => {
        if (epoch !== this.connectEpoch) return;
        this.connecting = false;
        if (force) this.forceTokenOnConnect = true;
        this.scheduleReconnect();
      });
  }

  private liveSocketUrl(): string {
    return `${this.baseUrl.replace(/^http/, "ws")}${LIVE_PATH}`;
  }

  private openSocket(token: string, credential: string): void {
    const url = this.liveSocketUrl();
    this.socketTokenExpiryMs = backendTokenExpiryMs(token);
    let socket: SocketLike;
    try {
      socket = new this.SocketImpl!(url, [LIVE_SUBPROTOCOL, credential]);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    this.clearConnectTimer();
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      if (this.socket !== socket || socket.readyState === SOCKET_OPEN) return;
      this.closeSocket(4002, "connect_timeout");
      if (this.subscriptions.size > 0) this.scheduleReconnect();
    }, REQUEST_BUDGET_MS.connect);
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.clearConnectTimer();
      for (const subscription of this.subscriptions.values()) {
        this.sendFrame({
          t: "sub",
          id: subscription.id,
          view: subscription.view,
          args: subscription.args,
        });
      }
      this.startPing();
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      this.socketHeardAt = Date.now();
      this.reconnectAttempt = 0;
      this.handleFrame(event.data);
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.socketSubject = undefined;
      this.stopPing();
      if (event.code === LIVE_CLOSE.unauthenticated) {
        this.clearCachedValues();
        this.forceTokenOnConnect = true;
      }
      if (this.disposed || this.subscriptions.size === 0) return;
      if (
        event.code === LIVE_CLOSE.unauthenticated &&
        event.reason === LIVE_SESSION_REVOKED
      ) {
        this.failAll({
          code: "UNAUTHENTICATED",
          message: "This session was signed out.",
          retryable: false,
        });
      }
      if (event.code === LIVE_CLOSE.protocol) {
        this.failAll({
          code: "BAD_REQUEST",
          message: event.reason || "The live connection was refused.",
          retryable: false,
        });
        return;
      }
      this.scheduleReconnect();
    };
    socket.onerror = () => {};
  }

  private handleFrame(data: unknown): void {
    let frame: LiveServerFrame;
    try {
      frame = JSON.parse(
        typeof data === "string" ? data : String(data),
      ) as LiveServerFrame;
    } catch {
      return;
    }
    if (frame.t === "value") {
      const subscription = this.subscriptionsById.get(frame.id);
      if (!subscription) return;
      this.deliverValue(subscription, frame.value);
      return;
    }
    if (frame.t === "error") {
      const subscription = this.subscriptionsById.get(frame.id);
      if (!subscription) return;
      this.deliverError(subscription, frame.error);
      return;
    }
    if (frame.t === "reauth") {
      void this.getToken({ force: true })
        .then((token) => {
          if (!token) return;
          const expiry = backendTokenExpiryMs(token);
          const current = this.socketTokenExpiryMs;
          if (expiry !== null && current !== null && expiry <= current) return;
          this.socketTokenExpiryMs = expiry;
          this.sendFrame({ t: "auth", token });
        })
        .catch(() => {});
    }
  }

  private deliverValue(subscription: Subscription, value: unknown): void {
    subscription.hasValue = true;
    subscription.value = value;
    this.eachListener(subscription, (listener) => listener.onValue(value));
  }

  private deliverError(subscription: Subscription, error: BackendError): void {
    if (error.code === "UNAUTHENTICATED") {
      subscription.hasValue = false;
      subscription.value = undefined;
    }
    const failure = new BackendRequestError(error);
    this.eachListener(subscription, (listener) => listener.onError?.(failure));
  }

  private eachListener(
    subscription: Subscription,
    notify: (listener: Listener) => void,
  ): void {
    for (const listener of [...subscription.listeners]) {
      try {
        notify(listener);
      } catch (error) {
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  }

  private clearCachedValues(): void {
    for (const subscription of this.subscriptions.values()) {
      subscription.hasValue = false;
      subscription.value = undefined;
    }
  }

  private failAll(error: BackendError): void {
    for (const subscription of [...this.subscriptions.values()]) {
      this.deliverError(subscription, error);
    }
  }

  private sendFrame(frame: LiveClientFrame): void {
    this.sendRaw(JSON.stringify(frame));
  }

  private sendKeepalive(): void {
    this.sendRaw(SOCKET_KEEPALIVE_PING);
  }

  private sendRaw(data: string): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== SOCKET_OPEN) return;
    try {
      socket.send(data);
    } catch {}
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer) return;
    const base = Math.min(
      this.maxReconnectDelayMs,
      250 * 2 ** Math.min(this.reconnectAttempt, 10),
    );
    this.reconnectAttempt += 1;
    const delay = base / 2 + Math.random() * (base / 2);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureSocket();
    }, delay);
  }

  private scheduleIdleClose(): void {
    this.cancelIdleClose();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.subscriptions.size === 0) this.closeSocket(1000, "idle");
    }, IDLE_CLOSE_DELAY_MS);
  }

  private cancelIdleClose(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private startPing(): void {
    this.stopPing();
    this.socketHeardAt = Date.now();
    this.pingTimer = setInterval(() => {
      if (Date.now() - this.socketHeardAt > SILENCE_LIMIT_MS) {
        this.closeSocket(4001, "silent");
        if (this.subscriptions.size > 0) this.scheduleReconnect();
        return;
      }
      this.sendKeepalive();
    }, PING_INTERVAL_MS);
  }

  private stopPing(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.nudgeTimer) {
      clearTimeout(this.nudgeTimer);
      this.nudgeTimer = null;
    }
  }

  private clearConnectTimer(): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  private clearTimers(): void {
    this.clearConnectTimer();
    this.stopPing();
    this.cancelIdleClose();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private closeSocket(code: number, reason: string): void {
    const socket = this.socket;
    this.socket = null;
    this.socketSubject = undefined;
    this.clearConnectTimer();
    this.stopPing();
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      try {
        socket.close(code, reason);
      } catch {}
    }
  }
}
