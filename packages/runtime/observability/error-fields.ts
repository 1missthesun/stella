export const errorDiagnosticFields = (
  error: unknown,
): Record<string, string | number> => {
  if (!(error instanceof Error)) return { errorMessage: String(error) };
  const errno = error as NodeJS.ErrnoException;
  return {
    errorName: error.name,
    errorMessage: error.message,
    ...(typeof errno.code === "string" ? { errorCode: errno.code } : {}),
    ...(typeof errno.syscall === "string" ? { syscall: errno.syscall } : {}),
    ...(typeof errno.errno === "number" ? { errno: errno.errno } : {}),
    ...(error.stack ? { stack: error.stack } : {}),
  };
};

const PEER_DISCONNECT_CODES = new Set([
  "EPIPE",
  "ECONNRESET",
  "ECONNABORTED",
  "ENOTCONN",
  "ERR_STREAM_DESTROYED",
  "ERR_STREAM_WRITE_AFTER_END",
]);

export const isPeerDisconnectError = (error: unknown): boolean =>
  error instanceof Error &&
  PEER_DISCONNECT_CODES.has(String((error as NodeJS.ErrnoException).code));
