export { toCapabilityAudience } from "@stella/contracts/capabilities";

export type SubscriptionPlan = "free" | "go" | "pro";

export type ManagedModelAudience =
  | "free"
  | "go"
  | "pro"
  | "go_fallback"
  | "pro_fallback";

const RESTRICTED_MODEL_OVERRIDE_AUDIENCES = new Set<ManagedModelAudience>([
  "free",
  "go",
  "go_fallback",
]);

export const isRestrictedModelOverrideAudience = (
  audience: ManagedModelAudience | null | undefined,
): boolean =>
  audience !== null &&
  audience !== undefined &&
  RESTRICTED_MODEL_OVERRIDE_AUDIENCES.has(audience);

const PLAN_LABELS: Record<ManagedModelAudience, string> = {
  free: "Free",
  go: "Go",
  pro: "Pro",
  go_fallback: "Go",
  pro_fallback: "Pro",
};

export const getPlanLabel = (audience: ManagedModelAudience): string =>
  PLAN_LABELS[audience];

export const getRestrictionActionKind = (
  _audience: ManagedModelAudience,
): "sign-in" | "upgrade" => "upgrade";

export const getModelRestrictionActionLabel = (
  audience: ManagedModelAudience,
): string =>
  getRestrictionActionKind(audience) === "sign-in" ? "Sign in" : "Upgrade";

export const getModelRestrictionDescription = (args: {
  audience: ManagedModelAudience;
  modelLabel: string;
  tense: "will" | "is";
}): string => {
  const recommendedPhrase =
    args.tense === "will"
      ? "Stella will use its recommended model."
      : "Stella is using its recommended model.";

  return `${args.modelLabel} isn't available on the ${getPlanLabel(args.audience)} plan. ${recommendedPhrase} Upgrade to switch models.`;
};

type BillingUsage = {
  rollingUsedUsd: number;
  rollingLimitUsd: number;
  weeklyUsedUsd: number;
  weeklyLimitUsd: number;
  monthlyUsedUsd: number;
  monthlyLimitUsd: number;
  lifetimeUsedUsd?: number;
  lifetimeLimitUsd?: number | null;
};

type ResolvableBillingStatus = {
  plan: SubscriptionPlan;
  usage: BillingUsage | null;
  authenticated?: boolean;
};

const isUsageExceeded = (usage: BillingUsage | null): boolean =>
  usage !== null &&
  (usage.rollingUsedUsd >= usage.rollingLimitUsd ||
  usage.weeklyUsedUsd >= usage.weeklyLimitUsd ||
  usage.monthlyUsedUsd >= usage.monthlyLimitUsd);

export const resolveBillingAudience = (args: {
  hasConnectedAccount: boolean;
  billingStatus: ResolvableBillingStatus | undefined;
}): ManagedModelAudience | null => {
  if (!args.hasConnectedAccount) {
    return null;
  }
  if (!args.billingStatus) {
    return null;
  }
  if (args.billingStatus.authenticated === false) {
    return null;
  }
  const { plan, usage } = args.billingStatus;
  if (plan === "free") {
    return "free";
  }
  return isUsageExceeded(usage)
    ? (`${plan}_fallback` as ManagedModelAudience)
    : plan;
};

export type FreeAllowance = {
  usedUsd: number;
  limitUsd: number;
  remainingUsd: number;
  exhausted: boolean;
};

export const resolveFreeAllowance = (
  billingStatus: ResolvableBillingStatus | null | undefined,
): FreeAllowance | null => {
  if (!billingStatus || billingStatus.plan !== "free") return null;
  const usage = billingStatus.usage;
  const limitUsd = usage?.lifetimeLimitUsd;
  if (typeof limitUsd !== "number" || !Number.isFinite(limitUsd)) return null;
  if (limitUsd <= 0) return null;
  const rawUsed = usage?.lifetimeUsedUsd;
  const usedUsd =
    typeof rawUsed === "number" && Number.isFinite(rawUsed) && rawUsed > 0
      ? rawUsed
      : 0;
  return {
    usedUsd,
    limitUsd,
    remainingUsd: Math.max(0, limitUsd - usedUsd),
    exhausted: usedUsd >= limitUsd,
  };
};
