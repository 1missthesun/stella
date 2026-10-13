/**
 * Model-gateway HTTP surface.
 *
 * The gateway speaks provider-native request and response bodies. Callers use
 * their vendor SDK with `baseUrl = <gatewayOrigin>/v1/relay`; the SDK appends
 * its usual path and the gateway routes on that suffix:
 *
 *   POST /v1/relay/v1/messages                       anthropic-messages
 *   POST /v1/relay/responses                         openai-responses
 *   POST /v1/relay/chat/completions                  openai-completions
 *   POST /v1/relay/models/{model}:generateContent    google-generative-ai
 *   POST /v1/relay/models/{model}:streamGenerateContent (accepted; treated as generateContent)
 *
 * Managed lane (Stella-billed): request/response only. The gateway streams
 * from the provider internally and returns ONE complete provider-native JSON
 * object. `stream: true` in the body is rejected with 400 `stream_unsupported`.
 *
 * Native lane (owner subscription; capability carries `credential`): a byte
 * pipe. Whatever the CLI sends goes upstream untouched apart from
 * credentials; whatever comes back (SSE or JSON) is returned untouched.
 */

import type { GatewayDeviceKeyProof } from "./dpop.js";

/** Requires descriptor validation; older deployments reject this route before inference. */
export const GATEWAY_VALIDATED_RELAY_PREFIX = "/v2/relay" as const;
export const GATEWAY_RELAY_PREFIX = "/v1/relay" as const;
/** Authenticated descriptor resolution that acknowledges owner preparation completion. */
export const GATEWAY_PREPARE_PATH = "/v1/models/prepare" as const;
export const GATEWAY_RESOLVE_PATH = "/v1/models/resolve" as const;
export const GATEWAY_SESSION_CAPABILITY_PATH = "/v1/capabilities/session" as const;
export const GATEWAY_HEALTH_PATH = "/healthz" as const;

/**
 * BYOK lane: a model request on a provider credential saved to the owner's
 * account (`@stella/contracts/backend/providers`), never billed to Stella.
 *
 *   POST /v1/byok/<provider>
 *   x-stella-byok-upstream: <the provider URL the request is for>
 *   x-stella-byok-header-<name>: <a header carrying GATEWAY_BYOK_PLACEHOLDER_KEY>
 *
 * The caller builds the request as its provider SDK would with
 * `GATEWAY_BYOK_PLACEHOLDER_KEY` as the key, moves every header that carries
 * the placeholder under `x-stella-byok-header-`, and authorizes with its
 * capability. The gateway checks the upstream URL against the provider's
 * endpoints, puts the owner's key where the placeholder was, and pipes the
 * provider's response back untouched. A turn capability is pinned to the
 * provider and model its turn was admitted with; a session capability (a
 * computer with no key of its own) may use any model of the provider.
 * Only inference endpoints are served.
 */
export const GATEWAY_BYOK_RELAY_PREFIX = "/v1/byok" as const;
export const GATEWAY_BYOK_UPSTREAM_HEADER = "x-stella-byok-upstream" as const;
export const GATEWAY_BYOK_HEADER_PREFIX = "x-stella-byok-header-" as const;
export const GATEWAY_BYOK_PLACEHOLDER_KEY = "stella-account-key" as const;

export const gatewayByokRelayPath = (provider: string): string =>
  `${GATEWAY_BYOK_RELAY_PREFIX}/${encodeURIComponent(provider)}`;

/** Caller-minted idempotency key. Same id + same body => cached result. */
export const GATEWAY_REQUEST_ID_HEADER = "x-stella-request-id" as const;
/** Full descriptor digest checked before reservation or provider dispatch. */
export const GATEWAY_MODEL_REVISION_HEADER = "x-stella-model-revision" as const;
/** Current descriptor supplied only with a pre-provider model_revision_mismatch. */
export const GATEWAY_MODEL_RESOLUTION_HEADER = "x-stella-model-resolution" as const;
export const GATEWAY_AGENT_TYPE_HEADER = "x-stella-agent-type" as const;
/** Echoed on every response so logs on both sides can be joined. */
export const GATEWAY_TRACE_HEADER = "x-stella-gateway-trace" as const;
/** A confirmed subscription window limit, distinct from a transient HTTP 429. */
export const GATEWAY_SUBSCRIPTION_LIMIT_HEADER =
  "x-stella-subscription-limit" as const;

export const nativeSubscriptionLimitNotice = (
  provider: string | null,
): string | undefined => {
  return provider === "chatgpt"
    ? "Your ChatGPT plan has reached its usage limit. It will work again once the limit resets."
    : undefined;
};
/** Capability travels as `Authorization: Bearer <jwt>`. */
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

/** `POST /v1/models/resolve` request. */
export type GatewayResolveRequest = {
  /** `stella/...` alias, `stella/default`, or empty for the audience default. */
  model?: string;
  agentType: string;
};

