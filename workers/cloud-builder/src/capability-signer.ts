import type { CloudExecutionSelection } from "@stella/contracts/agent-engine";
import {
  GATEWAY_CAPABILITY_AUDIENCE,
  GATEWAY_CAPABILITY_ISSUERS,
  GATEWAY_TURN_CAPABILITY_TTL_MS,
  isManagedModelAudience,
  type CapabilityAudience,
  type GatewayCapabilityClaims,
  type GatewayNativeCredentialProvider,
  type ManagedModelAudience,
} from "@stella/contracts/gateway/capability";
import {
  importCapabilitySigningKey,
  signCapability,
  type CapabilitySigningKey,
} from "@stella/contracts/gateway/jwt";

export type CapabilitySignerEnv = {
  CAPABILITY_SIGNING_KEY?: string;
  CAPABILITY_SIGNING_KID?: string;
};

type TurnCapabilityInputBase = {
  ownerId: string;
  ownerGeneration: string;
  turnId: string;
  conversationId: string;
  audience: ManagedModelAudience;
  budgetMicroCents: number;
  agentTypes: readonly string[];
  aud?: CapabilityAudience;
  now?: number;
};

export type TurnCapabilityInput = TurnCapabilityInputBase & {
  execution: Exclude<CloudExecutionSelection, { engine: "anthropic" }>;
  credential?: GatewayNativeCredentialProvider;
};

export type MintedTurnCapability = {
  token: string;
  claims: GatewayCapabilityClaims;
  expiresAt: number;
};

const KID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

let cachedKey:
  | { pem: string; kid: string; key: Promise<CapabilitySigningKey> }
  | undefined;

export const capabilitySigningKey = (
  env: CapabilitySignerEnv,
): Promise<CapabilitySigningKey> => {
  const pem = env.CAPABILITY_SIGNING_KEY?.trim() ?? "";
  const kid = env.CAPABILITY_SIGNING_KID?.trim() ?? "";
  if (!pem || !kid || !KID_PATTERN.test(kid)) {
    return Promise.reject(
      new Error(
        "Capability signing is not configured (CAPABILITY_SIGNING_KEY / CAPABILITY_SIGNING_KID).",
      ),
    );
  }
  if (cachedKey && cachedKey.pem === pem && cachedKey.kid === kid) {
    return cachedKey.key;
  }
  const key = importCapabilitySigningKey(pem, kid).catch((error: unknown) => {
    if (cachedKey?.key === key) cachedKey = undefined;
    throw error;
  });
  cachedKey = { pem, kid, key };
  return key;
};

const nativeCredentialFor = (
  execution: CloudExecutionSelection,
): GatewayNativeCredentialProvider | undefined =>
  execution.engine === "chatgpt" ? execution.engine : undefined;

export const mintTurnCapability = async (
  env: CapabilitySignerEnv,
  input: TurnCapabilityInput,
): Promise<MintedTurnCapability> => {
  for (const [field, value] of [
    ["ownerId", input.ownerId],
    ["ownerGeneration", input.ownerGeneration],
    ["turnId", input.turnId],
    ["conversationId", input.conversationId],
  ] as const) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`Turn capability requires ${field}.`);
    }
  }
  if (!isManagedModelAudience(input.audience)) {
    throw new Error("Turn capability requires a managed model audience.");
  }
  if (!Number.isFinite(input.budgetMicroCents)) {
    throw new Error("Turn capability requires a finite budget.");
  }
  if (
    input.agentTypes.length === 0 ||
    input.agentTypes.some(
      (agentType) =>
        typeof agentType !== "string" || agentType.trim().length === 0,
    )
  ) {
    throw new Error("Turn capability requires at least one agent type.");
  }
  const execution = input.execution as CloudExecutionSelection;
  if (execution?.engine === "anthropic") {
    throw new Error("Claude turns never carry a gateway capability.");
  }
  if (
    !execution ||
    (execution.engine !== "provider" && execution.engine !== execution.provider) ||
    typeof execution.model !== "string" ||
    execution.model.trim().length === 0 ||
    typeof execution.reasoningEffort !== "string"
  ) {
    throw new Error("Turn capability requires the admitted execution.");
  }
  const credential = input.credential ?? nativeCredentialFor(execution);
  if (credential !== undefined && credential !== execution.engine) {
    throw new Error(
      "Turn capability credential must match the admitted engine.",
    );
  }
  const signingKey = await capabilitySigningKey(env);
  const signed = await signCapability(
    {
      iss: GATEWAY_CAPABILITY_ISSUERS.cloudBuilder,
      aud: input.aud ?? GATEWAY_CAPABILITY_AUDIENCE,
      sub: input.ownerId,
      gen: input.ownerGeneration,
      kind: "turn",
      ledgerScope: "owner-relay-v2",
      audience: input.audience,
      agentTypes: [...input.agentTypes],
      budgetMicroCents: input.budgetMicroCents,
      turn: {
        turnId: input.turnId,
        conversationId: input.conversationId,
        execution: {
          engine: execution.engine,
          provider: execution.provider,
          model: execution.model,
          reasoningEffort: execution.reasoningEffort,
        } as CloudExecutionSelection,
      },
      ...(credential ? { credential } : {}),
    },
    signingKey,
    {
      ttlMs: GATEWAY_TURN_CAPABILITY_TTL_MS,
      ...(input.now !== undefined ? { now: input.now } : {}),
    },
  );
  return {
    token: signed.token,
    claims: signed.claims,
    expiresAt: signed.claims.exp * 1000,
  };
};
