export const RPC_PATH_PREFIX = "/api/rpc/";
export const LIVE_PATH = "/owners/me/live";
export const LIVE_SUBPROTOCOL = "stella.live.v1";
export const LIVE_TOKEN_SUBPROTOCOL_PREFIX = "stella.token.";

export const rpcPath = (name: string): string =>
  `${RPC_PATH_PREFIX}${encodeURIComponent(name)}`;

export type BackendErrorCode =
  | "BAD_REQUEST"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "UNAVAILABLE"
  | "INTERNAL";

export type BackendError = {
  code: BackendErrorCode;
  message: string;
  retryable: boolean;
  retryAfterMs?: number;
  reason?: string;
};

export const OWNER_GENERATION_STALE = "owner_generation_stale";

export type RpcResponse<T = unknown> =
  | { ok: true; value: T }
  | { ok: false; error: BackendError };

export const rpcErrorStatus = (code: BackendErrorCode): number => {
  switch (code) {
    case "BAD_REQUEST":
      return 400;
    case "UNAUTHENTICATED":
      return 401;
    case "FORBIDDEN":
      return 403;
    case "NOT_FOUND":
      return 404;
    case "CONFLICT":
      return 409;
    case "RATE_LIMITED":
      return 429;
    case "UNAVAILABLE":
      return 503;
    case "INTERNAL":
      return 500;
  }
};

/**
 * Cloudflare's hibernation auto-response matches the request byte for byte, so
 * these are bare strings, not JSON.
 */
export const SOCKET_KEEPALIVE_PING = "ping";
export const SOCKET_KEEPALIVE_PONG = "pong";

export type LiveClientFrame =
  | { t: "sub"; id: string; view: string; args: unknown }
  | { t: "unsub"; id: string }
  | { t: "auth"; token: string }
  | { t: "ping" };

export type LiveServerFrame =
  | { t: "value"; id: string; value: unknown }
  | { t: "error"; id: string; error: BackendError }
  | { t: "reauth"; expiresAtMs: number }
  | { t: "pong" };

export const LIVE_CLOSE = {
  unauthenticated: 4401,
  protocol: 4400,
  internal: 4500,
} as const;

export const LIVE_SESSION_REVOKED = "session_revoked";

export const LIVE_MAX_FRAME_BYTES = 64 * 1024;
export const LIVE_MAX_SUBSCRIPTIONS = 128;
