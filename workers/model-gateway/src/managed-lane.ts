import {
  GATEWAY_MODEL_REVISION_HEADER,
  GATEWAY_MODEL_RESOLUTION_HEADER,
  gatewayModelResolutionRevision,
} from "@stella/contracts/gateway/api";
import { managedModelDescriptor } from "@stella/model-catalog/gateway-resolution";
import {
  relayAccounting,
  type HeldReservation,
  type OwnerRelayAccounting,
  type RelaySettlement,
} from "./ledger-client.js";
import type { RelayTiming } from "./relay-timing.js";
import { ownerModeEnabled } from "./owner-mode.js";
import {
  GATEWAY_MAX_OUTPUT_TOKENS_BY_AUDIENCE,
  GATEWAY_NETWORK_POLICY,
  GATEWAY_TRACE_HEADER,
  GATEWAY_UPSTREAM_IDLE_TIMEOUT_MS,
  GATEWAY_UPSTREAM_MAX_DURATION_MS,
  limitsAudienceFor,
  type GatewayProtocol,
  type ManagedModelAudienceForLimits,
} from "@stella/contracts/gateway/api";
import {
  GATEWAY_USAGE_EVENT_VERSION,
  type GatewayUsageEvent,
  type GatewayUsageOutcome,
  type GatewayUsageTokens,
} from "@stella/contracts/gateway/usage";
import {
  GATEWAY_BUDGET_UNLIMITED,
  type ManagedModelAudience,
} from "@stella/contracts/gateway/capability";
import { validateManagedCloudBinding } from "@stella/model-catalog/cloud-binding";
import { getManagedReasoningEffort } from "@stella/model-catalog/model";
import {
  getManagedGatewayConfig,
  resolveManagedGatewayApiKeyFromEnv,
} from "@stella/model-catalog/managed-gateway";
import {
  billableTokens,
  computeUsageCostMicroCents,
  type TokenPriceConfig,
} from "@stella/model-catalog/pricing";
import {
  inlineStoredImages,
  mayCarryStoredImages,
  providerFetchesImageUrls,
} from "./stored-images.js";
import {
  estimateRequestTokens,
  requestedModelFromGooglePath,
  type TokenEstimate,
} from "@stella/model-catalog/request-estimate";
import {
  bodyForUpstream,
  cloneForwardHeaders,
  upstreamUrl,
} from "@stella/model-catalog/request-shaping";
import {
  createRelayUsageParser,
  type RelayUsage,
} from "@stella/model-catalog/usage";
import { createAnthropicAssembler } from "./assemble/anthropic.js";
import { createGoogleAssembler } from "./assemble/google.js";
import { createOpenAICompletionsAssembler } from "./assemble/openai-completions.js";
import { createOpenAIResponsesAssembler } from "./assemble/openai-responses.js";
import { createSseParser, frameJson, type SseFrame } from "./assemble/sse.js";
import type { Assembler } from "./assemble/types.js";
import {
  verifySessionDpop,
  type AuthenticatedCapability,
} from "./capability.js";
import { getGatewayConfig, type GatewayConfigStorage } from "./config-cache.js";
import { billingGatewayConfig } from "./billing-control.js";
import {
  GatewayError,
  jsonResponse,
  quotaErrorOptions,
  upstreamErrorBody,
} from "./errors.js";
import type { LedgerSettleResult } from "./ledger-store.js";
import { classifyNetwork } from "../../shared/network-class.js";
import {
  ownerEnforcementAdmission,
  type OwnerEnforcementAdmission,
} from "./owner-enforcement.js";
import {
  agentTypeFrom,
  createUpstreamController,
  ipHashFrom,
  readJsonObject,
  requestIdFrom,
  type GatewayDeps,
} from "./request-util.js";
import {
  assertAgentTypeAllowed,
  PROTOCOLS_BY_PROVIDER,
  resolveManagedRoute,
  type ManagedRoute,
} from "./resolve.js";
import type { SharedGatewayConfigStore } from "./shared-config.js";
import { logUnreconciled } from "./usage-outbox.js";

export const GATEWAY_REPLAY_HEADER = "x-stella-gateway-replay" as const;

const MAX_UPSTREAM_STREAM_BYTES = 64 * 1024 * 1024;

// Output ceiling assumed for budgeting when neither the model nor the caller
// names one.
const ASSUMED_MAX_OUTPUT_TOKENS = 64_000;
// The smallest answer worth sending when the budget can't cover the full
// output ceiling; below this the request is refused as over budget.
const MIN_AFFORDABLE_OUTPUT_TOKENS = 1_024;

const assemblerFor = (protocol: GatewayProtocol): Assembler => {
  switch (protocol) {
    case "anthropic-messages":
      return createAnthropicAssembler();
    case "openai-responses":
      return createOpenAIResponsesAssembler();
    case "openai-completions":
      return createOpenAICompletionsAssembler();
    case "google-generative-ai":
      return createGoogleAssembler();
  }
};

/**
 * The URL `@stella/model-catalog` shapes against. Google's verb and `alt=sse`
 * are forced here because the model catalog preserves whatever verb the
 * caller used; everything else keeps the caller's path suffix.
 */
const shapingUrlFor = (request: Request, protocol: GatewayProtocol): URL => {
  const url = new URL(request.url);
  if (protocol === "google-generative-ai") {
    url.pathname = url.pathname.replace(
      /:[A-Za-z][A-Za-z0-9]*$/u,
      ":streamGenerateContent",
    );
    url.searchParams.set("alt", "sse");
  }
  return url;
};

const streamingRequestJson = (
  requestJson: Record<string, unknown>,
  protocol: GatewayProtocol,
): Record<string, unknown> => {
  const body = { ...requestJson };
  // Google streams by verb, not by body flag, and rejects unknown fields.
  if (protocol === "google-generative-ai") delete body.stream;
  else body.stream = true;
  // Every managed Responses request stands alone: clients carry reasoning
  // inline and never chain on a stored response, and some upstreams refuse
  // `store: true` outright ("not supported on this proxy").
  if (protocol === "openai-responses" && body.store === true) body.store = false;
  return body;
};

