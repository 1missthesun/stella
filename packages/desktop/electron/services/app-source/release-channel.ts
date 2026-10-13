import {
  APP_SOURCE_RELEASES_PATH,
  type AppSourceReleaseFrame,
} from "@stella/contracts/backend/app-source";
import {
  SOCKET_KEEPALIVE_PING,
  SOCKET_KEEPALIVE_PONG,
} from "@stella/contracts/backend/protocol";

/**
 * The backend's release channel (contracts `APP_SOURCE_RELEASES_PATH`): it
 * sends the published version on connect and again on every publish, so the
 * desktop never asks. The socket reconnects when it drops (sleep, network
 * change, backend deploy), and each connect brings the current version, which
 * is how a desktop that missed a publish catches up.
 *
 * The keepalive ping is answered by the platform without waking the backend;
 * it only exists so a socket that died silently (after sleep) is noticed and
 * replaced.
 */

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
  private heardAt = 0;
  private attempt = 0;

  constructor(options: ReleaseChannelOptions) {
    this.options = options;
  }

  /** Follow this backend's channel; null closes it. Idempotent. */
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
    socket.onopen = () => {
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
      // A frame means the channel works; back off from scratch next time.
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
        // Dead without a close (the computer slept): replace it.
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
