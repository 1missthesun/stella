import {
  BUDGET_COVERS,
  INCLUDED_IN_EVERY_PLAN,
  PAID_BILLING_PLANS,
  PLAN_CATALOG,
  PLAN_ORDER,
  formatPlanPrice,
  isPaidBillingPlan,
  nextPlanUp,
  normalizeBillingPlan,
  planLabel,
  planRank,
  type BillingPlan,
  type PaidBillingPlan,
  type PlanDefinition,
} from "@stella/contracts/billing-plans";

export {
  BUDGET_COVERS,
  INCLUDED_IN_EVERY_PLAN,
  PAID_BILLING_PLANS,
  PLAN_CATALOG,
  PLAN_ORDER,
  formatPlanPrice,
  isPaidBillingPlan,
  nextPlanUp,
  normalizeBillingPlan,
  planLabel,
  planRank,
  type BillingPlan,
  type PaidBillingPlan,
  type PlanDefinition,
};

export const FEATURED_PLAN: BillingPlan = "pro";

export const formatUsd = (usd: number): string =>
  Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2)}`;

// "$20/mo" or "$0".
export const planPriceLabel = (plan: BillingPlan): string => {
  const def = PLAN_CATALOG[plan];
  return def.interval ? `${formatPlanPrice(def.monthlyPriceCents)}/mo` : formatPlanPrice(0);
};

// One line for summaries: "Plus — $20/mo, more usage".
export const planSummary = (plan: BillingPlan): string => {
  const def = PLAN_CATALOG[plan];
  return `${def.label} — ${def.interval ? planPriceLabel(plan) : "$0"}, ${def.tagline.toLowerCase()}`;
};

export const cheapestMediaPlan = (): PaidBillingPlan =>
  PAID_BILLING_PLANS.find((plan) => PLAN_CATALOG[plan].mediaGeneration) ?? "plus";