const declaredMaxOutputTokens = (
  body: Record<string, unknown>,
): number | null => {
  const generationConfig =
    body.generationConfig && typeof body.generationConfig === "object"
      ? (body.generationConfig as Record<string, unknown>)
      : {};
  const declared = [
    body.max_tokens,
    body.max_output_tokens,
    body.max_completion_tokens,
    generationConfig.maxOutputTokens,
  ].filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value) && value >= 0,
  );
  return declared.length > 0 ? Math.floor(Math.min(...declared)) : null;
};

export type ShapedUpstreamRequest = {
  url: string;
  headers: Headers;
  body: string;
  /** The output ceiling the upstream is sent, reasoning included. */
  maxOutputTokens: number | null;
};

const outputTokenCap = (args: {
  audience: ManagedModelAudience;
  modelCeiling: number | undefined;
}): number | null => {
  const audienceCeiling =
    GATEWAY_MAX_OUTPUT_TOKENS_BY_AUDIENCE[limitsAudienceFor(args.audience)];
  const ceilings = [audienceCeiling, args.modelCeiling].filter(
    (value): value is number =>
      typeof value === "number" && Number.isFinite(value) && value >= 0,
  );
  return ceilings.length > 0 ? Math.floor(Math.min(...ceilings)) : null;
};

export const clampOutputTokens = (args: {
  requestJson: Record<string, unknown>;
  protocol: GatewayProtocol;
  audience: ManagedModelAudience;
  modelCeiling: number | undefined;
}): Record<string, unknown> => {
  const cap = outputTokenCap(args);
  if (cap === null) return { ...args.requestJson };
  const body = { ...args.requestJson };
  for (const field of [
    "max_tokens",
    "max_output_tokens",
    "max_completion_tokens",
  ] as const) {
    const value = body[field];
    if (typeof value === "number" && Number.isFinite(value)) {
      body[field] = Math.min(cap, Math.max(0, Math.floor(value)));
    }
  }
  if (
    body.generationConfig &&
    typeof body.generationConfig === "object" &&
    !Array.isArray(body.generationConfig)
  ) {
    const generationConfig = {
      ...(body.generationConfig as Record<string, unknown>),
    };
    const requested = generationConfig.maxOutputTokens;
    if (typeof requested === "number" && Number.isFinite(requested)) {
      generationConfig.maxOutputTokens = Math.min(
        cap,
        Math.max(0, Math.floor(requested)),
      );
    }
    body.generationConfig = generationConfig;
  }
  const requestedCeiling = Math.min(
    cap,
    ...[
      body.max_tokens,
      body.max_output_tokens,
      body.max_completion_tokens,
    ].filter(
      (value): value is number =>
        typeof value === "number" && Number.isFinite(value),
    ),
  );
  switch (args.protocol) {
    case "anthropic-messages":
      if (body.max_tokens === undefined) body.max_tokens = requestedCeiling;
      break;
    case "openai-responses":
      if (body.max_output_tokens === undefined) {
        body.max_output_tokens = requestedCeiling;
      }
      break;
    case "openai-completions":
      if (body.max_completion_tokens === undefined) {
        body.max_completion_tokens = requestedCeiling;
      }
      break;
    case "google-generative-ai": {
      const generationConfig =
        body.generationConfig &&
        typeof body.generationConfig === "object" &&
        !Array.isArray(body.generationConfig)
          ? { ...(body.generationConfig as Record<string, unknown>) }
          : {};
      if (generationConfig.maxOutputTokens === undefined) {
        generationConfig.maxOutputTokens = requestedCeiling;
      }
      body.generationConfig = generationConfig;
      break;
    }
  }
  return body;
};

export const shapeUpstreamRequest = (args: {
  request: Request;
  protocol: GatewayProtocol;
  route: ManagedRoute;
  requestJson: Record<string, unknown>;
  apiKey: string;
  ownerMode?: boolean;
  audience: ManagedModelAudience;
  outputCeiling?: number;
}): ShapedUpstreamRequest => {
  const shapingRequest = new Request(
    shapingUrlFor(args.request, args.protocol),
    {
      method: "POST",
      headers: args.request.headers,
    },
  );
  const clamped = clampOutputTokens({
    requestJson: args.requestJson,
    protocol: args.protocol,
    audience: args.audience,
    modelCeiling: args.outputCeiling ?? args.route.config.maxOutputTokens,
  });
  const maxOutputTokens = declaredMaxOutputTokens(clamped);
  const body = bodyForUpstream(
    {
      requestJson: streamingRequestJson(clamped, args.protocol),
      resolvedModel: args.route.resolvedModel,
      upstreamModel: args.route.upstreamModel,
      serviceTier: args.route.config.serviceTier,
      managedReasoningEffort: getManagedReasoningEffort(args.route.config),
      ...(maxOutputTokens !== null ? { maxOutputTokens } : {}),
    },
    args.route.provider,
    shapingRequest,
  );
  const url = upstreamUrl(
    args.route.provider,
    shapingRequest,
    args.route.upstreamModel,
  );
  const headers = cloneForwardHeaders(
    shapingRequest,
    args.route.provider,
    args.apiKey,
    undefined,
    !args.ownerMode,
  );
  headers.set("accept", "text/event-stream");
  return { url, headers, body, maxOutputTokens };
};

