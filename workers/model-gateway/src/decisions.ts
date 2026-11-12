import {
  GATEWAY_DECISIONS_MAX_BODY_BYTES,
  GATEWAY_DECISIONS_MODEL,
} from "@stella/contracts/gateway/api";
import { accessFor } from "./byok-lane.js";
import { authenticateCapability } from "./capability.js";
import { GatewayError, jsonResponse } from "./errors.js";

const DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";
const UPSTREAM_TIMEOUT_MS = 20_000;

type Block = { type?: unknown; text?: unknown; data?: unknown; mime_type?: unknown; resolution?: unknown };

/**
 * Stella's decision request (an `input` list of text, image and document
 * blocks; `noul` criteria as `true_description`/`false_description`) in
 * OpenRouter's Decisions shape: the blocks become top-level `state` items
 * (`image_url` and `file` parts as data URLs) and `noul` criteria `true`/`false`.
 */
export const openRouterDecisionBody = (body: Record<string, unknown>): Record<string, unknown> => {
  const blocks = Array.isArray(body.input) ? (body.input as Block[]) : [];
  const state: unknown[] = [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const mime = typeof block.mime_type === "string" ? block.mime_type : "";
    const data = typeof block.data === "string" ? block.data : "";
    if (block.type === "text" && typeof block.text === "string") state.push(block.text);
    else if (block.type === "image" && mime && data) {
      state.push({
        type: "image_url",
        image_url: {
          url: `data:${mime};base64,${data}`,
          ...(block.resolution === "low" || block.resolution === "high" ? { detail: block.resolution } : {}),
        },
      });
    } else if (block.type === "document" && mime && data) {
      state.push({ type: "file", file: { file_data: `data:${mime};base64,${data}` } });
    }
  }
  const questions: Record<string, unknown> = {};
  const asked = body.questions && typeof body.questions === "object" ? (body.questions as Record<string, unknown>) : {};
  for (const [name, question] of Object.entries(asked)) {
    const q = question && typeof question === "object" ? (question as Record<string, unknown>) : {};
    const criteria = q.criteria && typeof q.criteria === "object" ? (q.criteria as Record<string, unknown>) : undefined;
    questions[name] =
      q.type === "noul" && criteria && ("true_description" in criteria || "false_description" in criteria)
        ? { ...q, criteria: { true: criteria.true_description ?? null, false: criteria.false_description ?? null } }
        : q;
  }
  return {
    model: GATEWAY_DECISIONS_MODEL,
    // Mail is private: only endpoints that don't store or train on it.
    provider: { data_collection: "deny" },
    state: state.length === 1 && typeof state[0] === "string" ? state[0] : state,
    questions,
  };
};

/**
 * Gemini Decision 1 (Google's closed-set decision model) for Stella's own
 * background work, such as sorting a user's new email, through OpenRouter on
 * the managed key. Billed by input tokens only; the caller keeps its own
 * per-owner cost guard. The answer keeps Stella's shape: `answers` as
 * OpenRouter returns them, and `usage.total_input_tokens`.
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
  // An email capability admitted on the owner's own OpenRouter key spends theirs; otherwise Stella's
  // (on a self-hosted server, that server's own key).
  const execution = claims.turn?.execution;
  const ownKey = execution?.engine === "provider" && execution.provider === "openrouter";
  if (ownKey && execution.model !== GATEWAY_DECISIONS_MODEL) {
    throw new GatewayError(403, "execution_mismatch", `This capability was admitted for "${execution.model}".`);
  }
  if (execution?.engine === "provider" && !ownKey) {
    throw new GatewayError(403, "execution_mismatch", "Decisions run on Stella's key or an OpenRouter key.");
  }
  const apiKey = ownKey
    ? (await accessFor(env, claims, "openrouter", Date.now())).apiKey?.trim()
    : (env as unknown as Record<string, string | undefined>).OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    throw new GatewayError(503, "internal", "The decision model is not configured.", { retryable: false });
  }
  const startedAt = Date.now();
  const upstream = await fetch(DECISIONS_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(openRouterDecisionBody(body)),
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
      ? ((payload as { usage?: { input_tokens?: unknown; cost?: unknown } }).usage ?? {})
      : {};
  const inputTokens = typeof usage.input_tokens === "number" ? usage.input_tokens : 0;
  const costUsd = typeof usage.cost === "number" ? usage.cost : null;
  console.log(
    JSON.stringify({
      event: "gateway_decision",
      traceId,
      owner: claims.sub.slice(0, 12),
      status: upstream.status,
      payer: ownKey ? "own_key" : "stella",
      inputTokens,
      costUsd,
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
          message: (typeof error?.message === "string" ? error.message : `OpenRouter answered ${upstream.status}.`).slice(0, 300),
        },
      },
      traceId,
    );
  }
  const answered = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  return jsonResponse(
    200,
    { ...answered, usage: { ...usage, total_input_tokens: inputTokens, ...(costUsd !== null ? { cost_usd: costUsd } : {}) } },
    traceId,
  );
};
