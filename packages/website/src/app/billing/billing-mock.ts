import type { BillingPlanConfig, BillingStatus } from "@stella/contracts/backend/billing";
import { PLAN_CATALOG, PLAN_ORDER, type BillingPlan } from "@/lib/plans";

// Development-only fixtures for /billing?mock=…, so the page can be designed
// and screenshotted without a backend account on each plan.
export const BILLING_MOCK_MODES = ["free", "free-spent", "plus", "pro", "pro-limit", "max-cancel", "signed-out"] as const;
export type BillingMockMode = (typeof BILLING_MOCK_MODES)[number];

export function readBillingMockMode(): BillingMockMode | null {
  if (process.env.NODE_ENV !== "development" || typeof window === "undefined") return null;
  const mode = new URL(window.location.href).searchParams.get("mock");
  return (BILLING_MOCK_MODES as readonly (string | null)[]).includes(mode) ? (mode as BillingMockMode) : null;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const planConfig = (plan: BillingPlan): BillingPlanConfig => {
  const def = PLAN_CATALOG[plan];
  return {
    label: def.label,
    monthlyPriceCents: def.monthlyPriceCents,
    rollingLimitUsd: def.budget.rollingUsd,
    rollingWindowHours: def.budget.rollingWindowHours,
    weeklyLimitUsd: def.budget.weeklyUsd,
    monthlyLimitUsd: def.budget.monthlyUsd,
    ...(def.budget.oneTimeUsd ? { lifetimeLimitUsd: def.budget.oneTimeUsd } : {}),
    cloudSandbox: { enabled: def.cloudContainers },
    mediaGeneration: def.mediaGeneration,
    includes: def.includes,
  };
};

export function billingMockStatus(mode: BillingMockMode): BillingStatus | null {
  if (mode === "signed-out") return null;
  const now = Date.now();
  const plan: BillingPlan = mode.startsWith("free") ? "free" : mode.startsWith("plus") ? "plus" : mode.startsWith("pro") ? "pro" : "max";
  const def = PLAN_CATALOG[plan];
  const b = def.budget;
  const share =
    mode === "free" ? 0.36 : mode === "free-spent" ? 1 : mode === "plus" ? 0.42 : mode === "pro" ? 0.46 : mode === "pro-limit" ? 0.71 : 0.18;
  const rolling = mode === "pro-limit" ? b.rollingUsd : Math.min(b.rollingUsd, b.monthlyUsd * share * 0.22);
  const weekly = Math.min(b.weeklyUsd, b.monthlyUsd * share * 0.55);
  const monthly = b.monthlyUsd * share;
  const reserved = mode === "pro" ? 0.85 : mode === "plus" ? 0.3 : 0;
  const credit = mode === "pro" || mode === "pro-limit" ? 10 : mode === "max-cancel" ? 4.5 : 0;
  const lifetime = plan === "free" ? (b.oneTimeUsd ?? 0) * share : monthly;
  const headroom =
    plan === "free"
      ? (b.oneTimeUsd ?? 0) - lifetime
      : Math.min(b.rollingUsd - rolling, b.weeklyUsd - weekly, b.monthlyUsd - monthly);
  return {
    authenticated: true,
    isAnonymous: false,
    identityLevel: 3,
    plan,
    subscriptionStatus: plan === "free" ? "none" : "active",
    cancelAtPeriodEnd: mode === "max-cancel",
    currentPeriodEnd: plan === "free" ? null : now + 19 * DAY,
    usage: {
      rollingUsedUsd: plan === "free" ? lifetime : rolling,
      rollingLimitUsd: b.rollingUsd,
      weeklyUsedUsd: plan === "free" ? lifetime : weekly,
      weeklyLimitUsd: b.weeklyUsd,
      monthlyUsedUsd: plan === "free" ? lifetime : monthly,
      monthlyLimitUsd: b.monthlyUsd,
      lifetimeUsedUsd: lifetime,
      lifetimeLimitUsd: b.oneTimeUsd ?? null,
      rollingResetsAt: now + (mode === "pro-limit" ? 1.2 : 3.4) * HOUR,
      weeklyResetsAt: now + 4 * DAY,
      monthlyResetsAt: now + 19 * DAY,
      reservedUsd: reserved,
      availableUsd: Math.max(0, headroom + credit - reserved),
    },
    usagePolicy: { kind: "managed_cost" },
    plans: Object.fromEntries(PLAN_ORDER.map((id) => [id, planConfig(id)])) as BillingStatus["plans"],
    credits: { currency: "usd", balanceUsd: credit, totalPurchasedUsd: credit, totalConsumedUsd: 0 },
    creditPurchase: { currency: "usd", minAmountCents: 500, maxAmountCents: 50_000, presetAmountCents: [1_000, 2_500, 5_000] },
  };
}
