import {
  APP_SOURCE_RELEASES_PATH,
  type AppSourceReleaseFrame,
} from "@stella/contracts/backend/app-source";
import {
  SOCKET_KEEPALIVE_PING,
  SOCKET_KEEPALIVE_PONG,
} from "@stella/contracts/backend/protocol";
import { REQUEST_BUDGET_MS } from "@stella/contracts/request-deadline";

const PING_INTERVAL_MS = 30_000;
const SILENCE_LIMIT_MS = 2 * PING_INTERVAL_MS + 5_000;
const MIN_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 5 * 60_000;

export type ReleaseChannelOptions = {
  onPublished: (version: string | null) => void;
  log: (event: string, data?: Record<string, unknown>) => void;
};

export class ReleaseChannel {
  private readonly options: ReleaseChannelOptions;
  private baseUrl: string | null = null;
  private socket: WebSocket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private connectTimer: NodeJS.Timeout | null = null;
  private heardAt = 0;
  private attempt = 0;

  constructor(options: ReleaseChannelOptions) {
    this.options = options;
  }

  follow(baseUrl: string | null) {
    const next = baseUrl ? baseUrl.replace(/\/+$/, "") : null;
    if (next === this.baseUrl) return;
    this.baseUrl = next;
    this.attempt = 0;
    this.close();
    if (next) this.connect();
  }

  dispose() {
    this.baseUrl = null;
    this.close();
  }

  private connect() {
    const baseUrl = this.baseUrl;
    if (!baseUrl || this.socket) return;
    const url = `${baseUrl.replace(/^http/, "ws")}${APP_SOURCE_RELEASES_PATH}`;
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch (error) {
      this.options.log("app-source.release-channel-failed", {
        message: error instanceof Error ? error.message : String(error),
      });
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      if (this.socket !== socket || socket.readyState !== WebSocket.CONNECTING) return;
      this.socket = null;
      this.options.log("app-source.release-channel-failed", {
        message: "connect timed out",
      });
      try {
        socket.close();
      } catch {
        // Already gone.
      }
      this.scheduleReconnect();
    }, REQUEST_BUDGET_MS.connect);
    this.connectTimer.unref?.();
    socket.onopen = () => {
      this.clearConnectTimer();
      this.heardAt = Date.now();
      this.startPing(socket);
    };
    socket.onmessage = (event) => {
      this.heardAt = Date.now();
      if (event.data === SOCKET_KEEPALIVE_PONG) return;
      let frame: AppSourceReleaseFrame | null = null;
      try {
        frame = JSON.parse(String(event.data)) as AppSourceReleaseFrame;
      } catch {
        return;
      }
      if (frame?.t !== "published") return;
      this.attempt = 0;
      const version =
        typeof frame.version === "string" && /^[0-9a-f]{40,64}$/.test(frame.version)
          ? frame.version
          : null;
      this.options.onPublished(version);
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.clearConnectTimer();
      this.stopPing();
      this.options.log("app-source.release-channel-closed", {
        code: event.code,
      });
      this.scheduleReconnect();
    };
    socket.onerror = () => {
      // `onclose` follows and reconnects.
    };
  }

  private startPing(socket: WebSocket) {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (Date.now() - this.heardAt > SILENCE_LIMIT_MS) {
        this.socket = null;
        this.stopPing();
        try {
          socket.close();
        } catch {
          // Already gone.
        }
        this.scheduleReconnect();
        return;
      }
      try {
        socket.send(SOCKET_KEEPALIVE_PING);
      } catch {
        // `onclose` reconnects.
      }
    }, PING_INTERVAL_MS);
    this.pingTimer.unref?.();
  }

  private clearConnectTimer() {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = null;
  }

  private stopPing() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private scheduleReconnect() {
    if (!this.baseUrl || this.reconnectTimer) return;
    const base = Math.min(MAX_RECONNECT_MS, MIN_RECONNECT_MS * 2 ** this.attempt);
    this.attempt += 1;
    const delay = base / 2 + Math.random() * (base / 2);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private close() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.clearConnectTimer();
    this.stopPing();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      try {
        socket.close();
      } catch {
        // Already gone.
      }
    }
  }
}
