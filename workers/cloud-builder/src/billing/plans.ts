import type {
  BillingPlan,
  BillingPlanConfig,
  CloudSandboxAccess,
  PaidBillingPlan,
} from "@stella/contracts/backend/billing";
import {
  BILLING_PLANS,
  PAID_BILLING_PLANS,
  PLAN_CATALOG,
  type PlanDefinition,
} from "@stella/contracts/billing-plans";
import { stripeRequest, StripeError } from "./stripe.js";

export type PlanCatalog = Record<BillingPlan, BillingPlanConfig>;

export type BillingConfig = {
  enabled: boolean;
  plans: PlanCatalog;
  freeEmailAllowanceShare: number;
  stripePrices: Record<PaidBillingPlan, string>;
};

export class BillingConfigError extends Error {}

type EnvReader = (name: string) => string | undefined;

const reader = (env: Cloudflare.Env): EnvReader => {
  const values = env as unknown as Record<string, unknown>;
  return (name) => {
    const value = values[name];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };
};

const cloudSandboxPlans = (read: EnvReader): ReadonlySet<BillingPlan> => {
  const raw = read("STELLA_CLOUD_SANDBOX_PLANS");
  if (raw === undefined) {
    return new Set(BILLING_PLANS.filter((plan) => PLAN_CATALOG[plan].cloudContainers));
  }
  const plans = new Set<BillingPlan>();
  for (const entry of raw.split(",")) {
    const name = entry.trim().toLowerCase();
    if (!name) continue;
    if (!(BILLING_PLANS as readonly string[]).includes(name)) {
      console.warn(
        JSON.stringify({ event: "billing_config_unknown_cloud_sandbox_plan", plan: name, known: BILLING_PLANS }),
      );
      continue;
    }
    plans.add(name as BillingPlan);
  }
  return plans;
};

const planConfig = (
  definition: PlanDefinition,
  sandboxPlans: ReadonlySet<BillingPlan>,
): BillingPlanConfig => ({
  label: definition.label,
  monthlyPriceCents: definition.monthlyPriceCents,
  rollingLimitUsd: definition.budget.rollingUsd,
  rollingWindowHours: definition.budget.rollingWindowHours,
  weeklyLimitUsd: definition.budget.weeklyUsd,
  monthlyLimitUsd: definition.budget.monthlyUsd,
  ...(definition.budget.oneTimeUsd !== undefined ? { lifetimeLimitUsd: definition.budget.oneTimeUsd } : {}),
  cloudSandbox: { enabled: sandboxPlans.has(definition.id) } satisfies CloudSandboxAccess,
  mediaGeneration: definition.mediaGeneration,
  includes: definition.includes,
});

const STRIPE_PRICE_SECRETS: Record<PaidBillingPlan, string> = {
  plus: "STRIPE_PRICE_PLUS",
  pro: "STRIPE_PRICE_PRO",
  max: "STRIPE_PRICE_MAX",
};

const BILLING_SWITCHES = ["STRIPE_SECRET_KEY", ...Object.values(STRIPE_PRICE_SECRETS)] as const;

const OPEN_LIMIT_USD = 1_000_000;
const openPlan = (definition: PlanDefinition): BillingPlanConfig => ({
  ...planConfig(definition, new Set(BILLING_PLANS)),
  rollingLimitUsd: OPEN_LIMIT_USD,
  weeklyLimitUsd: OPEN_LIMIT_USD,
  monthlyLimitUsd: OPEN_LIMIT_USD,
  cloudSandbox: { enabled: true },
  mediaGeneration: true,
});

const openPlans = (): PlanCatalog => {
  const plans = {} as PlanCatalog;
  for (const plan of BILLING_PLANS) {
    const { lifetimeLimitUsd: _lifetime, ...open } = openPlan(PLAN_CATALOG[plan]);
    plans[plan] = open;
  }
  return plans;
};

const OPEN_BILLING_CONFIG: BillingConfig = {
  enabled: false,
  plans: openPlans(),
  freeEmailAllowanceShare: 1,
  stripePrices: { plus: "", pro: "", max: "" },
};

