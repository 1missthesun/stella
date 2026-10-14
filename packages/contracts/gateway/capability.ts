import type { CloudExecutionSelection } from "../agent-engine.js";
import type { StellaUsageLimitReason } from "../stella-usage-limit.js";

export const GATEWAY_CAPABILITY_AUDIENCE = "stella-model-gateway" as const;

export type CapabilityAudience = typeof GATEWAY_CAPABILITY_AUDIENCE;

export const GATEWAY_CAPABILITY_ISSUERS = {
  cloudBuilder: "stella-cloud-builder",
} as const;

export type GatewayCapabilityIssuer =
  (typeof GATEWAY_CAPABILITY_ISSUERS)[keyof typeof GATEWAY_CAPABILITY_ISSUERS];

export const GATEWAY_CAPABILITY_ALGORITHM = "ES256" as const;

export type GatewayCapabilityKind = "session" | "turn";

export const MANAGED_MODEL_AUDIENCES = [
  "free",
  "go",
  "pro",
  "go_fallback",
  "pro_fallback",
] as const;

export type ManagedModelAudience = (typeof MANAGED_MODEL_AUDIENCES)[number];

export type GatewayNativeCredentialProvider = "chatgpt";

export const GATEWAY_BUDGET_UNLIMITED = -1;

export type GatewayTurnBinding = {
  turnId: string;
  conversationId: string;
  execution: CloudExecutionSelection;
};

export type GatewayCapabilityClaims = {
  iss: GatewayCapabilityIssuer;
  aud: CapabilityAudience;
  sub: string;
  jti: string;
  iat: number;
  exp: number;
  gen: string;
  kind: GatewayCapabilityKind;
  audience: ManagedModelAudience;
  agentTypes?: string[];
  budgetMicroCents: number;
  maxRequests?: number;
  dpk?: string;
  turn?: GatewayTurnBinding;
  credential?: GatewayNativeCredentialProvider;
  ledgerScope?: "owner-relay-v2";
  usageLimit?: StellaUsageLimitReason;
};

export const GATEWAY_SESSION_CAPABILITY_TTL_MS = 60 * 60 * 1000;
export const GATEWAY_TURN_CAPABILITY_TTL_MS = 30 * 60 * 1000;
export const GATEWAY_CAPABILITY_CLOCK_SKEW_S = 60;

// Derive from the host's WebCrypto definitions: Node/Bun expose the JWK type
// inside webcrypto rather than as the browser's global JsonWebKey name.
type GatewayJsonWebKey = Exclude<Awaited<ReturnType<typeof crypto.subtle.exportKey>>, ArrayBuffer>;

export type GatewayJwks = {
  keys: Array<{ kid: string; jwk: GatewayJsonWebKey; issuer: GatewayCapabilityIssuer }>;
};

export const isManagedModelAudience = (
  value: unknown,
): value is ManagedModelAudience =>
  typeof value === "string" &&
  (MANAGED_MODEL_AUDIENCES as readonly string[]).includes(value);
