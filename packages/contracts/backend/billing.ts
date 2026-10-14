import type { IdentityLevel } from "../gateway/api.js";

export type BillingPlan = "free" | "go" | "pro";
export type PaidBillingPlan = Exclude<BillingPlan, "free">;

export type CloudSandboxAccess = {
  enabled: boolean;
};

export const CLOUD_SANDBOX_SUBSCRIPTION_REQUIRED_MESSAGE =
  "Running in the cloud needs a Stella subscription.";

export type BillingPlanConfig = {
  label: string;
  monthlyPriceCents: number;
  introFirstMonthPriceCents?: number;
  rollingLimitUsd: number;
  rollingWindowHours: number;
  weeklyLimitUsd: number;
  monthlyLimitUsd: number;
  lifetimeLimitUsd?: number;
  cloudSandbox: CloudSandboxAccess;
};

export type BillingUsage = {
  rollingUsedUsd: number;
  rollingLimitUsd: number;
  weeklyUsedUsd: number;
  weeklyLimitUsd: number;
  monthlyUsedUsd: number;
  monthlyLimitUsd: number;
  lifetimeUsedUsd: number;
  lifetimeLimitUsd: number | null;
};

export type BillingStatus = {
  authenticated: boolean;
  isAnonymous: boolean;
  identityLevel: IdentityLevel;
  plan: BillingPlan;
  subscriptionStatus: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: number | null;
  usage: BillingUsage | null;
  usagePolicy:
    | {
        kind: "anonymous_requests";
        requestLimit: number;
        perIpRequestLimit: number;
        resetAfterInactivityDays: number;
      }
    | { kind: "managed_cost" };
  plans: Record<BillingPlan, BillingPlanConfig>;
  credits: {
    currency: string;
    balanceUsd: number;
    totalPurchasedUsd: number;
    totalConsumedUsd: number;
  };
  creditPurchase: {
    currency: string;
    minAmountCents: number;
    maxAmountCents: number;
    presetAmountCents: number[];
  };
};

export type BillingCalls = {
  "billing.checkout": {
    args: {
      plan: PaidBillingPlan;
      returnUrl: string;
      source?: string;
      appStoreCountry?: string;
    };
    result: { url: string; sessionId: string };
  };
  "billing.creditCheckout": {
    args: { amountCents: number; returnUrl: string };
    result: { url: string; sessionId: string };
  };
  "billing.portal": {
    args: { returnUrl: string };
    result: { url: string };
  };
};

export type BillingViews = {
  "billing.status": { args: Record<string, never>; result: BillingStatus };
};