const loadBillingConfig = (env: Cloudflare.Env): BillingConfig => {
  const read = reader(env);
  if (read("STELLA_OWNER_MODE") === "1" || BILLING_SWITCHES.every((name) => read(name) === undefined)) {
    return OPEN_BILLING_CONFIG;
  }
  const missing = BILLING_SWITCHES.filter((name) => read(name) === undefined);
  if (missing.length > 0) {
    throw new BillingConfigError(`Missing billing secret ${missing.join(", ")}.`);
  }
  const sandboxPlans = cloudSandboxPlans(read);
  const plans = {} as PlanCatalog;
  for (const plan of BILLING_PLANS) plans[plan] = planConfig(PLAN_CATALOG[plan], sandboxPlans);
  const stripePrices = {} as Record<PaidBillingPlan, string>;
  for (const plan of PAID_BILLING_PLANS) stripePrices[plan] = read(STRIPE_PRICE_SECRETS[plan])!;
  return {
    enabled: true,
    plans,
    freeEmailAllowanceShare: PLAN_CATALOG.free.emailOnlyBudgetShare ?? 1,
    stripePrices,
  };
};

let cached: { env: Cloudflare.Env; config: BillingConfig } | undefined;

export const billingConfig = (env: Cloudflare.Env): BillingConfig => {
  if (cached?.env === env) return cached.config;
  const config = loadBillingConfig(env);
  cached = { env, config };
  return config;
};

export const planForStripePrice = (
  config: BillingConfig,
  priceId: string | null | undefined,
): PaidBillingPlan | null => {
  if (!priceId || !config.enabled) return null;
  for (const plan of PAID_BILLING_PLANS) {
    if (config.stripePrices[plan] === priceId) return plan;
  }
  return null;
};

type StripePrice = {
  id: string;
  active: boolean;
  currency: string;
  unit_amount: number | null;
  type: string;
  recurring?: { interval?: string; interval_count?: number; usage_type?: string } | null;
};

export class StripePriceMismatchError extends Error {}

const PRICE_CHECK_TTL_MS = 10 * 60_000;
const verifiedPrices = new Map<string, number>();

// A configured price must be exactly the catalog's amount, in USD, billed
// monthly. Anything else would charge a customer a different amount than
// every display and allowance in Stella promises.
export const priceMismatch = (plan: PaidBillingPlan, price: StripePrice): string | null => {
  const definition = PLAN_CATALOG[plan];
  if (!price.active) return `${price.id} is archived`;
  if (price.type !== "recurring") return `${price.id} is not recurring`;
  if (price.currency.toLowerCase() !== definition.currency) return `${price.id} is in ${price.currency}`;
  if (price.unit_amount !== definition.monthlyPriceCents) {
    return `${price.id} is ${price.unit_amount} cents, ${definition.label} is ${definition.monthlyPriceCents}`;
  }
  if (price.recurring?.interval !== definition.interval || (price.recurring?.interval_count ?? 1) !== 1) {
    return `${price.id} bills every ${price.recurring?.interval_count ?? 1} ${price.recurring?.interval}`;
  }
  if (price.recurring?.usage_type && price.recurring.usage_type !== "licensed") {
    return `${price.id} is metered`;
  }
  return null;
};

export const verifyStripePrice = async (
  env: Cloudflare.Env,
  config: BillingConfig,
  plan: PaidBillingPlan,
): Promise<string> => {
  const priceId = config.stripePrices[plan];
  const checked = verifiedPrices.get(priceId);
  if (checked !== undefined && Date.now() - checked < PRICE_CHECK_TTL_MS) return priceId;
  let price: StripePrice;
  try {
    price = await stripeRequest<StripePrice>(env, "GET", `/prices/${encodeURIComponent(priceId)}`);
  } catch (error) {
    if (error instanceof StripeError && error.status === 404) {
      throw new StripePriceMismatchError(`STRIPE_PRICE_${plan.toUpperCase()} ${priceId} does not exist`);
    }
    throw error;
  }
  const mismatch = priceMismatch(plan, price);
  if (mismatch) {
    console.error(JSON.stringify({ event: "billing_stripe_price_mismatch", plan, priceId, mismatch }));
    throw new StripePriceMismatchError(mismatch);
  }
  verifiedPrices.set(priceId, Date.now());
  return priceId;
};
