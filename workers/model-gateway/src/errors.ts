import {
  GATEWAY_TRACE_HEADER,
  type GatewayErrorBody,
  type GatewayErrorCode,
  type GatewayQuotaScope,
} from "@stella/contracts/gateway/api";

const RESPONSE_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
} as const;

export class GatewayError extends Error {
  readonly status: number;
  readonly code: GatewayErrorCode;
  readonly retryable: boolean;
  readonly upstreamStatus: number | undefined;
  readonly quota: GatewayErrorBody["error"]["quota"];
  readonly extraHeaders: Record<string, string>;

  constructor(
    status: number,
    code: GatewayErrorCode,
    message: string,
    options: {
      retryable?: boolean;
      upstreamStatus?: number;
      quota?: GatewayErrorBody["error"]["quota"];
      headers?: Record<string, string>;
    } = {},
  ) {
    super(message);
    this.name = "GatewayError";
    this.status = status;
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.upstreamStatus = options.upstreamStatus;
    this.quota = options.quota;
    this.extraHeaders = options.headers ?? {};
  }

  body(): GatewayErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        retryable: this.retryable,
        ...(this.upstreamStatus !== undefined
          ? { upstreamStatus: this.upstreamStatus }
          : {}),
        ...(this.quota ? { quota: this.quota } : {}),
      },
    };
  }
}

export const quotaErrorOptions = (args: {
  scope: GatewayQuotaScope;
  now: number;
  resetAt?: number;
  retryable?: boolean;
}): {
  retryable: boolean;
  quota: NonNullable<GatewayErrorBody["error"]["quota"]>;
  headers: Record<string, string>;
} => {
  if (args.resetAt === undefined) {
    return {
      retryable: args.retryable ?? false,
      quota: { scope: args.scope },
      headers: {},
    };
  }
  const retryAfterMs = Math.max(0, args.resetAt - args.now);
  return {
    retryable: args.retryable ?? true,
    quota: { scope: args.scope, resetAt: args.resetAt, retryAfterMs },
    headers: { "retry-after": String(Math.ceil(retryAfterMs / 1_000)) },
  };
};

export const isGatewayError = (value: unknown): value is GatewayError =>
  value instanceof GatewayError;

export const jsonResponse = (
  status: number,
  body: unknown,
  traceId: string,
  headers: Record<string, string> = {},
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...RESPONSE_HEADERS,
      [GATEWAY_TRACE_HEADER]: traceId,
      ...headers,
    },
  });

export const errorResponse = (error: GatewayError, traceId: string): Response =>
  jsonResponse(error.status, error.body(), traceId, error.extraHeaders);

export const toGatewayError = (error: unknown): GatewayError => {
  if (isGatewayError(error)) return error;
  return new GatewayError(
    500,
    "internal",
    "The model gateway hit an internal error.",
    {
      retryable: true,
    },
  );
};

const SECRET_KEY_PATTERN =
  /^(headers?|authorization|x-api-key|x-goog-api-key|api[_-]?key|access[_-]?token|refresh[_-]?token|token|secret|cookie|set-cookie)$/iu;
const SECRET_VALUE_PATTERN =
  /\b(?:sk|rk|key|xai|fw|csk|AIza)[-_][A-Za-z0-9_-]{12,}|\bBearer\s+[A-Za-z0-9._-]{12,}/gu;

const MAX_UPSTREAM_ERROR_BYTES = 64 * 1024;

export const scrubUpstreamJson = (
  value: unknown,
  secrets: readonly string[],
  depth = 0,
): unknown => {
  if (depth > 12) return undefined;
  if (typeof value === "string") {
    let text = value;
    for (const secret of secrets) {
      if (secret && text.includes(secret)) {
        text = text.split(secret).join("[redacted]");
      }
    }
    return text.replace(SECRET_VALUE_PATTERN, "[redacted]");
  }
  if (Array.isArray(value)) {
    return value.map((entry) => scrubUpstreamJson(entry, secrets, depth + 1));
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (SECRET_KEY_PATTERN.test(key)) continue;
      output[key] = scrubUpstreamJson(entry, secrets, depth + 1);
    }
    return output;
  }
  return value;
};

export const upstreamErrorBody = (
  status: number,
  text: string,
  secrets: readonly string[],
): unknown => {
  const bounded =
    text.length > MAX_UPSTREAM_ERROR_BYTES
      ? text.slice(0, MAX_UPSTREAM_ERROR_BYTES)
      : text;
  try {
    const parsed = JSON.parse(bounded) as unknown;
    if (parsed && typeof parsed === "object") {
      return scrubUpstreamJson(parsed, secrets);
    }
  } catch {
    // Not JSON; fall through.
  }
  const body: GatewayErrorBody = {
    error: {
      code: "upstream_error",
      message:
        (scrubUpstreamJson(bounded.trim(), secrets) as string).slice(
          0,
          2_000,
        ) || `The model provider rejected the request with status ${status}.`,
      retryable: status === 429 || status >= 500,
      upstreamStatus: status,
    },
  };
  return body;
};
