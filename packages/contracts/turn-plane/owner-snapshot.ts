import type { BillingPlan } from "../billing-plans.js";
import type { CloudExecutionSelection } from "../agent-engine.js";
import type { ManagedModelAudience } from "../gateway/capability.js";
import type { OwnerEnforcement } from "../gateway/usage.js";
import type { IdentityLevel } from "../gateway/api.js";
import type { CloudSandboxAccess } from "../backend/billing.js";
import type { ExecutionCapability } from "./placement.js";
import type { StellaUsageLimit } from "../stella-usage-limit.js";
import type { PairingHmacKey } from "./pairing-proof.js";

export const OWNER_SNAPSHOT_VERSION = 1 as const;

export type CloudPlanId = BillingPlan;

export type OwnerSnapshot = {
  v: typeof OWNER_SNAPSHOT_VERSION;
  ownerId: string;
  ownerGeneration: string;
  writable: boolean;
  isAnonymous: boolean;
  identityLevel: IdentityLevel;
  enforcement?: OwnerEnforcement;
  plan: CloudPlanId;
  cloudSandbox?: CloudSandboxAccess;
  allowance: {
    audience: ManagedModelAudience;
    budgetMicroCents: number;
    maxRequests?: number;
  };
  usageLimit?: StellaUsageLimit;
  billingUnavailable?: true;
  execution: CloudExecutionSelection;
  timeZone?: string;
  pairedDevices?: Array<{
    mobileDeviceId: string;
    desktopDeviceId: string;
    pairingKey?: PairingHmacKey;
  }>;
  devices?: Array<{
    deviceId: string;
    publicKey: string;
    remoteExecutionEnabled: boolean;
    remoteExecution:
      | "unconfigured"
      | "asking"
      | "enabled"
      | "declined";
    remoteExecutionAskedAt?: number;
    brainHome?: true;
    label?: string;
    capabilities?: ExecutionCapability[];
  }>;
  connectedEngines?: Array<"anthropic" | "chatgpt">;
  cloudClaudeLoginEnded?: true;
  connectedProviders?: string[];
  fetchedAt: number;
  ttlMs: number;
};
