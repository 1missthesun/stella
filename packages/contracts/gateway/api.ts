import { PLAN_CATALOG, normalizeBillingPlan, type BillingPlan } from "../billing-plans.js";
import type { GatewayDeviceKeyProof } from "./dpop.js";

export const GATEWAY_VALIDATED_RELAY_PREFIX = "/v2/relay" as const;
export const GATEWAY_RELAY_PREFIX = "/v1/relay" as const;
export const GATEWAY_PREPARE_PATH = "/v1/models/prepare" as const;
export const GATEWAY_RESOLVE_PATH = "/v1/models/resolve" as const;
export const GATEWAY_SESSION_CAPABILITY_PATH = "/v1/capabilities/session" as const;
export const GATEWAY_HEALTH_PATH = "/healthz" as const;

export const GATEWAY_BYOK_RELAY_PREFIX = "/v1/byok" as const;
export const GATEWAY_BYOK_UPSTREAM_HEADER = "x-stella-byok-upstream" as const;
export const GATEWAY_BYOK_HEADER_PREFIX = "x-stella-byok-header-" as const;
export const GATEWAY_BYOK_PLACEHOLDER_KEY = "stella-account-key" as const;

export const gatewayByokRelayPath = (provider: string): string =>
  `${GATEWAY_BYOK_RELAY_PREFIX}/${encodeURIComponent(provider)}`;

/**
 * On a BYOK response the provider itself refused (4xx), the provider's own
 * reason, cleaned of keys and cut short, URI-encoded. Absent when the gateway
 * refused the request, so a caller can tell the two apart.
 */
export const GATEWAY_BYOK_REJECTION_HEADER = "x-stella-byok-rejection" as const;

/** What a user reads when their provider refused a model request. */
export const byokRejectionNotice = (providerName: string, header: string | null): string | undefined => {
  if (header === null) return undefined;
  let reason = "";
  try {
    reason = decodeURIComponent(header).trim();
  } catch {
    reason = "";
  }
  return reason
    ? `${providerName} rejected the request: ${reason}`
    : `${providerName} rejected the request.`;
};

export const GATEWAY_REQUEST_ID_HEADER = "x-stella-request-id" as const;
export const GATEWAY_MODEL_REVISION_HEADER = "x-stella-model-revision" as const;
export const GATEWAY_MODEL_RESOLUTION_HEADER = "x-stella-model-resolution" as const;
export const GATEWAY_AGENT_TYPE_HEADER = "x-stella-agent-type" as const;
export const GATEWAY_TRACE_HEADER = "x-stella-gateway-trace" as const;
export const GATEWAY_SUBSCRIPTION_LIMIT_HEADER =
  "x-stella-subscription-limit" as const;

export const nativeSubscriptionLimitNotice = (
  provider: string | null,
): string | undefined => {
  return provider === "chatgpt"
    ? "Your ChatGPT plan has reached its usage limit. It will work again once the limit resets."
    : undefined;
};
export const GATEWAY_AUTHORIZATION_HEADER = "authorization" as const;

export type GatewayProtocol =
  | "anthropic-messages"
  | "openai-responses"
  | "openai-completions"
  | "google-generative-ai";

export type GatewayProvider =
  | "anthropic"
  | "openai"
  | "google"
  | "fireworks"
  | "deepseek"
  | "xai"
  | "openrouter"
  | "meta";

export type GatewayResolveRequest = {
  model?: string;
  agentType: string;
};

export type GatewayModelResolution = {
  requestedModel: string;
  resolvedModel: string;
  provider: GatewayProvider;
  protocol: GatewayProtocol;
  reasoning: boolean;
  supportsImages: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
};

