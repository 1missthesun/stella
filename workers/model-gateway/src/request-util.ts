import {
  GATEWAY_AGENT_TYPE_HEADER,
  GATEWAY_MAX_REQUEST_BODY_BYTES,
  GATEWAY_REQUEST_ID_HEADER,
} from "@stella/contracts/gateway/api";
import { GatewayError } from "./errors.js";

export type GatewayDeps = {
  fetch: typeof fetch;
  now: () => number;
  waitUntil: (promise: Promise<unknown>) => void;
  beforeProviderDispatch?: () => Promise<void>;
};

export const defaultDeps = (
  ctx: Pick<ExecutionContext, "waitUntil">,
): GatewayDeps => ({
  fetch: globalThis.fetch.bind(globalThis),
  now: Date.now,
  waitUntil: (promise) => ctx.waitUntil(promise),
});

const readBoundedBytes = async (
  request: Request,
  maximumBytes: number,
): Promise<Uint8Array> => {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new GatewayError(
      413,
      "body_too_large",
      "The request body is too large.",
    );
  }
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("body_too_large");
        throw new GatewayError(
          413,
          "body_too_large",
          "The request body is too large.",
        );
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

export const readJsonObject = async (
  request: Request,
  options: { allowEmpty?: boolean; maximumBytes?: number } = {},
): Promise<Record<string, unknown>> => {
  const bytes = await readBoundedBytes(
    request,
    options.maximumBytes ?? GATEWAY_MAX_REQUEST_BODY_BYTES,
  );
  if (bytes.byteLength === 0) {
    if (options.allowEmpty) return {};
    throw new GatewayError(
      400,
      "bad_request",
      "The request body must be a JSON object.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes),
    );
  } catch {
    throw new GatewayError(
      400,
      "bad_request",
      "The request body must be valid JSON.",
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new GatewayError(
      400,
      "bad_request",
      "The request body must be a JSON object.",
    );
  }
  return parsed as Record<string, unknown>;
};

const REQUEST_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;

export const isGatewayRequestId = (value: unknown): value is string =>
  typeof value === "string" && REQUEST_ID_PATTERN.test(value);

export const requestIdFrom = (
  request: Request,
): { requestId: string; callerMinted: boolean } => {
  const header = request.headers.get(GATEWAY_REQUEST_ID_HEADER)?.trim();
  if (header && isGatewayRequestId(header)) {
    return { requestId: header, callerMinted: true };
  }
  return { requestId: crypto.randomUUID(), callerMinted: false };
};

const AGENT_TYPE_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/u;

export const agentTypeFrom = (request: Request): string | null => {
  const header = request.headers.get(GATEWAY_AGENT_TYPE_HEADER)?.trim();
  return header && AGENT_TYPE_PATTERN.test(header) ? header : null;
};

export const clientIp = (request: Request): string =>
  request.headers.get("cf-connecting-ip")?.trim() || "unknown";

export const sha256Hex = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
};

export const ipHashFrom = async (request: Request): Promise<string> =>
  (await sha256Hex(clientIp(request))).slice(0, 32);

export type AbortCause = "client" | "idle" | "duration" | "budget";

export const createUpstreamController = (args: {
  clientSignal: AbortSignal;
  idleTimeoutMs: number;
  maxDurationMs: number;
}): {
  signal: AbortSignal;
  touch(): void;
  abort(reason: AbortCause): void;
  cause(): AbortCause | null;
  dispose(): void;
} => {
  const controller = new AbortController();
  let cause: AbortCause | null = null;
  let disposed = false;
  let durationTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const onClientAbort = (): void => abort("client");
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    if (durationTimer !== null) clearTimeout(durationTimer);
    if (idleTimer !== null) clearTimeout(idleTimer);
    args.clientSignal.removeEventListener("abort", onClientAbort);
  };
  const abort = (reason: AbortCause): void => {
    if (cause) return;
    cause = reason;
    dispose();
    controller.abort(reason);
  };
  if (args.clientSignal.aborted) abort("client");
  else {
    args.clientSignal.addEventListener("abort", onClientAbort, { once: true });
    durationTimer = setTimeout(() => abort("duration"), args.maxDurationMs);
    idleTimer = setTimeout(() => abort("idle"), args.idleTimeoutMs);
  }
  return {
    signal: controller.signal,
    touch() {
      if (disposed) return;
      if (idleTimer !== null) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => abort("idle"), args.idleTimeoutMs);
    },
    abort,
    cause: () => cause,
    dispose,
  };
};

/**
 * Streams `body` to the client and disposes `controller` exactly once, when
 * the body ends, fails, or the client cancels it.
 */
export const ownedResponseBody = (
  body: ReadableStream<Uint8Array>,
  controller: { dispose(): void },
): ReadableStream<Uint8Array> => {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(stream) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        controller.dispose();
        stream.error(error);
        return;
      }
      if (chunk.done) {
        controller.dispose();
        stream.close();
        return;
      }
      stream.enqueue(chunk.value);
    },
    async cancel(reason) {
      controller.dispose();
      await reader.cancel(reason).catch(() => undefined);
    },
  });
};
