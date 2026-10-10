import {
  GATEWAY_BYOK_HEADER_PREFIX,
  GATEWAY_BYOK_PLACEHOLDER_KEY,
  GATEWAY_BYOK_RELAY_PREFIX,
  GATEWAY_BYOK_UPSTREAM_HEADER,
  GATEWAY_TRACE_HEADER,
  GATEWAY_UPSTREAM_MAX_DURATION_MS,
} from "@stella/contracts/gateway/api";
import type { GatewayCapabilityClaims } from "@stella/contracts/gateway/capability";
import type { ProviderAccessResponse } from "@stella/contracts/gateway/usage";
import { billingControl } from "./billing-control.js";
import {
  authenticateCapability,
  verifySessionDpop,
} from "./capability.js";
import { GatewayError } from "./errors.js";
import { createUpstreamController, type GatewayDeps } from "./request-util.js";

/**
 * BYOK lane: a model request on a provider credential the owner saved to
 * their account. The caller's SDK built it with a placeholder key; this lane
 * checks where it goes, puts the owner's key in, and pipes the provider's
 * answer back untouched. Nothing here is billed to Stella and the key never
 * leaves the gateway except to the provider it belongs to.
 *
 * Only inference endpoints, only on the provider's own URLs. A turn
 * capability is held to the provider and model its turn was admitted with.
 */

const ACCESS_MAX_CACHE_MS = 60_000;
const ACCESS_EXPIRY_MARGIN_MS = 60_000;
const MAX_BODY_BYTES = 32 * 1024 * 1024;
const PROVIDER_ID = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const INFERENCE_PATH = /(?:\/chat\/completions|\/responses|\/messages)$/u;

const DROPPED_REQUEST_HEADERS = new Set([
  "authorization",
  "host",
  "cookie",
  "content-length",
  "dpop",
  "x-forwarded-for",
  "x-real-ip",
  "cf-connecting-ip",
  "cf-ipcountry",
  "cf-ray",
  "cf-visitor",
  "cf-worker",
]);

const RESPONSE_HEADER_ALLOWLIST = [
  "content-type",
  "retry-after",
  "request-id",
  "x-request-id",
  "openai-processing-ms",
  "anthropic-ratelimit-requests-remaining",
  "anthropic-ratelimit-tokens-remaining",
] as const;

type AccessEntry = { access: ProviderAccessResponse; validUntil: number };
const accessCache = new Map<string, AccessEntry>();

const accessFor = async (
  env: Pick<Env, "BILLING">,
  claims: GatewayCapabilityClaims,
  provider: string,
  now: number,
): Promise<ProviderAccessResponse> => {
  const key = `${claims.sub}|${claims.gen}|${provider}`;
  const hit = accessCache.get(key);
  if (hit && hit.validUntil > now) return hit.access;
  const result = await billingControl(env)
    .providerAccess({ ownerId: claims.sub, ownerGeneration: claims.gen, provider })
    .catch(() => ({ ok: false as const, status: null, code: null, retryable: true }));
  if (!result.ok) {
    if (result.code === "engine_sign_in_required") {
      throw new GatewayError(
        403,
        "engine_sign_in_required",
        `Your ${provider} sign-in ended. Sign in again in Stella's settings.`,
      );
    }
    if (result.code === "generation_stale") {
      throw new GatewayError(403, "generation_stale", "This capability belongs to a superseded account generation.");
    }
    if (result.status === 404) {
      throw new GatewayError(403, "unauthorized", `No ${provider} key is saved to this account.`);
    }
    throw new GatewayError(503, "internal", "Account provider keys are temporarily unavailable.", {
      retryable: true,
    });
  }
  const access = result.body;
  if (!access || !Array.isArray(access.baseUrls) || (!access.apiKey && !access.headers)) {
    throw new GatewayError(503, "internal", "Account provider keys are temporarily unavailable.", {
      retryable: true,
    });
  }
  const validUntil = Math.min(access.expiresAt - ACCESS_EXPIRY_MARGIN_MS, now + ACCESS_MAX_CACHE_MS);
  if (validUntil > now) accessCache.set(key, { access, validUntil });
  return access;
};

const startsWithBase = (url: string, base: string): boolean => {
  const trimmed = base.replace(/\/+$/u, "");
  return url === trimmed || url.startsWith(`${trimmed}/`) || url.startsWith(`${trimmed}?`);
};

/** The provider URL this request goes to, or a refusal. */
const upstreamTarget = (raw: string | null, access: ProviderAccessResponse): URL => {
  if (!raw) throw new GatewayError(400, "bad_request", `${GATEWAY_BYOK_UPSTREAM_HEADER} is required.`);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new GatewayError(400, "bad_request", "The upstream URL is invalid.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new GatewayError(400, "bad_request", "The upstream URL is invalid.");
  }
  const normalized = url.toString();
  let target = normalized;
  if (access.rebase && startsWithBase(normalized, access.rebase.from)) {
    target = access.rebase.to.replace(/\/+$/u, "") + normalized.slice(access.rebase.from.replace(/\/+$/u, "").length);
  } else if (!access.baseUrls.some((base) => startsWithBase(normalized, base))) {
    throw new GatewayError(403, "model_forbidden", "That URL isn't one of this provider's endpoints.");
  }
  const resolved = new URL(target);
  if (resolved.protocol !== "https:" || !INFERENCE_PATH.test(resolved.pathname)) {
    throw new GatewayError(403, "model_forbidden", "Only model requests are served on the BYOK lane.");
  }
  return resolved;
};