/** `POST /v1/models/resolve` response. */
export type GatewayModelResolution = {
  /** The alias the caller should keep sending in request bodies. */
  requestedModel: string;
  /** Upstream model id as the provider knows it (before native mapping). */
  resolvedModel: string;
  provider: GatewayProvider;
  protocol: GatewayProtocol;
  reasoning: boolean;
  supportsImages: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
};

/** Versioned canonical metadata digest; routing authorization remains gateway-owned. */
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

/**
 * `POST /v1/capabilities/session` request (Better Auth JWT in Authorization).
 * Deliberately empty: the anonymous trial is keyed on the anonymous owner the
 * JWT names plus the caller's network as the gateway sees it. A client-chosen
 * device string is never an allowance key.
 */
export type GatewaySessionCapabilityRequest = {
  /**
   * Turnstile token for step-up: required when the owner's enforcement status
   * is `challenged` or the caller's network class demands it (the exchange
   * answered `challenge_required`). Ignored otherwise.
   */
  turnstileToken?: string;
  /**
   * Device key proof (gateway/dpop.ts). Required: the minted capability is
   * bound to this key and every relay request must prove possession of it.
   */
  deviceKey: GatewayDeviceKeyProof;
};

/**
 * Session capabilities for a desktop signed in to a cloud-builder Preview
 * (DEPLOY.md, "Previews"). The dev gateway verifies the Preview's sign-in
 * and runs its own gates, then asks the Preview's cloud-builder, which holds
 * the owner's billing, to issue on this route: the caller's bearer and
 * device key proof, plus the network facts the gateway saw. The Preview
 * re-verifies both, signs with its `builder-preview-1` key and answers a
 * `BillingControlResult` (gateway/usage.ts). Only a Worker signing with
 * that key serves the route.
 */
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
  /** Identity ladder rung the allowance was computed for. */
  identityLevel?: IdentityLevel;
};

/**
 * Identity ladder. Allowances grow with proof that is expensive to fake:
 *   0 anonymous; 1 verified email (magic link); 2 Google or Apple account;
 *   3 paying (Stripe subscription or purchased credits).
 */
export type IdentityLevel = 0 | 1 | 2 | 3;

/**
 * Network class from the edge (`request.cf.asn` / `asOrganization`).
 * `hosting` and `vpn` are datacenter or relay origins; `unknown` is the
 * default when the edge gives no ASN.
 */
export type NetworkClass =
  | "hosting"
  | "vpn"
  | "residential"
  | "mobile"
  | "edu"
  | "unknown";

/**
 * Step-up policy by network class. Anonymous callers from hosting or VPN
 * origins are refused (`sign_in_required`); Free callers from hosting origins
 * must pass a challenge at mint and run at half the network caps.
 */
export const GATEWAY_SIGN_IN_REQUIRED_MESSAGE =
  "Stella models need a Stella account. Sign in, or connect Claude Code, ChatGPT or an API key.";

export const GATEWAY_NETWORK_POLICY = {
  anonymousRefused: ["hosting", "vpn"] as readonly NetworkClass[],
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
  /** This capability's budget is spent. Clients exchange a fresh one once. */
  | "budget_exhausted"
  /**
   * The owner has no room left for Stella's models (free allowance spent,
   * plan limit reached). Trying again won't help; the message says what will.
   */
  | "usage_limit"
  /** This capability's request count is spent. Clients exchange a fresh one once. */
  | "request_limit"
  | "rate_limited"
  /** Owner-level in-flight ceiling for the audience (see GATEWAY_OWNER_RELAY_LIMITS). */
  | "concurrency_limit"
  /** The anonymous tier is not allowed here (network policy or tier breaker). */
  | "sign_in_required"
  /** The audience's global spend breaker tripped; retry after `resetAt`. */
  | "tier_paused"
  /** Owner enforcement status refuses service. */
  | "owner_suspended"
  /** The exchange needs a Turnstile token (`turnstileToken` in the body). */
  | "challenge_required"
  /** The request's device proof is missing, stale, or does not match `dpk`. */
  | "dpop_invalid"
  /** The cloud's ChatGPT sign-in ended; the owner must sign in again. */
  | "engine_sign_in_required"
  | "body_too_large"
  | "bad_request"
  | "upstream_error"
  | "upstream_timeout"
  | "canceled"
  | "internal";

/** Which counter refused a request, so clients can explain without knowing policy. */
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
    /** Upstream HTTP status when the failure came from the provider. */
    upstreamStatus?: number;
    /** Present on quota refusals: what refused and when it clears. */
    quota?: {
      scope: GatewayQuotaScope;
      /** Absolute ms timestamp when the counter next admits a request, when known. */
      resetAt?: number;
      retryAfterMs?: number;
    };
  };
};