const usageTokens = (
  usage: RelayUsage | null,
  seen: TokenEstimate,
  complete: boolean,
): GatewayUsageTokens =>
  hasReportedTokens(usage)
    ? {
        inputTokens: usage.inputTokens ?? seen.inputTokens,
        outputTokens: complete
          ? (usage.outputTokens ?? seen.outputTokens)
          : Math.max(usage.outputTokens ?? 0, seen.outputTokens),
        ...(usage.cachedInputTokens !== undefined
          ? { cachedInputTokens: usage.cachedInputTokens }
          : {}),
        ...(usage.cacheWriteInputTokens !== undefined
          ? { cacheWriteTokens: usage.cacheWriteInputTokens }
          : {}),
        ...(usage.reasoningTokens !== undefined
          ? { reasoningTokens: usage.reasoningTokens }
          : {}),
        ...(usage.costMicroCents !== undefined
          ? { costMicroCents: usage.costMicroCents }
          : {}),
        reported: true,
      }
    : {
        inputTokens: seen.inputTokens,
        outputTokens: seen.outputTokens,
        reported: false,
      };

const hasReportedTokens = (usage: RelayUsage | null): usage is RelayUsage =>
  !!usage && (usage.inputTokens !== undefined || usage.outputTokens !== undefined);

export type AttemptCost = {
  chargedMicroCents: number;
  tokens: GatewayUsageTokens;
  basis: "actual" | "estimated";
};

/**
 * What one physical attempt cost Stella: the provider's reported cost when
 * it sent one, else the tokens it reported (or that were seen streaming
 * before a failure) at the tariff. `inputTokens` is the request estimate
 * the provider's own count replaces.
 */
export const attemptCost = (args: {
  model: string;
  price: TokenPriceConfig;
  usage: RelayUsage | null;
  inputTokens: number;
  streamedOutputTokens: number;
  /** The provider finished the response, so its reported counts are final. */
  complete: boolean;
}): AttemptCost => {
  const seen = { inputTokens: args.inputTokens, outputTokens: Math.max(0, args.streamedOutputTokens) };
  const tokens = usageTokens(args.usage, seen, args.complete);
  const reported =
    args.usage?.costMicroCents !== undefined && hasReportedTokens(args.usage)
      ? Math.max(0, Math.round(args.usage.costMicroCents))
      : null;
  // A reported $0 for tokens we used is not a real price (free promos, BYOK
  // fee-only reports); fall back to the tariff so usage is never free.
  if (reported !== null && reported > 0) {
    return { chargedMicroCents: reported, tokens, basis: "actual" };
  }
  const usage = args.usage;
  const estimated = computeUsageCostMicroCents({
    model: args.model,
    tokens: billableTokens({
      inputTokens: tokens.inputTokens,
      outputTokens: tokens.outputTokens,
      cachedInputTokens: usage?.cachedInputTokens,
      cacheWriteInputTokens: usage?.cacheWriteInputTokens,
      cacheWrite1hInputTokens: usage?.cacheWrite1hInputTokens,
      reasoningTokens: usage?.reasoningTokens,
    }),
    price: args.price,
  });
  if (reported === 0 && estimated === 0) return { chargedMicroCents: 0, tokens, basis: "actual" };
  return { chargedMicroCents: estimated, tokens, basis: "estimated" };
};

const recordOf = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const outputTextLengthInFrame = (
  protocol: GatewayProtocol,
  frame: SseFrame,
): number => {
  const event = frameJson(frame);
  if (!event) return 0;
  if (protocol === "anthropic-messages") {
    const delta = recordOf(event.delta);
    return [delta?.text, delta?.thinking, delta?.partial_json].reduce<number>(
      (total, value) => total + (typeof value === "string" ? value.length : 0),
      0,
    );
  }
  if (protocol === "openai-responses") {
    const type = typeof event.type === "string" ? event.type : frame.event;
    if (!type?.endsWith(".delta")) return 0;
    const delta = event.delta;
    if (typeof delta === "string") return delta.length;
    const record = recordOf(delta);
    return [
      record?.text,
      record?.arguments,
      record?.partial_json,
    ].reduce<number>(
      (total, value) => total + (typeof value === "string" ? value.length : 0),
      0,
    );
  }
  if (protocol === "openai-completions") {
    const choices = Array.isArray(event.choices) ? event.choices : [];
    let length = 0;
    for (const rawChoice of choices) {
      const delta = recordOf(recordOf(rawChoice)?.delta);
      if (!delta) continue;
      for (const field of [
        "content",
        "reasoning_content",
        "reasoning",
        "reasoning_text",
        "refusal",
      ] as const) {
        const value = delta[field];
        if (typeof value === "string") length += value.length;
      }
      const toolCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
      for (const rawCall of toolCalls) {
        const fn = recordOf(recordOf(rawCall)?.function);
        if (typeof fn?.arguments === "string") length += fn.arguments.length;
      }
    }
    return length;
  }

  const candidates = Array.isArray(event.candidates) ? event.candidates : [];
  let length = 0;
  for (const rawCandidate of candidates) {
    const content = recordOf(recordOf(rawCandidate)?.content);
    const parts = Array.isArray(content?.parts) ? content.parts : [];
    for (const rawPart of parts) {
      const text = recordOf(rawPart)?.text;
      if (typeof text === "string") length += text.length;
    }
  }
  return length;
};

type TierReservation = { estimateMicroCents: number; minute: number };

const reserveTierBudget = async (args: {
  env: Env;
  timing: RelayTiming;
  now: () => number;
  limitsAudience: ManagedModelAudienceForLimits;
  ceiling: { hourlyMicroCents: number; dailyMicroCents: number };
  estimateMicroCents: number;
}): Promise<{
  gate: ReturnType<Env["TIER_BUDGET"]["get"]>;
  reservation: TierReservation;
}> => {
  const { env, limitsAudience } = args;
  const gate = env.TIER_BUDGET.get(env.TIER_BUDGET.idFromName(limitsAudience));
  const reservation = await args.timing.measure("tierReservationMs", () =>
    gate.reserve({
      estimateMicroCents: args.estimateMicroCents,
      hourlyCeiling: args.ceiling.hourlyMicroCents,
      dailyCeiling: args.ceiling.dailyMicroCents,
      now: args.now(),
    }),
  );
  if (!reservation.ok) {
    throw new GatewayError(
      429,
      "tier_paused",
      "Managed model access is paused for this plan.",
      quotaErrorOptions({
        scope: "tier",
        now: args.now(),
        resetAt: reservation.resetAt,
        retryable: true,
      }),
    );
  }
  return {
    gate,
    reservation: {
      estimateMicroCents: args.estimateMicroCents,
      minute: reservation.minute,
    },
  };
};

