import { rpcErrorStatus, type BackendErrorCode } from "@stella/contracts/backend/protocol";

export const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

export const fail = (status: number, error: string, extra: Record<string, unknown> = {}): Response =>
  json({ error, ...extra }, status);

export const failRpcError = (
  error: { code: BackendErrorCode; message: string },
  extra: Record<string, unknown> = {},
): Response => fail(rpcErrorStatus(error.code), error.message, extra);