// ---------------------------------------------------------------------------
// Tier policy the gateway enforces locally. Values are starting points; the
// monetary ceilings live in cloud-builder config and arrive through the config snapshot.
// ---------------------------------------------------------------------------

export type GatewayOwnerRelayLimit = {
  /** Requests in flight at once for one owner. */
  inFlight: number;
  /** Requests admitted per rolling minute for one owner. */
  perMinute: number;
  /** Session capability exchanges per rolling hour for one owner. */
  mintsPerHour: number;
};

/** Keyed by managed model audience. Fallback audiences share their base tier. */
export const GATEWAY_OWNER_RELAY_LIMITS: Readonly<
  Record<ManagedModelAudienceForLimits, GatewayOwnerRelayLimit>
> = {
  anonymous: { inFlight: 1, perMinute: 20, mintsPerHour: 12 },
  free: { inFlight: 2, perMinute: 40, mintsPerHour: 12 },
  go: { inFlight: 4, perMinute: 80, mintsPerHour: 24 },
  pro: { inFlight: 8, perMinute: 120, mintsPerHour: 24 },
};

/**
 * Session capability exchanges per rolling hour for a dev test account
 * (`@test.stella.local`), on a gateway that serves them
 * (`STELLA_TEST_ACCOUNTS=1`, dev only): test runs launch and relaunch
 * several computers on one account, each a fresh exchange. Never production.
 */
export const GATEWAY_TEST_ACCOUNT_MINTS_PER_HOUR = 240;

/**
 * Refused session exchanges (no capability issued: sign-in or challenge
 * required, an outage) per rolling hour, for one owner and, for anonymous
 * owners, one network. Refusals never touch the exchange allowance; this
 * separate cap only stops a stuck client from hammering the backend, well
 * above any retry pattern a working client has.
 */
export const GATEWAY_REFUSED_MINTS_PER_HOUR = { owner: 120, network: 360 } as const;

/** A throttled owner (enforcement status) gets this share of its tier limits. */
export const GATEWAY_THROTTLED_LIMIT_SHARE = 0.5;

/**
 * Output-token ceiling shaped into every managed request by audience
 * (`max_tokens` / `max_output_tokens` / `maxOutputTokens`). Absent means the
 * model's own ceiling.
 */
export const GATEWAY_MAX_OUTPUT_TOKENS_BY_AUDIENCE: Readonly<
  Partial<Record<ManagedModelAudienceForLimits, number>>
> = {
  anonymous: 2_048,
};

/** Per-network (client IP) ceilings enforced before any provider spend. */
export const GATEWAY_NETWORK_LIMITS = {
  anonymous: {
    /** Relay requests per rolling hour from one IP. (The 60/min edge limiter stays.) */
    relayPerHour: 300,
    /** Relay requests per rolling 24 hours from one IP. */
    relayPerDay: 1_000,
    /** Session capability exchanges per rolling 24 hours from one IP. */
    mintsPerDay: 20,
  },
  free: {
    relayPerDay: 3_000,
  },
} as const;

/** Budget chunk one session capability carries, by audience; owners re-mint as they spend. */
export const GATEWAY_SESSION_BUDGET_CHUNK_MICRO_CENTS: Readonly<
  Record<ManagedModelAudienceForLimits, number>
> = {
  anonymous: 10_000_000, // $0.10
  free: 100_000_000, // $1
  go: 200_000_000, // $2
  pro: 500_000_000, // $5
};

/** Request-count chunk one anonymous session capability carries. */
export const GATEWAY_ANONYMOUS_REQUEST_CHUNK = 10;

/** Base tier for limit lookups (fallback audiences inherit their paid tier). */
export type ManagedModelAudienceForLimits = "anonymous" | "free" | "go" | "pro";

export const limitsAudienceFor = (
  audience: string,
): ManagedModelAudienceForLimits => {
  switch (audience) {
    case "anonymous":
      return "anonymous";
    case "go":
    case "go_fallback":
      return "go";
    case "pro":
    case "pro_fallback":
      return "pro";
    default:
      return "free";
  }
};

export const GATEWAY_MAX_REQUEST_BODY_BYTES = 24 * 1024 * 1024;
export const GATEWAY_MAX_RESULT_CACHE_BYTES = 8 * 1024 * 1024;
/** Completed results are replayable for retries with the same request id for this long. */
export const GATEWAY_RESULT_CACHE_TTL_MS = 10 * 60 * 1000;
/** The gateway gives up on an upstream that produced no bytes for this long. */
export const GATEWAY_UPSTREAM_IDLE_TIMEOUT_MS = 5 * 60 * 1000;
/** Absolute ceiling on one managed completion. */
export const GATEWAY_UPSTREAM_MAX_DURATION_MS = 45 * 60 * 1000;

export const gatewayRelayBaseUrl = (gatewayOrigin: string): string =>
  `${gatewayOrigin.replace(/\/+$/, "")}${GATEWAY_RELAY_PREFIX}`;