const forwardHeaders = (request: Request, access: ProviderAccessResponse): Headers => {
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    const lower = name.toLowerCase();
    if (DROPPED_REQUEST_HEADERS.has(lower)) continue;
    if (lower.startsWith(GATEWAY_BYOK_HEADER_PREFIX)) {
      const target = lower.slice(GATEWAY_BYOK_HEADER_PREFIX.length);
      if (!target || DROPPED_REQUEST_HEADERS.has(target) && target !== "authorization") continue;
      if (access.apiKey) headers.set(target, value.split(GATEWAY_BYOK_PLACEHOLDER_KEY).join(access.apiKey));
      continue;
    }
    if (lower.startsWith("x-stella-")) continue;
    if (value.includes(GATEWAY_BYOK_PLACEHOLDER_KEY)) continue;
    headers.set(name, value);
  }
  for (const [name, value] of Object.entries(access.headers ?? {})) headers.set(name, value);
  return headers;
};

export const isByokRelayPath = (pathname: string): boolean =>
  pathname.startsWith(`${GATEWAY_BYOK_RELAY_PREFIX}/`);

export const handleByokRelay = async (args: {
  request: Request;
  env: Env;
  deps: GatewayDeps;
  traceId: string;
}): Promise<Response> => {
  const { request, env, deps, traceId } = args;
  const startedAt = deps.now();
  const provider = decodeURIComponent(
    new URL(request.url).pathname.slice(GATEWAY_BYOK_RELAY_PREFIX.length + 1),
  );
  if (!PROVIDER_ID.test(provider)) throw new GatewayError(404, "bad_request", "Unknown provider.");
  const auth = await authenticateCapability(request, env, { now: deps.now() });
  const { claims } = auth;
  if (claims.credential) {
    throw new GatewayError(403, "execution_mismatch", "This capability is for a connected subscription, not an account key.");
  }
  await verifySessionDpop({ request, auth, now: deps.now() });
  const execution = claims.turn?.execution;
  if (claims.kind === "turn") {
    if (execution?.engine !== "provider" || execution.provider !== provider) {
      throw new GatewayError(
        403,
        "execution_mismatch",
        `This turn was admitted for "${execution?.engine ?? "none"}", not the ${provider} key.`,
      );
    }
  }
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) throw new GatewayError(413, "bad_request", "The request is too large.");
  const bodyText = await request.text();
  if (bodyText.length > MAX_BODY_BYTES) throw new GatewayError(413, "bad_request", "The request is too large.");
  let model = "";
  try {
    const parsed = JSON.parse(bodyText) as { model?: unknown };
    model = typeof parsed.model === "string" ? parsed.model.trim() : "";
  } catch {
    throw new GatewayError(400, "bad_request", "The request body must be JSON.");
  }
  if (!model) throw new GatewayError(400, "bad_request", "The request body must name a model.");
  if (claims.kind === "turn" && execution && model !== execution.model) {
    throw new GatewayError(
      403,
      "execution_mismatch",
      `This turn was admitted for model "${execution.model}", not "${model}".`,
    );
  }

  const access = await accessFor(env, claims, provider, deps.now());
  const target = upstreamTarget(request.headers.get(GATEWAY_BYOK_UPSTREAM_HEADER), access);
  const headers = forwardHeaders(request, access);

  const controller = createUpstreamController({
    clientSignal: request.signal,
    idleTimeoutMs: GATEWAY_UPSTREAM_MAX_DURATION_MS,
    maxDurationMs: GATEWAY_UPSTREAM_MAX_DURATION_MS,
  });
  let upstream: Response;
  try {
    upstream = await deps.fetch(target.toString(), {
      method: "POST",
      headers,
      body: bodyText,
      signal: controller.signal,
    });
  } catch (error) {
    controller.dispose();
    if (controller.cause() === "client") {
      throw new GatewayError(499, "canceled", "The caller canceled the request.");
    }
    console.warn(
      `[model-gateway] trace=${traceId} byok=${provider} upstream fetch failed: ${error instanceof Error ? error.message : "unknown"}`,
    );
    throw new GatewayError(
      controller.cause() ? 504 : 502,
      controller.cause() ? "upstream_timeout" : "upstream_error",
      `${provider} could not be reached.`,
      { retryable: true },
    );
  }

  const responseHeaders = new Headers({
    "cache-control": "no-store",
    [GATEWAY_TRACE_HEADER]: traceId,
  });
  for (const name of RESPONSE_HEADER_ALLOWLIST) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  if (upstream.status === 401 || upstream.status === 403) {
    accessCache.delete(`${claims.sub}|${claims.gen}|${provider}`);
  }
  let responseBody: ReadableStream<Uint8Array> | null = upstream.body;
  if (upstream.body) {
    responseBody = upstream.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        flush() {
          controller.dispose();
        },
      }),
    );
  } else {
    controller.dispose();
  }
  console.log(
    `[model-gateway] trace=${traceId} byok=${provider} kind=${claims.kind} model=${model} host=${target.host} status=${upstream.status} ms=${deps.now() - startedAt}`,
  );
  return new Response(responseBody, { status: upstream.status, headers: responseHeaders });
};
