import {
  GATEWAY_DECISIONS_MAX_BODY_BYTES,
  GATEWAY_DECISIONS_MODEL,
} from "@stella/contracts/gateway/api";
import { authenticateCapability } from "./capability.js";
import { GatewayError, jsonResponse } from "./errors.js";

const DECISIONS_URL = "https://generativelanguage.googleapis.com/v1beta/decisions";
const UPSTREAM_TIMEOUT_MS = 20_000;

/**
 * Gemini Decision 1 (Google's closed-set decision model) for Stella's own
 * background work, such as sorting a user's new email. Billed by input
 * tokens only; the caller keeps its own per-owner cost guard.
 */
export const handleDecisions = async (
  request: Request,
  env: Env,
  traceId: string,
): Promise<Response> => {
  const { claims } = await authenticateCapability(request, env);
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > GATEWAY_DECISIONS_MAX_BODY_BYTES) {
    throw new GatewayError(413, "bad_request", "The decision request is too large.");
  }
  const raw = await request.text();
  if (raw.length > GATEWAY_DECISIONS_MAX_BODY_BYTES) {
    throw new GatewayError(413, "bad_request", "The decision request is too large.");
  }
  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    throw new GatewayError(400, "bad_request", "The decision request must be a JSON object.");
  }
  const apiKey = (env as unknown as Record<string, string | undefined>).GOOGLE_AI_API_KEY?.trim();
  if (!apiKey) {
    throw new GatewayError(503, "internal", "The decision model is not configured.", { retryable: false });
  }
  const startedAt = Date.now();
  const upstream = await fetch(DECISIONS_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({ ...body, model: GATEWAY_DECISIONS_MODEL }),
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  }).catch((error: unknown) => {
    throw new GatewayError(502, "upstream_error", `The decision model did not answer: ${error instanceof Error ? error.message : String(error)}`.slice(0, 300), { retryable: true });
  });
  const text = await upstream.text();
  let payload: unknown = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }
  const usage =
    payload && typeof payload === "object" && "usage" in payload
      ? ((payload as { usage?: { total_input_tokens?: unknown } }).usage ?? {})
      : {};
  const inputTokens = typeof usage.total_input_tokens === "number" ? usage.total_input_tokens : 0;
  console.log(
    JSON.stringify({
      event: "gateway_decision",
      traceId,
      owner: claims.sub.slice(0, 12),
      status: upstream.status,
      inputTokens,
      ms: Date.now() - startedAt,
    }),
  );
  if (!upstream.ok) {
    const error =
      payload && typeof payload === "object" && "error" in payload
        ? (payload as { error?: { code?: unknown; message?: unknown } }).error
        : undefined;
    return jsonResponse(
      upstream.status >= 500 ? 502 : upstream.status,
      {
        error: {
          code: typeof error?.code === "string" ? error.code : "upstream_error",
          message: (typeof error?.message === "string" ? error.message : `Google answered ${upstream.status}.`).slice(0, 300),
        },
      },
      traceId,
    );
  }
  return jsonResponse(200, payload, traceId);
};