export const handleManagedRelay = async (args: {
  request: Request;
  env: Env;
  deps: GatewayDeps;
  traceId: string;
  auth: AuthenticatedCapability;
  protocol: GatewayProtocol;
  timing: RelayTiming;
  ownerAccounting?: OwnerRelayAccounting;
  configStorage?: GatewayConfigStorage;
  sharedConfig?: SharedGatewayConfigStore;
  ownerEnforcement?: (
    ownerId: string,
    now: number,
  ) => Promise<OwnerEnforcementAdmission>;
}): Promise<Response> => {
  const { request, env, deps, traceId, protocol, timing } = args;
  const { claims, probe } = args.auth;
  const startedAt = deps.now();
  const pathname = new URL(request.url).pathname;
  const { requestId } = requestIdFrom(request);
  const deviceKeyHash = await timing.measure("dpopMs", () =>
    verifySessionDpop({
      request,
      auth: args.auth,
      now: deps.now(),
    }),
  );
  const configWork = timing
    .measure("pricingConfigMs", () =>
      getGatewayConfig(
        billingGatewayConfig(env),
        deps.waitUntil,
        deps.now,
        args.configStorage,
        args.sharedConfig,
      ),
    )
    .then(
      (value) => ({ ok: true as const, value }),
      (error) => ({ ok: false as const, error }),
    );
  const enforcementWork = timing
    .measure("ownerEnforcementMs", () =>
      args.ownerEnforcement
        ? args.ownerEnforcement(claims.sub, deps.now())
        : ownerEnforcementAdmission(env, claims.sub, deps.now()),
    )
    .then(
      (value) => ({ ok: true as const, value }),
      (error) => ({ ok: false as const, error }),
    );
  let predictedRequestJson:
    | Awaited<ReturnType<typeof readJsonObject>>
    | undefined;
  const predictedRevision = request.headers.get(GATEWAY_MODEL_REVISION_HEADER);
  if (predictedRevision !== null) {
    predictedRequestJson = await readJsonObject(request);
    const agentType = agentTypeFrom(request);
    if (!agentType)
      throw new GatewayError(
        400,
        "bad_request",
        "The x-stella-agent-type header is required.",
      );
    assertAgentTypeAllowed(claims, agentType);
    const requestedModel =
      protocol === "google-generative-ai"
        ? (requestedModelFromGooglePath(pathname) ?? undefined)
        : typeof predictedRequestJson.model === "string"
          ? predictedRequestJson.model
          : undefined;
    const route = resolveManagedRoute({ claims, agentType, requestedModel });
    const resolution = managedModelDescriptor(route);
    if (
      predictedRevision !== (await gatewayModelResolutionRevision(resolution))
    ) {
      throw new GatewayError(
        409,
        "model_revision_mismatch",
        "The model configuration changed. Rebuild the request with the current descriptor.",
        {
          headers: {
            "x-should-retry": "false",
            [GATEWAY_MODEL_RESOLUTION_HEADER]: encodeURIComponent(
              JSON.stringify(resolution),
            ),
          },
        },
      );
    }
  }
  const enforcementResult = await enforcementWork;
  if (!enforcementResult.ok) throw enforcementResult.error;
  const enforcement = enforcementResult.value;
  if (enforcement.suspended) {
    throw new GatewayError(
      403,
      "owner_suspended",
      "This account is suspended from model access.",
    );
  }

  const limitsAudience = limitsAudienceFor(claims.audience);
  const networkClass = await classifyNetwork(request, env.ASN_POLICY);
  const networkCapShare =
    limitsAudience === "free" &&
    GATEWAY_NETWORK_POLICY.freeChallenged.some(
      (challenged) => challenged === networkClass,
    )
      ? 0.5
      : 1;
  let ipHash: string | undefined;
  if (limitsAudience === "free") {
    ipHash = await ipHashFrom(request);
  }
  if (ipHash && limitsAudience === "free") {
    const networkGate = env.NETWORK_GATE.get(
      env.NETWORK_GATE.idFromName(ipHash),
    );
    const admission = await networkGate.admitRelay({
      audience: claims.audience,
      capShare: networkCapShare,
    });
    if (!admission.ok) {
      throw new GatewayError(
        429,
        "rate_limited",
        "Too many model requests from this network.",
        quotaErrorOptions({
          scope: "network",
          now: deps.now(),
          resetAt: admission.resetAt,
        }),
      );
    }
  }

  const ownerGate =
    args.ownerAccounting ??
    env.OWNER_RELAY_GATE.get(env.OWNER_RELAY_GATE.idFromName(claims.sub));
  const accounting = probe
    ? null
    : relayAccounting(env, claims, ownerGate, {
        audience: claims.audience,
        throttled: enforcement.throttled,
      });
  let ownerAdmissionHeld = false;
  if (accounting?.authority !== "owner") {
    const ownerAdmission = await timing.measure("ownerAdmissionMs", () =>
      ownerGate.admitRelay({
        audience: claims.audience,
        requestId,
        throttled: enforcement.throttled,
      }),
    );
    if (!ownerAdmission.ok) {
      throw new GatewayError(
        429,
        ownerAdmission.refused,
        ownerAdmission.refused === "concurrency_limit"
          ? "This account has too many model requests in flight."
          : "This account is sending model requests too quickly.",
        quotaErrorOptions({
          scope: "owner",
          now: deps.now(),
          resetAt: ownerAdmission.resetAt,
        }),
      );
    }
    ownerAdmissionHeld = !ownerAdmission.duplicate;
  }

  let tierGate: ReturnType<Env["TIER_BUDGET"]["get"]> | null = null;
  let tierReservation: TierReservation | null = null;
  let tierActualMicroCents = 0;
  let held: HeldReservation | null = null;
  let heldSettled = false;
  let firstUpstreamByte = false;

  try {
    const agentType = agentTypeFrom(request);
    if (!agentType) {
      throw new GatewayError(
        400,
        "bad_request",
        "The x-stella-agent-type header is required.",
      );
    }
    assertAgentTypeAllowed(claims, agentType);

    const requestJson = predictedRequestJson ?? (await readJsonObject(request));
    if (requestJson.stream === true) {
      throw new GatewayError(
        400,
        "stream_unsupported",
        "The managed lane is request/response; send stream: false and receive the complete object.",
      );
    }

    let requestedModel =
      typeof requestJson.model === "string" ? requestJson.model : undefined;
    if (protocol === "google-generative-ai") {
      const pathModel = requestedModelFromGooglePath(pathname);
      if (pathModel) requestedModel = pathModel;
    }

    const bindingError = validateManagedCloudBinding({
      execution: claims.turn?.execution,
      viaTurnToken: claims.kind === "turn",
      requestedModel,
    });
    if (bindingError) {
      throw new GatewayError(
        bindingError.status,
        bindingError.status === 403 ? "execution_mismatch" : "bad_request",
        bindingError.message,
      );
    }

    const route = resolveManagedRoute({ claims, agentType, requestedModel });
    if (!PROTOCOLS_BY_PROVIDER[route.provider].includes(protocol)) {
      throw new GatewayError(
        400,
        "bad_request",
        `Model "${route.requestedModel}" speaks ${route.protocol}; this relay path carries ${protocol}.`,
      );
    }
    const configResult = await configWork;
    if (!configResult.ok) throw configResult.error;
    const config = configResult.value;
    const price = config.priceFor(route.resolvedModel);
    if (!price) {
      throw new GatewayError(
        500,
        "internal",
        `Model "${route.resolvedModel}" has no price.`,
      );
    }
    const modelCeiling = route.config.maxOutputTokens;
    const cappedRequestJson = clampOutputTokens({
      requestJson,
      protocol,
      audience: claims.audience,
      modelCeiling,
    });
    const estimate = estimateRequestTokens(cappedRequestJson);
    const maxOutputTokens =
      declaredMaxOutputTokens(cappedRequestJson) ?? ASSUMED_MAX_OUTPUT_TOKENS;
    const inputEstimateMicroCents = computeUsageCostMicroCents({
      model: route.resolvedModel,
      tokens: billableTokens({ inputTokens: estimate.inputTokens, outputTokens: 0 }),
      price,
    });
    // Priced as reasoning, which no provider bills below the output rate.
    const outputMicroCentsPerToken =
      computeUsageCostMicroCents({
        model: route.resolvedModel,
        tokens: billableTokens({
          inputTokens: 0,
          outputTokens: 1_000_000,
          reasoningTokens: 1_000_000,
        }),
        price,
      }) / 1_000_000;
    const costWithOutput = (outputTokens: number): number =>
      Math.ceil(inputEstimateMicroCents + outputTokens * outputMicroCentsPerToken);
    const maxCostMicroCents = costWithOutput(maxOutputTokens);
    if (!(maxCostMicroCents > 0)) {
      throw new GatewayError(
        500,
        "internal",
        `Model "${route.resolvedModel}" has a non-positive price.`,
      );
    }

    const gatewayConfig = getManagedGatewayConfig(route.provider);
    const apiKey = resolveManagedGatewayApiKeyFromEnv(
      gatewayConfig,
      env as unknown as Readonly<Record<string, string | undefined>>,
    );
    if (!apiKey) {
      if (ownerModeEnabled(env)) {
        throw new GatewayError(
          403,
          "model_forbidden",
          "Stella's own models aren't set up on this server. Use your Claude or ChatGPT account, or add an OpenRouter key to the server.",
          { retryable: false },
        );
      }
      throw new GatewayError(503, "internal", "The model provider is not configured.", { retryable: false });
    }

    let capabilityHardLimitMicroCents: number | null = null;
    let heldMicroCents = maxCostMicroCents;
    let attemptNumber = 1;
    if (accounting) {
      const reservation = await timing.measure(
        accounting.authority === "owner"
          ? "ownerReservationMs"
          : "ledgerReservationMs",
        () =>
          accounting.reserve({
            jti: claims.jti,
            budgetMicroCents: claims.budgetMicroCents,
            maxRequests: claims.maxRequests,
            expiresAt: claims.exp * 1000,
            requestId,
            estimatedMicroCents: maxCostMicroCents,
            minimumMicroCents: costWithOutput(
              Math.min(maxOutputTokens, MIN_AFFORDABLE_OUTPUT_TOKENS),
            ),
          }),
      );
      switch (reservation.kind) {
        case "refused":
          throw new GatewayError(
            429,
            reservation.refused,
            reservation.refused === "concurrency_limit"
              ? "This account has too many model requests in flight."
              : "This account is sending model requests too quickly.",
            quotaErrorOptions({
              scope: "owner",
              now: deps.now(),
              resetAt: reservation.resetAt,
            }),
          );
        case "replay":
          return new Response(reservation.body, {
            status: reservation.status,
            headers: {
              "cache-control": "no-store",
              "content-type": "application/json; charset=utf-8",
              [GATEWAY_TRACE_HEADER]: traceId,
              [GATEWAY_REPLAY_HEADER]: "1",
            },
          });
        case "in_flight":
          throw new GatewayError(
            409,
            "bad_request",
            `Request "${requestId}" is still in flight; retry after it completes.`,
            { retryable: true },
          );
        case "budget_exhausted":
          throw new GatewayError(
            402,
            "budget_exhausted",
            "This capability's spending budget is exhausted.",
            quotaErrorOptions({ scope: "capability", now: deps.now() }),
          );
        case "request_limit":
          throw new GatewayError(
            429,
            "request_limit",
            `This capability's request limit (${reservation.maxRequests}) has been reached.`,
            quotaErrorOptions({ scope: "capability", now: deps.now() }),
          );
        case "reserved":
          held = reservation.held;
          heldMicroCents = reservation.held.heldMicroCents;
          attemptNumber = reservation.held.attemptNumber;
          capabilityHardLimitMicroCents =
            reservation.held.remainingMicroCents === null
              ? null
              : heldMicroCents + reservation.held.remainingMicroCents;
          break;
      }
    }
    // A partial hold buys only the output it covers; the provider is told so.
    const affordableOutputTokens =
      heldMicroCents < maxCostMicroCents
        ? Math.max(
            1,
            Math.floor(
              (heldMicroCents - inputEstimateMicroCents) / outputMicroCentsPerToken,
            ),
          )
        : null;
    // Stored conversation images arrive as signed URLs; a provider that
    // can't fetch them gets the bytes inline instead.
    let upstreamRequestJson = cappedRequestJson;
    if (
      !providerFetchesImageUrls(route.provider) &&
      mayCarryStoredImages(JSON.stringify(cappedRequestJson))
    ) {
      const images = await inlineStoredImages(cappedRequestJson, {
        fetch: deps.fetch,
        backendOrigin: env.STELLA_BACKEND_URL,
      });
      upstreamRequestJson = images.json;
      if (images.inlined > 0 || images.failed > 0) {
        console.log(
          `[model-gateway] trace=${traceId} provider=${route.provider} stored_images_inlined=${images.inlined} failed=${images.failed}`,
        );
      }
    }
    const {
      url: target,
      headers,
      body: upstreamBody,
      maxOutputTokens: upstreamMaxOutputTokens,
    } = shapeUpstreamRequest({
      request,
      protocol,
      route,
      requestJson: upstreamRequestJson,
      apiKey,
      ownerMode: ownerModeEnabled(env),
      audience: claims.audience,
      ...(affordableOutputTokens !== null
        ? {
            outputCeiling: Math.min(
              modelCeiling ?? Number.POSITIVE_INFINITY,
              affordableOutputTokens,
            ),
          }
        : {}),
    });

    const tierCeiling = config.tierCeilings.get(limitsAudience);
    if (
      !probe &&
      claims.budgetMicroCents !== GATEWAY_BUDGET_UNLIMITED &&
      tierCeiling &&
      (tierCeiling.hourlyMicroCents >= 0 || tierCeiling.dailyMicroCents >= 0)
    ) {
      const tier = await reserveTierBudget({
        env,
        timing,
        now: deps.now,
        limitsAudience,
        ceiling: tierCeiling,
        estimateMicroCents: heldMicroCents,
      });
      tierGate = tier.gate;
      tierReservation = tier.reservation;
    }

    const tariffVersion = `models@${new Date(config.snapshot.updatedAt).toISOString()}`;
    const finish = async (
      outcome: GatewayUsageOutcome,
      cost: AttemptCost,
      upstreamStatus: number | undefined,
      refundRequest: boolean,
      result?: RelaySettlement["result"],
    ): Promise<LedgerSettleResult | null> => {
      const chargedMicroCents = cost.chargedMicroCents;
      tierActualMicroCents = chargedMicroCents;
      const event: GatewayUsageEvent | null = probe
        ? null
        : {
            v: GATEWAY_USAGE_EVENT_VERSION,
            requestId,
            capabilityId: claims.jti,
            kind: claims.kind,
            ownerId: claims.sub,
            ownerGeneration: claims.gen,
            audience: claims.audience,
            agentType,
            ...(claims.turn
              ? {
                  turnId: claims.turn.turnId,
                  conversationId: claims.turn.conversationId,
                }
              : {}),
            provider: route.provider,
            protocol,
            requestedModel: route.requestedModel,
            resolvedModel: route.resolvedModel,
            usage: cost.tokens,
            chargedMicroCents,
            outcome,
            ...(upstreamStatus !== undefined ? { upstreamStatus } : {}),
            startedAt,
            finishedAt: deps.now(),
            billable: true,
            networkClass,
            ...(deviceKeyHash ? { deviceKeyHash } : {}),
            providerCostMicroCents: chargedMicroCents,
            costBasis: cost.basis,
            attempt: attemptNumber,
            tariffVersion,
          };
      let settlement: LedgerSettleResult | null = null;
      let recorded = false;
      if (held) {
        const reservation = held;
        try {
          settlement = await timing.measure("ledgerSettlementMs", () =>
            reservation.settle({
              chargedMicroCents,
              refundRequest,
              result,
              ...(event ? { usage: event } : {}),
            }),
          );
          heldSettled = true;
          recorded = true;
          if (result) timing.mark("resultPersisted");
        } catch (error) {
          console.error(
            `[model-gateway] trace=${traceId} ledger settlement failed: ${error instanceof Error ? error.message : "unknown"}`,
          );
        }
      }
      if (event && !recorded) {
        try {
          await env.USAGE_QUEUE.send(event);
        } catch (error) {
          logUnreconciled(event, "enqueue_failed", {
            error: error instanceof Error ? error.message : "unknown",
          });
        }
      }
      return settlement;
    };

    const controller = createUpstreamController({
      clientSignal: request.signal,
      idleTimeoutMs: GATEWAY_UPSTREAM_IDLE_TIMEOUT_MS,
      maxDurationMs: GATEWAY_UPSTREAM_MAX_DURATION_MS,
    });
    const usageParser = createRelayUsageParser(route.provider);
    let streamedOutputChars = 0;
    const costOf = (usage: RelayUsage | null, complete: boolean): AttemptCost =>
      attemptCost({
        model: route.resolvedModel,
        price,
        usage,
        inputTokens: estimate.inputTokens,
        streamedOutputTokens: Math.ceil(streamedOutputChars / 4),
        complete,
      });
    const nothingBilled: AttemptCost = {
      chargedMicroCents: 0,
      tokens: { inputTokens: 0, outputTokens: 0, reported: false },
      basis: "estimated",
    };
    const runningCostFor = (outputTokens: number): number =>
      inputEstimateMicroCents +
      computeUsageCostMicroCents({
        model: route.resolvedModel,
        tokens: billableTokens({ inputTokens: 0, outputTokens }),
        price,
      });

    const abortedError = (): GatewayError => {
      switch (controller.cause()) {
        case "client":
          return new GatewayError(
            499,
            "canceled",
            "The caller canceled the request.",
          );
        case "idle":
          return new GatewayError(
            504,
            "upstream_timeout",
            "The model provider stopped sending data.",
            { retryable: true },
          );
        case "duration":
          return new GatewayError(
            504,
            "upstream_timeout",
            "The model completion exceeded the maximum duration.",
            { retryable: true },
          );
        case "budget":
          return new GatewayError(
            402,
            "budget_exhausted",
            "This capability's spending budget is exhausted.",
            quotaErrorOptions({ scope: "capability", now: deps.now() }),
          );
        default:
          return new GatewayError(
            502,
            "upstream_error",
            "The model provider connection failed.",
            { retryable: true },
          );
      }
    };

    const readUpstreamText = async (response: Response): Promise<string> => {
      if (!response.body) return "";
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const chunks: string[] = [];
      let bytes = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            timing.mark("upstreamBodyComplete");
            break;
          }
          if (value.byteLength) timing.mark("firstUpstreamByte");
          controller.touch();
          bytes += value.byteLength;
          if (bytes > MAX_UPSTREAM_STREAM_BYTES) {
            await reader.cancel("body_too_large");
            throw new GatewayError(
              502,
              "upstream_error",
              "The provider response exceeded the size limit.",
            );
          }
          chunks.push(decoder.decode(value, { stream: true }));
        }
        chunks.push(decoder.decode());
        return chunks.join("");
      } finally {
        reader.releaseLock();
      }
    };
    let upstream: Response;
    try {
      timing.mark("providerDispatch");
      // Outbound fetch already waits for these writes in a Durable Object.
      // Await that same gate explicitly so it is counted as application
      // overhead instead of being hidden inside provider time.
      if (deps.beforeProviderDispatch) {
        await timing.measure(
          "providerOutputGateMs",
          deps.beforeProviderDispatch,
        );
      }
      controller.signal.throwIfAborted();
      timing.mark("providerDispatchReady");
      upstream = await deps.fetch(target, {
        method: "POST",
        headers,
        body: upstreamBody,
        signal: controller.signal,
      });
    } catch (error) {
      controller.dispose();
      const failure = abortedError();
      console.warn(
        `[model-gateway] trace=${traceId} provider=${route.provider} upstream fetch failed cause=${controller.cause() ?? (error instanceof Error ? error.message : "unknown")}`,
      );
      // No response, so no token reached us and none was billed.
      await finish(
        failure.code === "canceled" ? "aborted" : "failed",
        nothingBilled,
        undefined,
        true,
      );
      throw failure;
    }
    timing.mark("upstreamHeaders");
    controller.touch();

    if (!upstream.ok) {
      let text = "";
      try {
        text = await readUpstreamText(upstream);
      } catch {
        text = "";
      }
      controller.dispose();
      const body = upstreamErrorBody(upstream.status, text, [apiKey]);
      console.warn(
        `[model-gateway] trace=${traceId} provider=${route.provider} model=${route.resolvedModel} upstream status=${upstream.status}`,
      );
      usageParser.pushText(text);
      const errorUsage = usageParser.finish();
      await finish(
        "failed",
        hasReportedTokens(errorUsage) ? costOf(errorUsage, true) : nothingBilled,
        upstream.status,
        !hasReportedTokens(errorUsage),
      );
      if (upstream.status === 401 || upstream.status === 403) {
        throw new GatewayError(
          502,
          "upstream_error",
          "The model provider refused the gateway's credentials.",
          {
            retryable: false,
            upstreamStatus: upstream.status,
          },
        );
      }
      return jsonResponse(upstream.status, body, traceId);
    }

    const assembler = assemblerFor(protocol);
    const contentType = upstream.headers.get("content-type") ?? "";
    const isJson =
      /application\/json/iu.test(contentType) &&
      !/text\/event-stream/iu.test(contentType);
    let assembled: Record<string, unknown> | null = null;
    let assemblyFailure: { message: string; detail?: unknown } | null = null;
    let budgetStop: AttemptCost | null = null;

    try {
      if (isJson) {
        const text = await readUpstreamText(upstream);
        firstUpstreamByte = text.length > 0;
        streamedOutputChars = text.length;
        usageParser.pushText(text);
        const parsed = JSON.parse(text) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          assembled = parsed as Record<string, unknown>;
        } else {
          assemblyFailure = {
            message: "The model provider returned a non-object JSON body.",
          };
        }
      } else if (!upstream.body) {
        assemblyFailure = {
          message: "The model provider returned an empty stream.",
        };
      } else {
        const reader = upstream.body.getReader();
        const decoder = new TextDecoder();
        const sse = createSseParser();
        let received = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              timing.mark("upstreamBodyComplete");
              break;
            }
            if (value.byteLength > 0) {
              firstUpstreamByte = true;
              timing.mark("firstUpstreamByte");
            }
            controller.touch();
            received += value.byteLength;
            if (received > MAX_UPSTREAM_STREAM_BYTES) {
              await reader.cancel("stream_too_large");
              assemblyFailure = {
                message: "The model provider stream exceeded the size limit.",
              };
              break;
            }
            const text = decoder.decode(value, { stream: true });
            usageParser.pushText(text);
            for (const frame of sse.push(text)) {
              streamedOutputChars += outputTextLengthInFrame(protocol, frame);
              assembler.push(frame);
            }
            const partialUsage = usageParser.current();
            const outputTokens = Math.max(
              partialUsage?.outputTokens ?? 0,
              Math.ceil(streamedOutputChars / 4),
            );
            const runningCost = runningCostFor(outputTokens);
            if (
              capabilityHardLimitMicroCents !== null &&
              runningCost > capabilityHardLimitMicroCents
            ) {
              await reader.cancel("budget_exhausted");
              controller.abort("budget");
              const partial = costOf(partialUsage, false);
              budgetStop = {
                ...partial,
                chargedMicroCents: Math.max(partial.chargedMicroCents, runningCost),
              };
              break;
            }
          }
        } finally {
          reader.releaseLock();
        }
        if (!budgetStop) {
          const tail = decoder.decode();
          if (tail) {
            usageParser.pushText(tail);
            for (const frame of sse.push(tail)) assembler.push(frame);
          }
          for (const frame of sse.finish()) assembler.push(frame);
          if (!assemblyFailure) {
            const outcome = assembler.finish();
            if (outcome.ok) assembled = outcome.body;
            else {
              assemblyFailure = {
                message: outcome.message,
                detail: outcome.detail,
              };
            }
          }
        }
      }
    } catch (error) {
      controller.dispose();
      const failure = abortedError();
      const usage = usageParser.finish();
      console.warn(
        `[model-gateway] trace=${traceId} provider=${route.provider} stream read failed cause=${controller.cause() ?? (error instanceof Error ? error.message : "unknown")}`,
      );
      // Whatever streamed before the failure was generated, and billed.
      await finish(
        failure.code === "canceled" ? "aborted" : "failed",
        firstUpstreamByte ? costOf(usage, false) : nothingBilled,
        upstream.status,
        !firstUpstreamByte,
      );
      throw failure;
    }
    controller.dispose();

    if (budgetStop) {
      await finish("failed", budgetStop, upstream.status, false);
      throw new GatewayError(
        402,
        "budget_exhausted",
        "This capability's spending budget is exhausted.",
        quotaErrorOptions({ scope: "capability", now: deps.now() }),
      );
    }

    const usage = usageParser.finish();
    if (assemblyFailure || !assembled) {
      console.warn(
        `[model-gateway] trace=${traceId} provider=${route.provider} model=${route.resolvedModel} assembly failed: ${assemblyFailure?.message ?? "unknown"} detail=${JSON.stringify(assemblyFailure?.detail ?? null).slice(0, 2_000)}`,
      );
      await finish(
        "failed",
        firstUpstreamByte ? costOf(usage, false) : nothingBilled,
        upstream.status,
        !firstUpstreamByte,
      );
      throw new GatewayError(
        502,
        "upstream_error",
        assemblyFailure?.message ??
          "The model provider stream could not be assembled.",
        { retryable: true, upstreamStatus: upstream.status },
      );
    }

    const bodyText = JSON.stringify(assembled);
    timing.mark("assemblyComplete");
    const cost = costOf(usage, true);
    const settlement = await finish(
      "succeeded",
      cost,
      upstream.status,
      false,
      {
        status: upstream.status,
        body: bodyText,
      },
    );
    console.log(
      `[model-gateway] trace=${traceId} agent=${agentType} requested=${route.requestedModel} resolved=${route.resolvedModel} provider=${route.provider} protocol=${protocol} status=${upstream.status} charged=${cost.chargedMicroCents} basis=${cost.basis} attempt=${attemptNumber} max_output=${upstreamMaxOutputTokens ?? "-"} held=${heldMicroCents} reported=${usage ? 1 : 0} ledger_settled=${settlement ? (settlement.ok ? 1 : 0) : "-"} ledger_spent=${settlement?.spentMicroCents ?? "-"} ledger_reserved=${settlement?.reservedMicroCents ?? "-"} ms=${deps.now() - startedAt}`,
    );
    return new Response(bodyText, {
      status: upstream.status,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
        [GATEWAY_TRACE_HEADER]: traceId,
      },
    });
  } finally {
    if (held && !heldSettled) {
      const reservation = held;
      try {
        await timing.measure("ledgerSettlementMs", () =>
          reservation.settle({
            chargedMicroCents: 0,
            refundRequest: !firstUpstreamByte,
          }),
        );
      } catch (error) {
        console.error(
          `[model-gateway] trace=${traceId} ledger release failed: ${error instanceof Error ? error.message : "unknown"}`,
        );
      }
    }
    if (tierGate && tierReservation) {
      const reservation = tierReservation;
      const gate = tierGate;
      try {
        await timing.measure("tierSettlementMs", () =>
          gate.settle({
            estimateMicroCents: reservation.estimateMicroCents,
            actualMicroCents: tierActualMicroCents,
            minute: reservation.minute,
          }),
        );
      } catch (error) {
        console.error(
          `[model-gateway] trace=${traceId} tier settlement failed: ${error instanceof Error ? error.message : "unknown"}`,
        );
      }
    }
    try {
      if (ownerAdmissionHeld)
        await timing.measure("ownerReleaseMs", () =>
          ownerGate.releaseRelay(requestId),
        );
    } catch (error) {
      console.error(
        `[model-gateway] trace=${traceId} owner gate release failed: ${error instanceof Error ? error.message : "unknown"}`,
      );
    }
  }
};
