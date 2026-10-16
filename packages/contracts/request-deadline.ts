// Plain timers and AbortController only: Hermes (mobile) lacks AbortSignal.timeout/any.

export const REQUEST_BUDGET_MS = {
  lookup: 15_000,
  call: 30_000,
  slow: 120_000,
  connect: 15_000,
  transferIdle: 60_000,
  streamIdle: 300_000,
} as const;

const MIN_TRANSFER_BYTES_PER_SECOND = 128 * 1024;

export const transferBudgetMs = (bytes: number | null | undefined): number =>
  REQUEST_BUDGET_MS.transferIdle +
  Math.ceil((Math.max(0, bytes ?? 0) / MIN_TRANSFER_BYTES_PER_SECOND) * 1000);

export class RequestTimeoutError extends Error {
  readonly label: string;
  readonly timeoutMs: number;
  readonly kind: "deadline" | "inactivity";
  readonly retryable = true;
  constructor(label: string, timeoutMs: number, kind: "deadline" | "inactivity" = "deadline") {
    super(
      kind === "inactivity"
        ? `Stella's cloud stopped responding for ${formatSeconds(timeoutMs)} (${label}).`
        : `Stella's cloud did not answer within ${formatSeconds(timeoutMs)} (${label}).`,
    );
    this.name = "RequestTimeoutError";
    this.label = label;
    this.timeoutMs = timeoutMs;
    this.kind = kind;
  }
}

const formatSeconds = (ms: number): string => {
  const seconds = Math.round(ms / 1000);
  return seconds >= 120 ? `${Math.round(seconds / 60)} min` : `${seconds}s`;
};

export const isRequestTimeout = (error: unknown): error is RequestTimeoutError =>
  error instanceof RequestTimeoutError ||
  (error instanceof Error && error.name === "RequestTimeoutError");

const abortReason = (signal: AbortSignal): unknown =>
  signal.reason ?? Object.assign(new Error("The request was canceled."), { name: "AbortError" });

export type DeadlineOptions = {
  label: string;
  timeoutMs: number;
  signal?: AbortSignal | null | undefined;
};

/** Settles at the deadline (or the caller's abort) even when `work` ignores its signal. */
export const withDeadline = <T>(
  options: DeadlineOptions,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> => {
  const caller = options.signal ?? null;
  if (caller?.aborted) return Promise.reject(abortReason(caller));
  const controller = new AbortController();
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      caller?.removeEventListener("abort", onCallerAbort);
      complete();
    };
    const fail = (reason: unknown) => {
      finish(() => reject(reason));
      if (!controller.signal.aborted) controller.abort(reason);
    };
    const onCallerAbort = () => fail(abortReason(caller!));
    const timer = setTimeout(
      () => fail(new RequestTimeoutError(options.label, options.timeoutMs)),
      Math.max(0, options.timeoutMs),
    );
    caller?.addEventListener("abort", onCallerAbort, { once: true });
    let running: Promise<T>;
    try {
      running = work(controller.signal);
    } catch (error) {
      fail(error);
      return;
    }
    running.then(
      (value) => finish(() => resolve(value)),
      (error) => {
        const reason = controller.signal.aborted ? controller.signal.reason ?? error : error;
        finish(() => reject(reason));
      },
    );
  });
};

/**
 * For text/JSON responses: the deadline covers the headers and the whole body
 * read. Rebuilt from text since React Native's fetch decodes ArrayBuffer bodies as Latin-1.
 */
