import { env } from "../config/env";
import { assert } from "./assert";
import { getAuthToken } from "./auth-token";

type JsonRequest =
  | {
      method: "GET";
      headers?: Record<string, string>;
    }
  | {
      method: "POST" | "PUT";
      body: string;
      headers?: Record<string, string>;
    };

export class StreamAbortError extends Error {
  constructor() {
    super("aborted");
    this.name = "AbortError";
  }
}

export class HttpRequestError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(message: string, status: number, code: string | null) {
    super(message);
    this.name = "HttpRequestError";
    this.status = status;
    this.code = code;
  }
}

const GENERIC_REQUEST_FAILURE = "Could not complete that request. Try again.";

const readErrorDetail = async (
  response: Response,
): Promise<{ message: string; code: string | null }> => {
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { message: GENERIC_REQUEST_FAILURE, code: null };
  }
  if (parsed && typeof parsed === "object") {
    const o = parsed as Record<string, unknown>;
    if (typeof o.error === "string" && o.error.trim()) {
      return { message: o.error.trim(), code: null };
    }
    if (o.error && typeof o.error === "object") {
      const detail = o.error as Record<string, unknown>;
      return {
        message:
          typeof detail.message === "string" && detail.message.trim()
            ? detail.message.trim()
            : GENERIC_REQUEST_FAILURE,
        code: typeof detail.code === "string" ? detail.code : null,
      };
    }
    if (typeof o.message === "string" && o.message.trim()) {
      return { message: o.message.trim(), code: null };
    }
  }
  return { message: GENERIC_REQUEST_FAILURE, code: null };
};

const REQUEST_TIMEOUT_MS = 15_000;

async function requestJson(
  path: string,
  request: JsonRequest,
  options?: {
    timeoutMs?: number;
    signal?: AbortSignal;
    origin?: string;
  },
) {
  const origin = options?.origin?.replace(/\/+$/, "") || backendOrigin();
  const authHeader = `Bearer ${await getAuthToken()}`;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(
    () => {
      timedOut = true;
      controller.abort();
    },
    options?.timeoutMs ?? REQUEST_TIMEOUT_MS,
  );
  const onAbort = () => controller.abort();
  if (options?.signal?.aborted) controller.abort();
  else options?.signal?.addEventListener("abort", onAbort, { once: true });
  let response: Response;
  try {
    response = await fetch(`${origin}${path}`, {
      ...request,
      headers: {
        Authorization: authHeader,
        ...(request.method === "GET"
          ? {}
          : { "Content-Type": "application/json" }),
        ...request.headers,
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (options?.signal?.aborted) {
      throw new StreamAbortError();
    }
    if (timedOut) {
      throw new Error("Request timed out. Try again.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
    options?.signal?.removeEventListener("abort", onAbort);
  }

  if (!response.ok) {
    const detail = await readErrorDetail(response);
    throw new HttpRequestError(detail.message, response.status, detail.code);
  }

  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Could not complete that request. Try again.");
  }
}

export const backendOrigin = (): string => {
  const origin = env.backendUrl?.trim();
  assert(origin, "EXPO_PUBLIC_STELLA_BACKEND_URL is not configured.");
  return origin;
};

export const getJson = (
  path: string,
  options?: {
    headers?: Record<string, string>;
    timeoutMs?: number;
    signal?: AbortSignal;
    origin?: string;
  },
) =>
  requestJson(
    path,
    { method: "GET", headers: options?.headers },
    {
      timeoutMs: options?.timeoutMs,
      signal: options?.signal,
      ...(options?.origin ? { origin: options.origin } : {}),
    },
  );

export const postJson = (
  path: string,
  body: unknown,
  options?: {
    headers?: Record<string, string>;
    timeoutMs?: number;
    signal?: AbortSignal;
    origin?: string;
  },
) =>
  requestJson(
    path,
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: options?.headers,
    },
    {
      timeoutMs: options?.timeoutMs,
      signal: options?.signal,
      ...(options?.origin ? { origin: options.origin } : {}),
    },
  );

export const putJson = (
  path: string,
  body: unknown,
  options?: {
    headers?: Record<string, string>;
    timeoutMs?: number;
    signal?: AbortSignal;
    origin?: string;
  },
) =>
  requestJson(
    path,
    {
      method: "PUT",
      body: JSON.stringify(body),
      headers: options?.headers,
    },
    {
      timeoutMs: options?.timeoutMs,
      signal: options?.signal,
      ...(options?.origin ? { origin: options.origin } : {}),
    },
  );

export const postText = async (
  path: string,
  body: string,
  options?: {
    headers?: Record<string, string>;
    timeoutMs?: number;
    signal?: AbortSignal;
  },
): Promise<string> => {
  const origin = backendOrigin();
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options?.timeoutMs ?? REQUEST_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  if (options?.signal?.aborted) controller.abort();
  else options?.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(`${origin}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await getAuthToken()}`,
        "Content-Type": "text/plain",
        ...options?.headers,
      },
      body,
      signal: controller.signal,
    });
    if (!response.ok) {
      const detail = await readErrorDetail(response);
      throw new HttpRequestError(detail.message, response.status, detail.code);
    }
    return await response.text();
  } catch (error) {
    if (options?.signal?.aborted) throw new StreamAbortError();
    if (timedOut) throw new Error("Request timed out. Try again.");
    throw error;
  } finally {
    clearTimeout(timer);
    options?.signal?.removeEventListener("abort", onAbort);
  }
};
