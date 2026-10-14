import type { CloudExecutionSelection } from "../agent-engine.js";
import type { ManagedModelAudience } from "../gateway/capability.js";
import type { OwnerEnforcement } from "../gateway/usage.js";
import type { IdentityLevel } from "../gateway/api.js";
import type { CloudSandboxAccess } from "../backend/billing.js";
import type { ExecutionCapability } from "./placement.js";
import type { StellaUsageLimit } from "../stella-usage-limit.js";

export const OWNER_SNAPSHOT_VERSION = 1 as const;

export type CloudPlanId = "free" | "go" | "pro";

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
  /**
   * Paired mobile devices allowed to submit against this owner's desktops
   * (Stage 3 placement). `mobilePublicKey` is the phone's pairing key so the
   * worker can verify its proof headers without another round trip: the
   * pairing proof is an HMAC-SHA256, and this value is its key —
   * `sha256hex(pairSecret)`, the same `pairSecretHash` the devices domain
   * stores on the grant. Only active (non-revoked) grants appear.
   */
  pairedDevices?: Array<{
    mobileDeviceId: string;
    desktopDeviceId: string;
    mobilePublicKey?: string;
  }>;
  /**
   * The owner's execution devices (desktops) for placement: their device
   * public key (verifies the presence socket proof), whether remote execution
   * is enabled, and the capabilities they last advertised.
   *
   * Appearing here is only "this computer is signed in". `remoteExecution` is
   * the separate fact of whether it agreed to run work sent from elsewhere;
   * `remoteExecutionEnabled` is that state being `"enabled"`.
   */
  devices?: Array<{
    deviceId: string;
    publicKey: string;
    remoteExecutionEnabled: boolean;
    remoteExecution?:
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
  connectedProviders?: string[];
  fetchedAt: number;
  ttlMs: number;
};