export const fetchWithDeadline = async (
  fetchImpl: (input: string, init: RequestInit) => Promise<Response>,
  url: string,
  init: RequestInit,
  options: DeadlineOptions,
): Promise<Response> =>
  await withDeadline(options, async (signal) => {
    const response = await fetchImpl(url, { ...init, signal });
    const body = await response.text();
    return new Response(nullBodyStatus(response.status) ? null : body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  });

const nullBodyStatus = (status: number): boolean =>
  status === 101 || status === 204 || status === 205 || status === 304;

/** Errors the body once no bytes arrive for `idleMs`. Needs ReadableStream bodies (not mobile). */
export const withIdleBody = (
  response: Response,
  options: { label: string; idleMs: number; onStall?: (error: RequestTimeoutError) => void },
): Response => {
  const source = response.body;
  if (!source) return response;
  const reader = source.getReader();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stalled = false;
  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const body = new ReadableStream<Uint8Array>({
    pull: (controller) =>
      new Promise<void>((resolve) => {
        clear();
        timer = setTimeout(() => {
          stalled = true;
          const error = new RequestTimeoutError(options.label, options.idleMs, "inactivity");
          options.onStall?.(error);
          controller.error(error);
          void reader.cancel(error).catch(() => undefined);
          resolve();
        }, options.idleMs);
        reader.read().then(
          (chunk) => {
            clear();
            if (stalled) return;
            if (chunk.done) controller.close();
            else controller.enqueue(chunk.value);
            resolve();
          },
          (error) => {
            clear();
            if (stalled) return;
            controller.error(error);
            resolve();
          },
        );
      }),
    cancel: (reason) => {
      clear();
      return reader.cancel(reason);
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
};

const rejectOnAbort = (signal: AbortSignal): Promise<never> =>
  new Promise((_, reject) => {
    if (signal.aborted) reject(abortReason(signal));
    else signal.addEventListener("abort", () => reject(abortReason(signal)), { once: true });
  });

/**
 * For streams and big downloads: fails only when the server goes silent for
 * `idleMs` (waiting for headers, or for the next chunk the reader asked for),
 * never for total time. The caller's signal keeps reaching the body.
 * Needs ReadableStream bodies (not mobile).
 */
export const fetchWithInactivity = async (
  fetchImpl: (input: string, init: RequestInit) => Promise<Response>,
  url: string,
  init: RequestInit,
  options: { label: string; idleMs: number; signal?: AbortSignal | null | undefined },
): Promise<Response> => {
  const caller = options.signal ?? null;
  if (caller?.aborted) throw abortReason(caller);
  const controller = new AbortController();
  const aborted = rejectOnAbort(controller.signal);
  aborted.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const disarm = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const release = () => {
    disarm();
    caller?.removeEventListener("abort", onCallerAbort);
  };
  const onCallerAbort = () => {
    release();
    controller.abort(abortReason(caller!));
  };
  const arm = () => {
    disarm();
    timer = setTimeout(() => {
      release();
      controller.abort(new RequestTimeoutError(options.label, options.idleMs, "inactivity"));
    }, options.idleMs);
  };
  const failure = (error: unknown): unknown =>
    controller.signal.aborted ? controller.signal.reason ?? error : error;
  caller?.addEventListener("abort", onCallerAbort, { once: true });
  arm();
  let response: Response;
  try {
    response = await Promise.race([fetchImpl(url, { ...init, signal: controller.signal }), aborted]);
  } catch (error) {
    release();
    throw failure(error);
  }
  disarm();
  const source = response.body;
  if (!source) {
    release();
    return response;
  }
  const reader = source.getReader();
  const body = new ReadableStream<Uint8Array>({
    pull: async (stream) => {
      arm();
      try {
        const chunk = await Promise.race([reader.read(), aborted]);
        disarm();
        if (chunk.done) {
          release();
          stream.close();
        } else {
          stream.enqueue(chunk.value);
        }
      } catch (error) {
        release();
        void reader.cancel(failure(error)).catch(() => undefined);
        stream.error(failure(error));
      }
    },
    cancel: async (reason) => {
      release();
      await reader.cancel(reason);
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
};

/** Aborts once `touch()` has not been called for `idleMs`. */
export const inactivitySignal = (options: {
  label: string;
  idleMs: number;
  signal?: AbortSignal | null | undefined;
}): { signal: AbortSignal; touch(): void; dispose(): void } => {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | null = null;
  const onCallerAbort = () => {
    stop();
    controller.abort(abortReason(options.signal!));
  };
  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    options.signal?.removeEventListener("abort", onCallerAbort);
  };
  const touch = () => {
    if (controller.signal.aborted) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      stop();
      controller.abort(new RequestTimeoutError(options.label, options.idleMs, "inactivity"));
    }, options.idleMs);
  };
  if (options.signal?.aborted) controller.abort(abortReason(options.signal));
  else {
    options.signal?.addEventListener("abort", onCallerAbort, { once: true });
    touch();
  }
  return { signal: controller.signal, touch, dispose: stop };
};

const sleep = (ms: number, signal?: AbortSignal | null): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal!));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });

export const isTransientRequestError = (error: unknown): boolean => {
  if (isRequestTimeout(error)) return true;
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError") return false;
  const retryable = (error as { retryable?: unknown }).retryable;
  if (typeof retryable === "boolean") return retryable;
  return error instanceof TypeError || /network|fetch failed|ECONNRESET|socket hang up/i.test(error.message);
};

/** Only for requests that are safe to repeat: reads, or writes keyed by an idempotency id. */
export const retryIdempotent = async <T>(
  attempt: (index: number) => Promise<T>,
  options: {
    attempts?: number;
    baseDelayMs?: number;
    signal?: AbortSignal | null | undefined;
    shouldRetry?: (error: unknown) => boolean;
    retryAfterMs?: (error: unknown) => number | undefined;
  } = {},
): Promise<T> => {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseDelayMs = options.baseDelayMs ?? 500;
  const shouldRetry = options.shouldRetry ?? isTransientRequestError;
  for (let index = 0; ; index += 1) {
    try {
      return await attempt(index);
    } catch (error) {
      if (index + 1 >= attempts || options.signal?.aborted || !shouldRetry(error)) throw error;
      const backoff = baseDelayMs * 2 ** index;
      const hinted = options.retryAfterMs?.(error);
      const delay = Math.min(10_000, hinted ?? backoff / 2 + Math.random() * (backoff / 2));
      await sleep(delay, options.signal);
    }
  }
};

type UploadBody = ArrayBuffer | Uint8Array | Blob;

const uploadSize = (body: UploadBody): number =>
  body instanceof Blob ? body.size : body.byteLength;

/** PUT to a presigned URL: deadline scaled by size, retried (same bytes, same object) on transient failures. */
export const putSignedUpload = async (args: {
  url: string;
  body: UploadBody;
  contentType: string;
  label?: string;
  signal?: AbortSignal | null | undefined;
  fetchImpl?: (input: string, init: RequestInit) => Promise<Response>;
}): Promise<Response> => {
  const fetchImpl = args.fetchImpl ?? ((input: string, init: RequestInit) => fetch(input, init));
  const label = args.label ?? "Uploading to Stella's Drive";
  const timeoutMs = transferBudgetMs(uploadSize(args.body));
  return await retryIdempotent(
    async () => {
      const response = await fetchWithDeadline(
        fetchImpl,
        args.url,
        { method: "PUT", headers: { "Content-Type": args.contentType }, body: args.body as NonNullable<RequestInit["body"]> },
        { label, timeoutMs, signal: args.signal },
      );
      if (response.status >= 500) {
        throw Object.assign(new Error(`${label} failed (${response.status}).`), { retryable: true, response });
      }
      return response;
    },
    { attempts: 3, signal: args.signal },
  ).catch((error: unknown) => {
    const response = (error as { response?: unknown })?.response;
    if (response instanceof Response) return response;
    throw error;
  });
};
