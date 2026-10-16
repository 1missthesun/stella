import {
  REQUEST_BUDGET_MS,
  isTransientRequestError,
  retryIdempotent,
  withDeadline,
} from "@stella/contracts/request-deadline";
import { env } from "../config/env";
import { assert } from "./assert";
import { getAuthToken } from "./auth-token";

type JsonRequest =
  | { method: "GET" }
  | { method: "POST" | "PUT"; body: string };

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

type RequestOptions = {
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
  origin?: string;
  label?: string;
};

const isRetryableLookupFailure = (error: unknown): boolean =>
  error instanceof HttpRequestError
    ? error.status === 502 || error.status === 503 || error.status === 504
    : isTransientRequestError(error);

async function sendRequest<T>(
  path: string,
  request: JsonRequest,
  contentType: string | null,
  options: RequestOptions | undefined,
  read: (response: Response) => Promise<T>,
): Promise<T> {
  const origin = options?.origin?.replace(/\/+$/, "") || backendOrigin();
  const lookup = request.method === "GET";
  const attempt = () =>
    withDeadline(
      {
        label: options?.label ?? (lookup ? "loading" : "sending"),
        timeoutMs:
          options?.timeoutMs ??
          (lookup ? REQUEST_BUDGET_MS.lookup : REQUEST_BUDGET_MS.call),
        signal: options?.signal,
      },
      async (signal) => {
        const response = await fetch(`${origin}${path}`, {
          ...request,
          headers: {
            Authorization: `Bearer ${await getAuthToken()}`,
            ...(contentType ? { "Content-Type": contentType } : {}),
            ...options?.headers,
          },
          signal,
        });
        if (!response.ok) {
          const detail = await readErrorDetail(response);
          throw new HttpRequestError(detail.message, response.status, detail.code);
        }
        return await read(response);
      },
    );
  try {
    return lookup
      ? await retryIdempotent(attempt, {
          attempts: 2,
          signal: options?.signal,
          shouldRetry: isRetryableLookupFailure,
        })
      : await attempt();
  } catch (error) {
    if (options?.signal?.aborted) throw new StreamAbortError();
    throw error;
  }
}

const readJson = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(GENERIC_REQUEST_FAILURE);
  }
};

export const backendOrigin = (): string => {
  const origin = env.backendUrl?.trim();
  assert(origin, "EXPO_PUBLIC_STELLA_BACKEND_URL is not configured.");
  return origin;
};

export const getJson = (path: string, options?: RequestOptions) =>
  sendRequest(path, { method: "GET" }, null, options, readJson);

export const postJson = (path: string, body: unknown, options?: RequestOptions) =>
  sendRequest(
    path,
    { method: "POST", body: JSON.stringify(body) },
    "application/json",
    options,
    readJson,
  );

export const putJson = (path: string, body: unknown, options?: RequestOptions) =>
  sendRequest(
    path,
    { method: "PUT", body: JSON.stringify(body) },
    "application/json",
    options,
    readJson,
  );

export const postText = (
  path: string,
  body: string,
  options?: Omit<RequestOptions, "origin">,
): Promise<string> =>
  sendRequest(
    path,
    { method: "POST", body },
    "text/plain",
    options,
    async (response) => await response.text(),
  );
