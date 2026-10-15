import type {
  GatewayCapabilityKind,
  ManagedModelAudience,
} from "./capability.js";
import type {
  GatewayErrorCode,
  GatewayProtocol,
  GatewayProvider,
  GatewaySessionCapabilityResponse,
  IdentityLevel,
  NetworkClass,
} from "./api.js";

export const GATEWAY_USAGE_EVENT_VERSION = 1 as const;

export type GatewayUsageTokens = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  costMicroCents?: number;
  reported: boolean;
};

export type GatewayUsageOutcome = "succeeded" | "failed" | "aborted";

export type GatewayUsageEvent = {
  v: typeof GATEWAY_USAGE_EVENT_VERSION;
  requestId: string;
  capabilityId: string;
  kind: GatewayCapabilityKind;
  ownerId: string;
  ownerGeneration: string;
  audience: ManagedModelAudience;
  agentType: string;
  turnId?: string;
  conversationId?: string;
  provider: GatewayProvider;
  protocol: GatewayProtocol;
  requestedModel: string;
  resolvedModel: string;
  usage: GatewayUsageTokens;
  chargedMicroCents: number;
  outcome: GatewayUsageOutcome;
  upstreamStatus?: number;
  startedAt: number;
  finishedAt: number;
  billable: boolean;
  networkClass?: NetworkClass;
  deviceKeyHash?: string;
  // What the provider billed Stella for this attempt, when it differs from
  // the charge (e.g. a failed attempt Stella absorbs).
  providerCostMicroCents?: number;
  costBasis?: "actual" | "estimated";
  // 1 for the first physical attempt of a request, 2+ for retries.
  attempt?: number;
  tariffVersion?: string;
};

export type GatewayUsageBatch = {
  v: typeof GATEWAY_USAGE_EVENT_VERSION;
  events: GatewayUsageEvent[];
};

export type GatewayUsageBatchResult = {
  accepted: string[];
  duplicate: string[];
  rejected: Array<{ requestId: string; reason: string }>;
};


export const OWNER_ENFORCEMENT_STATUSES = [
  "ok",
  "challenged",
  "throttled",
  "suspended",
] as const;

export type OwnerEnforcementStatus = (typeof OWNER_ENFORCEMENT_STATUSES)[number];

export type OwnerEnforcement = {
  status: OwnerEnforcementStatus;
  until?: number;
  reason?: string;
};

export type OwnerEnforcementState = {
  enforcement: OwnerEnforcement;
  updatedAt: number | null;
};

export type GatewayOwnerEnforcementRequest = {
  ownerId: string;
  enforcement: OwnerEnforcement;
  updatedAt: number;
};

export type GatewayTierCeiling = {
  audience: ManagedModelAudience;
  hourlyMicroCents: number;
  dailyMicroCents: number;
};

export type GatewayModelPrice = {
  model: string;
  inputPerMillionUsd: number;
  outputPerMillionUsd: number;
  cacheReadPerMillionUsd: number;
  cacheWritePerMillionUsd: number;
  reasoningPerMillionUsd: number;
};

export type GatewayConfigSnapshot = {
  v: 1;
  prices: GatewayModelPrice[];
  tierCeilings: GatewayTierCeiling[];
  updatedAt: number;
};

export type SessionCapabilityRequest = {
  ownerId: string;
  ipHash?: string;
  networkClass?: NetworkClass;
  turnstileToken?: string;
  deviceKeyHash: string;
};

export type SessionAdmissionResponse = {
  ownerGeneration: string;
  identityLevel: IdentityLevel;
};

export type BillingControlResult<T> =
  | { ok: true; body: T }
  | { ok: false; status: number | null; code: GatewayErrorCode | null; retryable: boolean };

export type BillingControlRpc = {
  issueSessionCapability(
    request: SessionCapabilityRequest,
  ): Promise<BillingControlResult<GatewaySessionCapabilityResponse>>;
  ingestUsage(batch: GatewayUsageBatch): Promise<GatewayUsageBatchResult>;
  gatewayConfig(): Promise<GatewayConfigSnapshot>;
  ownerEnforcement(ownerId: string): Promise<OwnerEnforcementState>;
  engineAccess(
    request: EngineAccessRequest,
  ): Promise<BillingControlResult<EngineAccessResponse>>;
  providerAccess(
    request: ProviderAccessRequest,
  ): Promise<BillingControlResult<ProviderAccessResponse>>;
};

export type { IdentityLevel };

export type EngineAccessRequest = {
  ownerId: string;
  ownerGeneration: string;
  provider: "chatgpt";
};

export type EngineAccessResponse = {
  accessToken: string;
  engineAccountId?: string;
  expiresAt: number;
};

export type EngineAccessResult =
  | EngineAccessResponse
  | { needsSignIn: true; engineAccountId: string }
  | null;

export type ProviderAccessRequest = {
  ownerId: string;
  ownerGeneration: string;
  provider: string;
};

export type ProviderAccessResponse = {
  apiKey?: string;
  headers?: Record<string, string>;
  baseUrls: string[];
  rebase?: { from: string; to: string };
  expiresAt: number;
};

export type ProviderAccessResult =
  | ProviderAccessResponse
  | { needsSignIn: true }
  | null;