export const gatewayModelResolutionRevision = async (
  resolution: GatewayModelResolution,
): Promise<string> => {
  const bytes = new TextEncoder().encode(JSON.stringify([
    1, resolution.requestedModel, resolution.resolvedModel, resolution.provider,
    resolution.protocol, resolution.reasoning, resolution.supportsImages,
    resolution.contextWindow ?? null, resolution.maxOutputTokens ?? null,
  ]));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `v1:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
};

export type GatewaySessionCapabilityRequest = {
  turnstileToken?: string;
  deviceKey: GatewayDeviceKeyProof;
};

export const PREVIEW_SESSION_CAPABILITY_PATH =
  "/api/gateway/preview-session-capability" as const;

export type PreviewSessionCapabilityRequest = GatewaySessionCapabilityRequest & {
  ipHash: string;
  networkClass: NetworkClass;
};

export type GatewaySessionCapabilityResponse = {
  capability: string;
  expiresAt: number;
  audience: string;
  budgetMicroCents: number;
  maxRequests?: number;
  identityLevel?: IdentityLevel;
};

export type IdentityLevel = 0 | 1 | 2 | 3;

export type NetworkClass =
  | "hosting"
  | "vpn"
  | "residential"
  | "mobile"
  | "edu"
  | "unknown";

export const GATEWAY_SIGN_IN_REQUIRED_MESSAGE =
  "Stella models need a Stella account. Sign in, or connect Claude Code, ChatGPT or an API key.";

export const GATEWAY_NETWORK_POLICY = {
  freeChallenged: ["hosting"] as readonly NetworkClass[],
} as const;

export type GatewayErrorCode =
  | "unauthorized"
  | "capability_expired"
  | "capability_invalid"
  | "generation_stale"
  | "agent_type_forbidden"
  | "model_forbidden"
  | "execution_mismatch"
  | "model_revision_mismatch"
  | "stream_unsupported"
  | "budget_exhausted"
  | "usage_limit"
  | "request_limit"
  | "rate_limited"
  | "concurrency_limit"
  | "sign_in_required"
  | "tier_paused"
  | "owner_suspended"
  | "challenge_required"
  | "dpop_invalid"
  | "engine_sign_in_required"
  | "body_too_large"
  | "bad_request"
  | "upstream_error"
  | "upstream_timeout"
  | "canceled"
  | "internal";

export type GatewayQuotaScope =
  | "capability"
  | "owner"
  | "network"
  | "tier";

export type GatewayErrorBody = {
  error: {
    code: GatewayErrorCode;
    message: string;
    retryable: boolean;
    upstreamStatus?: number;
    quota?: {
      scope: GatewayQuotaScope;
      resetAt?: number;
      retryAfterMs?: number;
    };
  };
};

export type GatewayOwnerRelayLimit = {
  inFlight: number;
  perMinute: number;
  mintsPerHour: number;
};

const relayLimit = (plan: BillingPlan, mintsPerHour: number): GatewayOwnerRelayLimit => ({
  inFlight: PLAN_CATALOG[plan].limits.modelRequestsAtOnce,
  perMinute: PLAN_CATALOG[plan].limits.modelRequestsPerMinute,
  mintsPerHour,
});

const budgetChunk = (plan: BillingPlan): number =>
  Math.round(PLAN_CATALOG[plan].limits.modelBudgetChunkUsd * 100_000_000);

export const GATEWAY_OWNER_RELAY_LIMITS: Readonly<
  Record<ManagedModelAudienceForLimits, GatewayOwnerRelayLimit>
> = {
  free: relayLimit("free", 12),
  plus: relayLimit("plus", 24),
  pro: relayLimit("pro", 24),
  max: relayLimit("max", 24),
};

export const GATEWAY_TEST_ACCOUNT_MINTS_PER_HOUR = 240;

export const GATEWAY_REFUSED_MINTS_PER_HOUR = { owner: 120 } as const;

export const GATEWAY_THROTTLED_LIMIT_SHARE = 0.5;

export const GATEWAY_MAX_OUTPUT_TOKENS_BY_AUDIENCE: Readonly<
  Partial<Record<ManagedModelAudienceForLimits, number>>
> = {};

export const GATEWAY_NETWORK_LIMITS = {
  free: {
    relayPerDay: 3_000,
  },
} as const;

export const GATEWAY_SESSION_BUDGET_CHUNK_MICRO_CENTS: Readonly<
  Record<ManagedModelAudienceForLimits, number>
> = {
  free: budgetChunk("free"),
  plus: budgetChunk("plus"),
  pro: budgetChunk("pro"),
  max: budgetChunk("max"),
};

export type ManagedModelAudienceForLimits = BillingPlan;

export const limitsAudienceFor = (audience: string): ManagedModelAudienceForLimits =>
  normalizeBillingPlan(audience);

export const GATEWAY_MAX_REQUEST_BODY_BYTES = 24 * 1024 * 1024;
export const GATEWAY_MAX_RESULT_CACHE_BYTES = 8 * 1024 * 1024;
export const GATEWAY_RESULT_CACHE_TTL_MS = 10 * 60 * 1000;
export const GATEWAY_UPSTREAM_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const GATEWAY_UPSTREAM_MAX_DURATION_MS = 45 * 60 * 1000;

export const gatewayRelayBaseUrl = (gatewayOrigin: string): string =>
  `${gatewayOrigin.replace(/\/+$/, "")}${GATEWAY_RELAY_PREFIX}`;

