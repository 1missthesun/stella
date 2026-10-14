import type {
  BackendError,
  BackendErrorCode,
  RpcResponse,
} from "@stella/contracts/backend/protocol";

export class RpcError extends Error {
  readonly code: BackendErrorCode;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly reason?: string;
  constructor(
    code: BackendErrorCode,
    message: string,
    options: { retryable?: boolean; retryAfterMs?: number; reason?: string } = {},
  ) {
    super(message);
    this.name = "RpcError";
    this.code = code;
    this.retryable =
      options.retryable ??
      (code === "UNAVAILABLE" || code === "RATE_LIMITED");
    if (options.retryAfterMs !== undefined) {
      this.retryAfterMs = options.retryAfterMs;
    }
    if (options.reason !== undefined) this.reason = options.reason;
  }
}

export const toBackendError = (error: unknown): BackendError =>
  error instanceof RpcError
    ? {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        ...(error.retryAfterMs !== undefined
          ? { retryAfterMs: error.retryAfterMs }
          : {}),
        ...(error.reason !== undefined ? { reason: error.reason } : {}),
      }
    : {
        code: "INTERNAL",
        message: "Stella hit an error. Try again.",
        retryable: true,
      };

export const unwrapRpc = (response: RpcResponse): unknown => {
  if (response.ok) return response.value;
  const { code, message, retryable, retryAfterMs, reason } = response.error;
  throw new RpcError(code, message, {
    retryable,
    ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    ...(reason !== undefined ? { reason } : {}),
  });
};
