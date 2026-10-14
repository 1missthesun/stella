import type {
  BillingCalls,
  BillingPlan,
  BillingStatus,
  CloudSandboxAccess,
} from "@stella/contracts/backend/billing";
import {
  GATEWAY_SESSION_BUDGET_CHUNK_MICRO_CENTS,
  limitsAudienceFor,
  type IdentityLevel,
} from "@stella/contracts/gateway/api";
import {
  GATEWAY_BUDGET_UNLIMITED,
  type ManagedModelAudience,
} from "@stella/contracts/gateway/capability";
import type { GatewayUsageEvent } from "@stella/contracts/gateway/usage";
import {
  STELLA_USAGE_LIMIT_MESSAGES,
  type StellaUsageLimit,
} from "@stella/contracts/stella-usage-limit";
import { normalizeBillingPlan, PLAN_CATALOG } from "@stella/contracts/billing-plans";
import {
  FIXED_INFRA_TARIFF,
  TARIFF_VERSION,
  usdToMicroCents,
  type CostEntry,
} from "@stella/contracts/billing-tariffs";
import {
  BillingConfigError,
  billingConfig,
  planForStripePrice,
  priceMismatch,
  StripePriceMismatchError,
  verifyStripePrice,
  type BillingConfig,
} from "../../billing/plans.js";
import { stripeRequest, StripeError, type StripeEvent } from "../../billing/stripe.js";
import { empty, literal, number, object, optional, string } from "../args.js";
import { RpcError } from "../errors.js";
import { enforceOwnerRateLimit } from "../rate-limit.js";
import type { OwnerContext, OwnerDb, OwnerDbReader, OwnerDomain } from "../registry.js";

const MICRO_CENTS_PER_USD = 100_000_000;
const LIFETIME_RETRY_AFTER_MS = 24 * 60 * 60 * 1000;
const GRANT_SETTLEMENT_GRACE_MS = 10 * 60 * 1000;
const RECEIPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing", "past_due", "complimentary"]);
const CREDIT_CURRENCY = "usd";
const CREDIT_MIN_CENTS = 100;
const CREDIT_MAX_CENTS = 50_000;
const CREDIT_PRESET_CENTS = [500, 1_000, 2_500, 5_000];
const STRIPE_RATE_LIMIT = { count: 10, windowMs: 60_000 };
const COST_LEDGER_RETENTION_MS = 120 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const BILLING_MIGRATION = {
  id: "billing.1-ledger",
  statements: [
    `CREATE TABLE billing_account (
       id INTEGER PRIMARY KEY CHECK (id = 1),
       plan TEXT NOT NULL,
       usage_mode TEXT NOT NULL,
       subscription_status TEXT NOT NULL,
       stripe_customer_id TEXT,
       stripe_subscription_id TEXT,
       stripe_price_id TEXT,
       current_period_end INTEGER NOT NULL,
       cancel_at_period_end INTEGER NOT NULL,
       payment_method_brand TEXT,
       payment_method_last4 TEXT,
       monthly_anchor_at INTEGER NOT NULL,
       rolling_used INTEGER NOT NULL,
       rolling_started_at INTEGER NOT NULL,
       weekly_used INTEGER NOT NULL,
       weekly_started_at INTEGER NOT NULL,
       monthly_used INTEGER NOT NULL,
       monthly_started_at INTEGER NOT NULL,
       total_used INTEGER NOT NULL,
       total_requests INTEGER NOT NULL,
       credit_balance INTEGER NOT NULL,
       credit_purchased INTEGER NOT NULL,
       credit_consumed INTEGER NOT NULL,
       is_anonymous INTEGER NOT NULL,
       identity_level INTEGER NOT NULL,
       reported_plan TEXT,
       updated_at INTEGER NOT NULL
     )`,
    `CREATE TABLE billing_grants (
       jti TEXT PRIMARY KEY,
       budget INTEGER NOT NULL,
       settled INTEGER NOT NULL,
       expires_at INTEGER NOT NULL
     )`,
    `CREATE TABLE billing_receipts (
       id TEXT PRIMARY KEY,
       charged INTEGER NOT NULL,
       created_at INTEGER NOT NULL
     )`,
    "CREATE INDEX billing_receipts_created ON billing_receipts (created_at)",
    `CREATE TABLE billing_stripe_events (
       id TEXT PRIMARY KEY,
       created_at INTEGER NOT NULL
     )`,
    `CREATE TABLE billing_credit_purchases (
       checkout_session_id TEXT PRIMARY KEY,
       amount INTEGER NOT NULL,
       created_at INTEGER NOT NULL
     )`,
  ],
};

// Pricing v3: Go is now Plus. The per-attempt cost ledger records what Stella
// paid for each paid attempt, separate from what the budget was charged.
export const BILLING_COST_LEDGER_MIGRATION = {
  id: "billing.2-cost-ledger",
  statements: [
    "UPDATE billing_account SET plan = 'plus' WHERE plan = 'go'",
    `CREATE TABLE billing_cost_ledger (
       id TEXT PRIMARY KEY,
       at INTEGER NOT NULL,
       category TEXT NOT NULL,
       provider TEXT NOT NULL,
       sku TEXT,
       quantity_json TEXT,
       provider_cost INTEGER NOT NULL,
       basis TEXT NOT NULL,
       outcome TEXT NOT NULL,
       attempt INTEGER NOT NULL,
       request_id TEXT,
       charged INTEGER NOT NULL,
       tariff_version TEXT NOT NULL,
       plan TEXT NOT NULL,
       identity_level INTEGER NOT NULL
     )`,
    "CREATE INDEX billing_cost_ledger_at ON billing_cost_ledger (at)",
    `CREATE TABLE billing_cost_daily (
       day TEXT NOT NULL,
       category TEXT NOT NULL,
       provider TEXT NOT NULL,
       sku TEXT NOT NULL,
       basis TEXT NOT NULL,
       plan TEXT NOT NULL,
       tariff_version TEXT NOT NULL,
       attempts INTEGER NOT NULL,
       failures INTEGER NOT NULL,
       provider_cost INTEGER NOT NULL,
       charged INTEGER NOT NULL,
       updated_at INTEGER NOT NULL,
       exported_at INTEGER NOT NULL DEFAULT 0,
       PRIMARY KEY (day, category, provider, sku, basis, plan, tariff_version)
     )`,
    "ALTER TABLE billing_grants ADD COLUMN category TEXT",
  ],
};

type AccountRow = {
  plan: string;
  usage_mode: string;
  subscription_status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_price_id: string | null;
  current_period_end: number;
  cancel_at_period_end: number;
  payment_method_brand: string | null;
  payment_method_last4: string | null;
  monthly_anchor_at: number;
  rolling_used: number;
  rolling_started_at: number;
  weekly_used: number;
  weekly_started_at: number;
  monthly_used: number;
  monthly_started_at: number;
  total_used: number;
  total_requests: number;
  credit_balance: number;
  credit_purchased: number;
  credit_consumed: number;
  is_anonymous: number;
  identity_level: number;
  reported_plan: string | null;
  updated_at: number;
};

const weekBounds = (now: number) => {
  const date = new Date(now);
  const start = new Date(date);
  start.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  start.setUTCHours(0, 0, 0, 0);
  return { start: start.getTime(), end: start.getTime() + 7 * 24 * 60 * 60 * 1000 };
};

const monthBounds = (now: number, anchor: number) => {
  const a = new Date(anchor);
  const at = (year: number, month: number) => {
    const maxDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    return Date.UTC(
      year,
      month,
      Math.min(a.getUTCDate(), maxDay),
      a.getUTCHours(),
      a.getUTCMinutes(),
      a.getUTCSeconds(),
      a.getUTCMilliseconds(),
    );
  };
  const shift = (year: number, month: number, delta: number) => {
    const total = year * 12 + month + delta;
    return [Math.floor(total / 12), ((total % 12) + 12) % 12] as const;
  };
  const date = new Date(now);
  let [year, month] = [date.getUTCFullYear(), date.getUTCMonth()];
  let start = at(year, month);
  if (start > now) {
    [year, month] = shift(year, month, -1);
    start = at(year, month);
  }
  const [endYear, endMonth] = shift(year, month, 1);
  return { start, end: at(endYear, endMonth) };
};

const defaultAccount = (now: number): AccountRow => ({
  plan: "free",
  usage_mode: "default",
  subscription_status: "none",
  stripe_customer_id: null,
  stripe_subscription_id: null,
  stripe_price_id: null,
  current_period_end: 0,
  cancel_at_period_end: 0,
  payment_method_brand: null,
  payment_method_last4: null,
  monthly_anchor_at: now,
  rolling_used: 0,
  rolling_started_at: now,
  weekly_used: 0,
  weekly_started_at: weekBounds(now).start,
  monthly_used: 0,
  monthly_started_at: monthBounds(now, now).start,
  total_used: 0,
  total_requests: 0,
  credit_balance: 0,
  credit_purchased: 0,
  credit_consumed: 0,
  is_anonymous: 0,
  identity_level: 1,
  reported_plan: null,
  updated_at: now,
});

const readAccount = (db: OwnerDbReader, now: number): AccountRow =>
  db.one<AccountRow>("SELECT * FROM billing_account WHERE id = 1") ?? defaultAccount(now);

const ensureAccount = (db: OwnerDb, now: number): AccountRow => {
  const row = db.one<AccountRow>("SELECT * FROM billing_account WHERE id = 1");
  if (row) return row;
  const created = defaultAccount(now);
  const columns = Object.keys(created);
  db.run(
    `INSERT INTO billing_account (id, ${columns.join(", ")}) VALUES (1, ${columns.map(() => "?").join(", ")})`,
    ...columns.map((column) => created[column as keyof AccountRow]),
  );
  return created;
};

const updateAccount = (db: OwnerDb, fields: Partial<AccountRow>): void => {
  const entries = Object.entries(fields);
  if (entries.length === 0) return;
  db.run(
    `UPDATE billing_account SET ${entries.map(([column]) => `${column} = ?`).join(", ")} WHERE id = 1`,
    ...entries.map(([, value]) => value as number | string | null),
  );
};

const plan = (row: AccountRow): BillingPlan => normalizeBillingPlan(row.plan);

const isPaying = (row: AccountRow): boolean =>
  (plan(row) !== "free" && ACTIVE_SUBSCRIPTION_STATUSES.has(row.subscription_status)) ||
  row.credit_balance > 0;

const identityLevel = (row: AccountRow): IdentityLevel =>
  isPaying(row) ? 3 : (Math.min(2, Math.max(1, row.identity_level)) as IdentityLevel);

type Window = { used: number; limit: number; resetAt: number; exceeded: boolean };

type UsageSnapshot = {
  rolling: Window;
  weekly: Window;
  monthly: Window;
  lifetime: Window | null;
  normalized: Pick<
    AccountRow,
    "rolling_used" | "rolling_started_at" | "weekly_used" | "weekly_started_at" | "monthly_used" | "monthly_started_at"
  >;
};

const usageSnapshot = (config: BillingConfig, row: AccountRow, now: number): UsageSnapshot => {
  const current = plan(row);
  const planConfig = config.plans[current];
  const share = current === "free" && identityLevel(row) === 1 ? config.freeEmailAllowanceShare : 1;
  const limit = (usd: number) => Math.round(usd * share * MICRO_CENTS_PER_USD);

  const rollingMs = Math.max(1, Math.floor(planConfig.rollingWindowHours * 60 * 60 * 1000));
  const rollingActive = row.rolling_started_at > 0 && row.rolling_started_at >= now - rollingMs;
  const rollingStart = rollingActive ? row.rolling_started_at : now;
  const rollingUsed = rollingActive ? row.rolling_used : 0;

  const week = weekBounds(now);
  const weeklyActive = row.weekly_started_at >= week.start;
  const weeklyUsed = weeklyActive ? row.weekly_used : 0;

  const month = monthBounds(now, row.monthly_anchor_at > 0 ? row.monthly_anchor_at : now);
  const monthlyActive = row.monthly_started_at >= month.start;
  const monthlyUsed = monthlyActive ? row.monthly_used : 0;

  const window = (used: number, max: number, resetAt: number): Window => ({
    used,
    limit: max,
    resetAt,
    exceeded: used >= max,
  });
  return {
    rolling: window(rollingUsed, limit(planConfig.rollingLimitUsd), rollingStart + rollingMs),
    weekly: window(weeklyUsed, limit(planConfig.weeklyLimitUsd), week.end),
    monthly: window(monthlyUsed, limit(planConfig.monthlyLimitUsd), month.end),
    lifetime:
      planConfig.lifetimeLimitUsd === undefined
        ? null
        : window(row.total_used, limit(planConfig.lifetimeLimitUsd), now + LIFETIME_RETRY_AFTER_MS),
    normalized: {
      rolling_used: rollingUsed,
      rolling_started_at: rollingStart,
      weekly_used: weeklyUsed,
      weekly_started_at: weeklyActive ? row.weekly_started_at : week.start,
      monthly_used: monthlyUsed,
      monthly_started_at: monthlyActive ? row.monthly_started_at : month.start,
    },
  };
};

const includedHeadroom = (snapshot: UsageSnapshot): number =>
  Math.max(
    0,
    Math.min(
      snapshot.rolling.limit - snapshot.rolling.used,
      snapshot.weekly.limit - snapshot.weekly.used,
      snapshot.monthly.limit - snapshot.monthly.used,
      snapshot.lifetime ? snapshot.lifetime.limit - snapshot.lifetime.used : Number.POSITIVE_INFINITY,
    ),
  );

export type BillingAccess = {
  plan: BillingPlan;
  identityLevel: IdentityLevel;
  unlimited: boolean;
  allowed: boolean;
  downgraded: boolean;
  audience: ManagedModelAudience;
  retryAfterMs: number;
  message: string;
  remainingMicroCents: number | null;
  // Remaining minus what running work has reserved; null when unlimited.
  availableMicroCents: number | null;
  reservedMicroCents: number;
  usageLimit?: StellaUsageLimit;
};

const audienceFor = (current: BillingPlan): ManagedModelAudience => current;

const accessFor = (
  config: BillingConfig,
  row: AccountRow,
  now: number,
  reserved: number,
): BillingAccess => {
  const current = config.enabled ? plan(row) : "max";
  const unlimited = row.usage_mode === "unlimited" || !config.enabled;
  const snapshot = usageSnapshot(config, row, now);
  const credit = Math.max(0, row.credit_balance);
  const remaining = includedHeadroom(snapshot) + credit;
  const base = {
    plan: current,
    identityLevel: identityLevel(row),
    unlimited,
    remainingMicroCents: unlimited ? null : remaining,
    availableMicroCents: unlimited ? null : Math.max(0, remaining - reserved),
    reservedMicroCents: reserved,
  };
  const blocks = (window: Window) => Math.max(0, window.limit - window.used) + credit <= 0;
  const blocking = unlimited
    ? null
    : snapshot.lifetime && blocks(snapshot.lifetime)
      ? { window: snapshot.lifetime, lifetime: true }
      : [snapshot.rolling, snapshot.weekly, snapshot.monthly]
          .filter(blocks)
          .map((window) => ({ window, lifetime: false }))[0] ?? null;
  if (!blocking) {
    return {
      ...base,
      allowed: true,
      downgraded: false,
      audience: audienceFor(current),
      retryAfterMs: 0,
      message: "",
    };
  }
  const retryAfterMs = Math.max(1_000, blocking.window.resetAt - now);
  const label = config.plans[current].label;
  const message = current === "free"
    ? blocking.lifetime
      ? STELLA_USAGE_LIMIT_MESSAGES.free_allowance
      : "Free plan usage limit reached. Upgrade to keep going, or wait until it resets."
    : `You've used this period's ${label} budget. Add credit or upgrade to keep going, or wait until it resets.`;
  return {
    ...base,
    allowed: false,
    downgraded: false,
    audience: audienceFor(current),
    retryAfterMs,
    message,
    usageLimit: blocking.lifetime
      ? { reason: "free_allowance", message }
      : { reason: "plan_limit", message, retryAfterMs },
  };
};

const reservedGrants = (db: OwnerDbReader, now: number): number =>
  db.one<{ reserved: number | null }>(
    "SELECT SUM(MAX(0, budget - settled)) AS reserved FROM billing_grants WHERE expires_at + ? >= ?",
    GRANT_SETTLEMENT_GRACE_MS,
    now,
  )?.reserved ?? 0;

const capabilityBudget = (access: BillingAccess, reserved: number): number => {
  if (access.remainingMicroCents === null) return GATEWAY_BUDGET_UNLIMITED;
  const chunk = GATEWAY_SESSION_BUDGET_CHUNK_MICRO_CENTS[limitsAudienceFor(access.audience)];
  return Math.min(Math.max(0, Math.floor(access.remainingMicroCents - reserved)), chunk);
};

export const recordBillingIdentity = (
  ctx: OwnerContext,
  identity: { identityLevel?: IdentityLevel },
): void => {
  const row = ensureAccount(ctx.db, ctx.now);
  const level = identity.identityLevel ?? row.identity_level;
  if (row.is_anonymous === 0 && row.identity_level === level) return;
  updateAccount(ctx.db, { is_anonymous: 0, identity_level: level });
};

export const billingPaying = (ctx: { db: OwnerDbReader; now: number }): boolean =>
  isPaying(readAccount(ctx.db, ctx.now));

const billingOff = (env: Cloudflare.Env): boolean => {
  try {
    return !billingConfig(env).enabled;
  } catch {
    return false;
  }
};

export const billingPlan = (ctx: {
  db: OwnerDbReader;
  env: Cloudflare.Env;
  now: number;
}): { plan: BillingPlan; unlimited: boolean } => {
  if (billingOff(ctx.env)) return { plan: "max", unlimited: true };
  const row = readAccount(ctx.db, ctx.now);
  return { plan: plan(row), unlimited: row.usage_mode === "unlimited" };
};

export const billingAccess = (ctx: { db: OwnerDbReader; env: Cloudflare.Env; now: number }): BillingAccess =>
  accessFor(billingConfig(ctx.env), readAccount(ctx.db, ctx.now), ctx.now, reservedGrants(ctx.db, ctx.now));

const subscribedPlan = (row: AccountRow): BillingPlan =>
  plan(row) !== "free" && ACTIVE_SUBSCRIPTION_STATUSES.has(row.subscription_status) ? plan(row) : "free";

export const cloudSandboxAccess = (ctx: {
  db: OwnerDbReader;
  env: Cloudflare.Env;
  now: number;
}): CloudSandboxAccess => {
  let config: BillingConfig;
  try {
    config = billingConfig(ctx.env);
  } catch (error) {
    if (error instanceof BillingConfigError) return { enabled: false };
    throw error;
  }
  if (!config.enabled) return config.plans.max.cloudSandbox;
  const row = readAccount(ctx.db, ctx.now);
  return config.plans[subscribedPlan(row)].cloudSandbox;
};

export const turnAllowance = (ctx: { db: OwnerDbReader; env: Cloudflare.Env; now: number }) => {
  const access = billingAccess(ctx);
  return {
    plan: access.plan,
    identityLevel: access.identityLevel,
    ...(access.usageLimit ? { usageLimit: access.usageLimit } : {}),
    allowance: {
      audience: access.audience,
      budgetMicroCents: capabilityBudget(access, reservedGrants(ctx.db, ctx.now)),
    },
  };
};

export const reserveSessionGrant = (
  ctx: OwnerContext,
  input: { jti: string; expiresAt: number },
): BillingAccess & { budgetMicroCents: number } => {
  ctx.db.run(
    "DELETE FROM billing_grants WHERE expires_at + ? < ?",
    GRANT_SETTLEMENT_GRACE_MS,
    ctx.now,
  );
  const access = billingAccess(ctx);
  const budgetMicroCents = capabilityBudget(access, reservedGrants(ctx.db, ctx.now));
  if (budgetMicroCents !== GATEWAY_BUDGET_UNLIMITED) {
    ctx.db.run(
      "INSERT INTO billing_grants (jti, budget, settled, expires_at) VALUES (?, ?, 0, ?)",
      input.jti,
      budgetMicroCents,
      input.expiresAt,
    );
  }
  return { ...access, budgetMicroCents };
};

export type SpendReservation = BillingAccess & {
  reserved: boolean;
  reservedMicroCents: number;
};

const pruneGrants = (ctx: OwnerContext): void => {
  ctx.db.run("DELETE FROM billing_grants WHERE expires_at + ? < ?", GRANT_SETTLEMENT_GRACE_MS, ctx.now);
};

// Atomically hold `microCents` of the owner's budget for work about to run.
// Every paid operation reserves first so concurrent jobs cannot spend the same
// headroom twice: available = tightest window + credit - reserved.
// With `minimumMicroCents`, a smaller hold (down to that floor) is accepted.
export const reserveSpend = (
  ctx: OwnerContext,
  input: {
    id: string;
    microCents: number;
    expiresAt: number;
    category?: string;
    minimumMicroCents?: number;
  },
): SpendReservation => {
  pruneGrants(ctx);
  const access = billingAccess(ctx);
  const wanted = Math.max(0, Math.ceil(input.microCents));
  if (!access.allowed) return { ...access, reserved: false, reservedMicroCents: 0 };
  if (access.availableMicroCents === null) return { ...access, reserved: true, reservedMicroCents: wanted };
  const existing = ctx.db.one<{ budget: number; settled: number }>(
    "SELECT budget, settled FROM billing_grants WHERE jti = ?",
    input.id,
  );
  const held = existing ? Math.max(0, existing.budget - existing.settled) : 0;
  const available = access.availableMicroCents + held;
  const floor = Math.max(0, Math.ceil(input.minimumMicroCents ?? wanted));
  const amount = Math.min(wanted, available);
  if (amount < floor || (wanted > 0 && amount <= 0)) {
    return { ...access, reserved: false, reservedMicroCents: 0 };
  }
  ctx.db.run(
    `INSERT INTO billing_grants (jti, budget, settled, expires_at, category) VALUES (?, ?, 0, ?, ?)
     ON CONFLICT(jti) DO UPDATE SET budget = billing_grants.settled + excluded.budget,
       expires_at = excluded.expires_at, category = excluded.category`,
    input.id,
    amount,
    input.expiresAt,
    input.category ?? null,
  );
  return {
    ...access,
    availableMicroCents: Math.max(0, available - amount),
    reservedMicroCents: amount,
    reserved: true,
  };
};

// What is still held for a reservation (0 once released or never made).
export const reservationHeld = (ctx: { db: OwnerDbReader }, id: string): number => {
  const row = ctx.db.one<{ budget: number; settled: number }>(
    "SELECT budget, settled FROM billing_grants WHERE jti = ?",
    id,
  );
  return row ? Math.max(0, row.budget - row.settled) : 0;
};

export const releaseSpend = (ctx: OwnerContext, id: string): void => {
  ctx.db.run("DELETE FROM billing_grants WHERE jti = ?", id);
};

const charge = (ctx: OwnerContext, costMicroCents: number): void => {
  const cost = Math.max(0, Math.floor(costMicroCents));
  const row = ensureAccount(ctx.db, ctx.now);
  const snapshot = usageSnapshot(billingConfig(ctx.env), row, ctx.now);
  const fromCredit =
    row.usage_mode === "unlimited"
      ? 0
      : Math.min(Math.max(0, row.credit_balance), Math.max(0, cost - includedHeadroom(snapshot)));
  updateAccount(ctx.db, {
    ...snapshot.normalized,
    rolling_used: snapshot.normalized.rolling_used + cost,
    weekly_used: snapshot.normalized.weekly_used + cost,
    monthly_used: snapshot.normalized.monthly_used + cost,
    total_used: row.total_used + cost,
    total_requests: row.total_requests + 1,
    credit_balance: row.credit_balance - fromCredit,
    credit_consumed: row.credit_consumed + fromCredit,
    updated_at: ctx.now,
  });
};

const utcDay = (at: number): string => new Date(at).toISOString().slice(0, 10);

const rollUp = (
  ctx: OwnerContext,
  entry: {
    category: string;
    provider: string;
    sku: string;
    basis: string;
    plan: string;
    tariffVersion: string;
    failed: boolean;
    providerCost: number;
    charged: number;
  },
): void => {
  ctx.db.run(
    `INSERT INTO billing_cost_daily
       (day, category, provider, sku, basis, plan, tariff_version, attempts, failures, provider_cost, charged, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
     ON CONFLICT(day, category, provider, sku, basis, plan, tariff_version) DO UPDATE SET
       attempts = attempts + 1,
       failures = failures + excluded.failures,
       provider_cost = provider_cost + excluded.provider_cost,
       charged = charged + excluded.charged,
       updated_at = excluded.updated_at`,
    utcDay(ctx.now),
    entry.category,
    entry.provider,
    entry.sku,
    entry.basis,
    entry.plan,
    entry.tariffVersion,
    entry.failed ? 1 : 0,
    entry.providerCost,
    entry.charged,
    ctx.now,
  );
};

// Fixed always-on infrastructure, allocated once per active account-day as a
// cost line. It is never charged to the customer's budget.
const allocateFixedInfra = (ctx: OwnerContext, currentPlan: string, level: number): void => {
  const day = utcDay(ctx.now);
  const id = `infra:${day}`;
  if (ctx.db.one("SELECT 1 AS seen FROM billing_cost_ledger WHERE id = ?", id)) return;
  const cost = usdToMicroCents(FIXED_INFRA_TARIFF.usdPerActiveDay);
  ctx.db.run(
    `INSERT INTO billing_cost_ledger
       (id, at, category, provider, sku, quantity_json, provider_cost, basis, outcome, attempt, request_id,
        charged, tariff_version, plan, identity_level)
     VALUES (?, ?, 'infra_fixed', 'cloudflare', 'active_day', NULL, ?, 'estimated', 'succeeded', 1, NULL, 0, ?, ?, ?)`,
    id,
    ctx.now,
    cost,
    TARIFF_VERSION,
    currentPlan,
    level,
  );
  rollUp(ctx, {
    category: "infra_fixed",
    provider: "cloudflare",
    sku: "active_day",
    basis: "estimated",
    plan: currentPlan,
    tariffVersion: TARIFF_VERSION,
    failed: false,
    providerCost: cost,
    charged: 0,
  });
};

// Record one paid attempt in the cost ledger. Idempotent on entry.id.
export const recordCost = (ctx: OwnerContext, entry: CostEntry, chargedMicroCents: number): boolean => {
  const row = ensureAccount(ctx.db, ctx.now);
  const currentPlan = plan(row);
  const level = identityLevel(row);
  const providerCost = Math.max(0, Math.round(entry.providerCostMicroCents));
  const charged = Math.max(0, Math.floor(chargedMicroCents));
  const tariffVersion = entry.tariffVersion ?? TARIFF_VERSION;
  if (ctx.db.one("SELECT 1 AS seen FROM billing_cost_ledger WHERE id = ?", entry.id)) return false;
  ctx.db.run(
    `INSERT INTO billing_cost_ledger
       (id, at, category, provider, sku, quantity_json, provider_cost, basis, outcome, attempt, request_id,
        charged, tariff_version, plan, identity_level)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    entry.id,
    ctx.now,
    entry.category,
    entry.provider,
    entry.sku ?? null,
    entry.quantity ? JSON.stringify(entry.quantity) : null,
    providerCost,
    entry.basis,
    entry.outcome,
    entry.attempt ?? 1,
    entry.requestId ?? null,
    charged,
    tariffVersion,
    currentPlan,
    level,
  );
  rollUp(ctx, {
    category: entry.category,
    provider: entry.provider,
    sku: entry.sku ?? "",
    basis: entry.basis,
    plan: currentPlan,
    tariffVersion,
    failed: entry.outcome !== "succeeded",
    providerCost,
    charged,
  });
  allocateFixedInfra(ctx, currentPlan, level);
  if (Math.random() < 0.01) {
    ctx.db.run("DELETE FROM billing_cost_ledger WHERE at < ?", ctx.now - COST_LEDGER_RETENTION_MS);
  }
  return true;
};

// Charge the budget for finished (or partly finished) work and record what it
// cost us, in one transaction. `reservationId` lowers that hold by the charge;
// `release` drops whatever is left of it. Idempotent on `receiptId`.
export const settleSpend = (
  ctx: OwnerContext,
  input: {
    receiptId: string;
    chargeMicroCents: number;
    cost?: CostEntry;
    reservationId?: string;
    release?: boolean;
  },
): { charged: boolean } => {
  pruneReceipts(ctx);
  const amount = Math.max(0, Math.floor(input.chargeMicroCents));
  const fresh = claimReceipt(ctx, input.receiptId, amount);
  if (fresh) {
    if (amount > 0) charge(ctx, amount);
    if (input.reservationId && amount > 0) {
      ctx.db.run("UPDATE billing_grants SET settled = settled + ? WHERE jti = ?", amount, input.reservationId);
    }
    if (input.cost) recordCost(ctx, input.cost, amount);
  }
  if (input.reservationId && input.release) releaseSpend(ctx, input.reservationId);
  return { charged: fresh };
};

// Old names, kept for callers not yet moved to reserveSpend/settleSpend.
export const reserveUsage = (
  ctx: OwnerContext,
  input: { id: string; budgetMicroCents: number; expiresAt: number },
): SpendReservation =>
  reserveSpend(ctx, { id: input.id, microCents: input.budgetMicroCents, expiresAt: input.expiresAt });

export const settleReservation = (ctx: OwnerContext, id: string, costMicroCents: number): void => {
  ctx.db.run("UPDATE billing_grants SET settled = settled + ? WHERE jti = ?", Math.max(0, Math.floor(costMicroCents)), id);
};

export const releaseReservation = releaseSpend;

const claimReceipt = (ctx: OwnerContext, id: string, charged: number): boolean => {
  if (ctx.db.one("SELECT 1 AS seen FROM billing_receipts WHERE id = ?", id)) return false;
  ctx.db.run(
    "INSERT INTO billing_receipts (id, charged, created_at) VALUES (?, ?, ?)",
    id,
    Math.max(0, Math.floor(charged)),
    ctx.now,
  );
  return true;
};

const pruneReceipts = (ctx: OwnerContext): void => {
  ctx.db.run("DELETE FROM billing_receipts WHERE created_at < ?", ctx.now - RECEIPT_RETENTION_MS);
};

export type UsageBatchResult = {
  accepted: string[];
  duplicate: string[];
  rejected: Array<{ requestId: string; reason: string }>;
};

export const applyGatewayUsage = (ctx: OwnerContext, events: GatewayUsageEvent[]): UsageBatchResult => {
  const result: UsageBatchResult = { accepted: [], duplicate: [], rejected: [] };
  pruneReceipts(ctx);
  for (const event of events) {
    if (event.ownerId !== ctx.ownerId) {
      result.rejected.push({ requestId: event.requestId, reason: "owner_mismatch" });
      continue;
    }
    const charged = event.billable ? Math.max(0, Math.floor(event.chargedMicroCents)) : 0;
    // Receipts carry the same scope as the gateway's replay key (capability +
    // request); request ids alone can repeat across capabilities.
    const legacyReceipt = ctx.db.one("SELECT 1 AS seen FROM billing_receipts WHERE id = ?", `gw:${event.requestId}`);
    if (legacyReceipt || !claimReceipt(ctx, `gw:${event.capabilityId}:${event.requestId}`, charged)) {
      result.duplicate.push(event.requestId);
      continue;
    }
    ctx.db.run("UPDATE billing_grants SET settled = settled + ? WHERE jti = ?", charged, event.capabilityId);
    // Failed and aborted attempts are charged at what the provider billed us.
    if (charged > 0) charge(ctx, charged);
    const providerCost = event.providerCostMicroCents ?? event.usage.costMicroCents ?? event.chargedMicroCents;
    if (event.billable || providerCost > 0) {
      recordCost(
        ctx,
        {
          id: `model:${event.capabilityId}:${event.requestId}`,
          category: "model",
          provider: event.provider,
          sku: event.resolvedModel || event.requestedModel,
          quantity: {
            inputTokens: event.usage.inputTokens,
            outputTokens: event.usage.outputTokens,
            cachedInputTokens: event.usage.cachedInputTokens ?? 0,
            cacheWriteTokens: event.usage.cacheWriteTokens ?? 0,
            reasoningTokens: event.usage.reasoningTokens ?? 0,
            durationMs: Math.max(0, event.finishedAt - event.startedAt),
          },
          providerCostMicroCents: event.billable ? providerCost : 0,
          basis: event.costBasis ?? (event.usage.reported && event.usage.costMicroCents !== undefined ? "actual" : "estimated"),
          outcome: event.outcome === "succeeded" ? "succeeded" : event.outcome === "aborted" ? "aborted" : "failed",
          attempt: event.attempt ?? 1,
          requestId: event.requestId,
          ...(event.tariffVersion ? { tariffVersion: event.tariffVersion } : {}),
        },
        charged,
      );
    }
    result.accepted.push(event.requestId);
  }
  return result;
};

export const recordUsage = (
  ctx: OwnerContext,
  records: Array<{ id: string; costMicroCents: number; cost?: CostEntry }>,
): { recorded: number; duplicate: number } => {
  let recorded = 0;
  pruneReceipts(ctx);
  for (const record of records) {
    if (!claimReceipt(ctx, `use:${record.id}`, record.costMicroCents)) continue;
    charge(ctx, record.costMicroCents);
    if (record.cost) recordCost(ctx, record.cost, record.costMicroCents);
    recorded += 1;
  }
  return { recorded, duplicate: records.length - recorded };
};

export const setAdminPlan = (
  ctx: OwnerContext,
  input: {
    plan?: BillingPlan;
    usageMode?: "default" | "unlimited";
    resetUsage?: boolean;
    spendAllowance?: boolean;
    // A plan granted outside Stripe (Rahul's own account): detach any Stripe
    // subscription so its later events can't move the plan.
    complimentary?: boolean;
  },
): void => {
  const row = ensureAccount(ctx.db, ctx.now);
  const nextPlan = input.plan ?? plan(row);
  const planChanged = nextPlan !== plan(row);
  const usageMode = input.usageMode ?? (planChanged ? "default" : row.usage_mode);
  const anchor = nextPlan === "free" ? row.monthly_anchor_at : ctx.now;
  updateAccount(ctx.db, {
    plan: nextPlan,
    usage_mode: usageMode,
    subscription_status: nextPlan === "free" ? "none" : "active",
    current_period_end: 0,
    cancel_at_period_end: 0,
    monthly_anchor_at: anchor,
    ...(input.resetUsage ?? (planChanged || usageMode !== row.usage_mode)
      ? resetWindows(ctx.now, anchor)
      : {}),
    ...(input.spendAllowance ? { total_used: SPENT_ALLOWANCE_MICRO_CENTS, credit_balance: 0 } : {}),
    ...(input.complimentary
      ? { stripe_subscription_id: null, stripe_price_id: null, subscription_status: nextPlan === "free" ? "none" : "complimentary" }
      : {}),
    updated_at: ctx.now,
  });
};

const SPENT_ALLOWANCE_MICRO_CENTS = 10_000_000_000_000;

const resetWindows = (now: number, anchor: number): Partial<AccountRow> => ({
  rolling_used: 0,
  rolling_started_at: now,
  weekly_used: 0,
  weekly_started_at: weekBounds(now).start,
  monthly_used: 0,
  monthly_started_at: monthBounds(now, anchor).start,
});

type StripeItemPrice = {
  active: boolean;
  currency: string;
  unit_amount: number | null;
  type: string;
  recurring?: { interval?: string; interval_count?: number; usage_type?: string } | null;
};

type StripeSubscription = {
  id: string;
  status: string;
  customer: string;
  cancel_at_period_end?: boolean;
  current_period_start?: number;
  current_period_end?: number;
  metadata?: Record<string, string>;
  items?: {
    data?: Array<{
      price?: { id?: string } & Partial<StripeItemPrice>;
      current_period_start?: number;
      current_period_end?: number;
    }>;
  };
  default_payment_method?: { card?: { brand?: string; last4?: string } } | string | null;
};

const normalizeReturnUrl = (value: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new RpcError("BAD_REQUEST", "Invalid return URL.");
  }
  const host = parsed.hostname.toLowerCase();
  const local = host === "localhost" || host === "127.0.0.1" || host === "[::1]";
  if (!local && parsed.protocol !== "https:") {
    throw new RpcError("BAD_REQUEST", "Return URL must use HTTPS outside local development.");
  }
  return parsed.toString();
};

const withCheckoutStatus = (returnUrl: string, status: "success" | "cancel"): string => {
  const parsed = new URL(returnUrl);
  parsed.searchParams.set("checkout", status);
  return parsed.toString();
};

const stripeUnavailable = (error: unknown): RpcError =>
  new RpcError(
    "UNAVAILABLE",
    error instanceof StripeError && error.status < 500
      ? error.message
      : "Billing is temporarily unavailable. Try again.",
    { retryable: !(error instanceof StripeError && error.status < 500) },
  );

const requireBilling = (env: Cloudflare.Env): void => {
  if (!billingConfig(env).enabled) {
    throw new RpcError("UNAVAILABLE", "Billing isn't set up on this Stella.", { retryable: false });
  }
};

const ensureCustomer = async (ctx: OwnerContext): Promise<string> => {
  const row = ensureAccount(ctx.db, ctx.now);
  if (row.stripe_customer_id) return row.stripe_customer_id;
  const customer = await stripeRequest<{ id: string }>(
    ctx.env,
    "POST",
    "/customers",
    { metadata: { ownerId: ctx.ownerId } },
    { idempotencyKey: `stella-customer-${ctx.ownerId}` },
  );
  updateAccount(ctx.db, { stripe_customer_id: customer.id, updated_at: ctx.now });
  return customer.id;
};

const checkout = async (
  ctx: OwnerContext,
  args: BillingCalls["billing.checkout"]["args"],
): Promise<{ url: string; sessionId: string }> => {
  requireBilling(ctx.env);
  const source = args.source?.trim().toLowerCase() || "web";
  if (source === "ios" && args.appStoreCountry?.trim().toUpperCase() !== "USA") {
    throw new RpcError("FORBIDDEN", "In-app subscriptions aren't available in your App Store region.");
  }
  enforceOwnerRateLimit(
    ctx.db,
    ctx.now,
    "billing.stripe",
    STRIPE_RATE_LIMIT,
    "Too many checkout requests. Please wait a moment and try again.",
  );
  const config = billingConfig(ctx.env);
  const returnUrl = normalizeReturnUrl(args.returnUrl);
  try {
    const customer = await ensureCustomer(ctx);
    const metadata = { ownerId: ctx.ownerId, plan: args.plan, source };
    const priceId = await verifyStripePrice(ctx.env, config, args.plan);
    const session = await stripeRequest<{ id: string; url: string | null }>(ctx.env, "POST", "/checkout/sessions", {
      mode: "subscription",
      ui_mode: "hosted_page",
      customer,
      client_reference_id: ctx.ownerId,
      line_items: [{ price: priceId, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: withCheckoutStatus(returnUrl, "success"),
      cancel_url: withCheckoutStatus(returnUrl, "cancel"),
      managed_payments: { enabled: true },
      billing_address_collection: "auto",
      customer_update: { address: "auto", name: "auto" },
      metadata,
      subscription_data: { metadata },
    });
    if (!session.url) throw new StripeError(502, "Stripe returned no checkout URL.");
    return { url: session.url, sessionId: session.id };
  } catch (error) {
    if (error instanceof RpcError) throw error;
    if (error instanceof StripePriceMismatchError) {
      throw new RpcError("UNAVAILABLE", "This plan can't be bought right now. Try again later.", { retryable: false });
    }
    throw stripeUnavailable(error);
  }
};

const creditCheckout = async (
  ctx: OwnerContext,
  args: BillingCalls["billing.creditCheckout"]["args"],
): Promise<{ url: string; sessionId: string }> => {
  requireBilling(ctx.env);
  const amountCents = Math.floor(args.amountCents);
  if (amountCents < CREDIT_MIN_CENTS || amountCents > CREDIT_MAX_CENTS) {
    throw new RpcError(
      "BAD_REQUEST",
      `Credit amount must be between $${CREDIT_MIN_CENTS / 100} and $${CREDIT_MAX_CENTS / 100}.`,
    );
  }
  enforceOwnerRateLimit(
    ctx.db,
    ctx.now,
    "billing.stripe",
    STRIPE_RATE_LIMIT,
    "Too many checkout requests. Please wait a moment and try again.",
  );
  const returnUrl = normalizeReturnUrl(args.returnUrl);
  try {
    const customer = await ensureCustomer(ctx);
    const metadata = { ownerId: ctx.ownerId, purpose: "usage_credit", amountCents: String(amountCents) };
    const session = await stripeRequest<{ id: string; url: string | null }>(ctx.env, "POST", "/checkout/sessions", {
      mode: "payment",
      ui_mode: "hosted_page",
      customer,
      client_reference_id: ctx.ownerId,
      line_items: [
        {
          price_data: {
            currency: CREDIT_CURRENCY,
            unit_amount: amountCents,
            product_data: { name: "Stella extra usage credit" },
          },
          quantity: 1,
        },
      ],
      success_url: withCheckoutStatus(returnUrl, "success"),
      cancel_url: withCheckoutStatus(returnUrl, "cancel"),
      managed_payments: { enabled: true },
      billing_address_collection: "auto",
      customer_update: { address: "auto", name: "auto" },
      metadata,
      payment_intent_data: { metadata },
    });
    if (!session.url) throw new StripeError(502, "Stripe returned no checkout URL.");
    return { url: session.url, sessionId: session.id };
  } catch (error) {
    if (error instanceof RpcError) throw error;
    throw stripeUnavailable(error);
  }
};

const portal = async (
  ctx: OwnerContext,
  args: BillingCalls["billing.portal"]["args"],
): Promise<{ url: string }> => {
  const customer = readAccount(ctx.db, ctx.now).stripe_customer_id;
  if (!customer) throw new RpcError("NOT_FOUND", "There is no billing account to manage yet.");
  enforceOwnerRateLimit(
    ctx.db,
    ctx.now,
    "billing.stripe",
    STRIPE_RATE_LIMIT,
    "Too many billing requests. Please wait a moment and try again.",
  );
  try {
    const session = await stripeRequest<{ url: string }>(ctx.env, "POST", "/billing_portal/sessions", {
      customer,
      return_url: normalizeReturnUrl(args.returnUrl),
    });
    return { url: session.url };
  } catch (error) {
    throw stripeUnavailable(error);
  }
};

const syncSubscription = (ctx: OwnerContext, subscription: StripeSubscription): void => {
  const row = ensureAccount(ctx.db, ctx.now);
  if (row.stripe_customer_id && subscription.customer !== row.stripe_customer_id) return;
  const item = subscription.items?.data?.[0];
  const priceId = item?.price?.id ?? null;
  const mapped = planForStripePrice(billingConfig(ctx.env), priceId);
  const mismatch = mapped && item?.price?.unit_amount !== undefined
    ? priceMismatch(mapped, { ...(item.price as StripeItemPrice), active: true, id: priceId ?? "" })
    : null;
  if (mismatch) {
    console.error(JSON.stringify({ event: "billing_subscription_price_mismatch", plan: mapped, priceId, mismatch }));
  }
  const paid = mismatch ? null : mapped;
  const nextPlan: BillingPlan =
    subscription.status !== "complimentary" && ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status) && paid
      ? paid
      : "free";
  if (row.subscription_status === "complimentary" && nextPlan === "free") return;
  if (
    row.stripe_subscription_id &&
    row.stripe_subscription_id !== subscription.id &&
    nextPlan === "free" &&
    plan(row) !== "free"
  ) {
    return;
  }
  const periodStart = (item?.current_period_start ?? subscription.current_period_start ?? 0) * 1000;
  const periodEnd = (item?.current_period_end ?? subscription.current_period_end ?? 0) * 1000;
  const anchor = nextPlan === "free" ? row.monthly_anchor_at : periodStart || ctx.now;
  const card =
    typeof subscription.default_payment_method === "object" && subscription.default_payment_method
      ? subscription.default_payment_method.card
      : undefined;
  updateAccount(ctx.db, {
    plan: nextPlan,
    usage_mode: nextPlan === plan(row) ? row.usage_mode : "default",
    subscription_status: subscription.status,
    stripe_customer_id: subscription.customer,
    stripe_subscription_id: subscription.id,
    stripe_price_id: nextPlan === "free" ? null : priceId,
    current_period_end: periodEnd,
    cancel_at_period_end: subscription.cancel_at_period_end ? 1 : 0,
    ...(card ? { payment_method_brand: card.brand ?? null, payment_method_last4: card.last4 ?? null } : {}),
    monthly_anchor_at: anchor,
    ...(nextPlan !== plan(row) ? resetWindows(ctx.now, anchor) : {}),
    updated_at: ctx.now,
  });
};

const fetchSubscription = (ctx: OwnerContext, id: string) =>
  stripeRequest<StripeSubscription>(ctx.env, "GET", `/subscriptions/${encodeURIComponent(id)}`, {
    expand: ["default_payment_method"],
  });

const subscriptionIdOf = (object: Record<string, unknown>): string | null => {
  const direct = object.subscription;
  if (typeof direct === "string") return direct;
  const parent = object.parent as { subscription_details?: { subscription?: unknown } } | undefined;
  const nested = parent?.subscription_details?.subscription;
  return typeof nested === "string" ? nested : null;
};

export const applyStripeEvent = async (ctx: OwnerContext, event: StripeEvent): Promise<void> => {
  if (ctx.db.one("SELECT 1 AS seen FROM billing_stripe_events WHERE id = ?", event.id)) return;
  const object = event.data.object;
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const metadata = (object.metadata ?? {}) as Record<string, string>;
      if (object.mode === "payment" && metadata.purpose === "usage_credit") {
        if (object.payment_status !== "paid") break;
        const sessionId = String(object.id);
        const chosen = Number(metadata.amountCents);
        const cents = Number.isSafeInteger(chosen) && chosen > 0
          ? chosen
          : Math.max(0, Math.floor(Number(object.amount_subtotal ?? 0)));
        if (ctx.db.one("SELECT 1 AS seen FROM billing_credit_purchases WHERE checkout_session_id = ?", sessionId)) break;
        const amount = cents * 1_000_000;
        ctx.db.run(
          "INSERT INTO billing_credit_purchases (checkout_session_id, amount, created_at) VALUES (?, ?, ?)",
          sessionId,
          amount,
          ctx.now,
        );
        const row = ensureAccount(ctx.db, ctx.now);
        updateAccount(ctx.db, {
          credit_balance: row.credit_balance + amount,
          credit_purchased: row.credit_purchased + amount,
          updated_at: ctx.now,
        });
        break;
      }
      const subscriptionId = subscriptionIdOf(object);
      if (subscriptionId) syncSubscription(ctx, await fetchSubscription(ctx, subscriptionId));
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
      syncSubscription(ctx, await fetchSubscription(ctx, String(object.id)));
      break;
    case "invoice.paid":
    case "invoice.payment_succeeded":
    case "invoice.payment_failed": {
      const subscriptionId = subscriptionIdOf(object);
      if (subscriptionId) syncSubscription(ctx, await fetchSubscription(ctx, subscriptionId));
      break;
    }
    case "customer.deleted": {
      const row = ensureAccount(ctx.db, ctx.now);
      if (row.stripe_customer_id !== object.id) break;
      updateAccount(ctx.db, {
        stripe_customer_id: null,
        stripe_subscription_id: null,
        stripe_price_id: null,
        subscription_status: "none",
        cancel_at_period_end: 0,
        current_period_end: 0,
        payment_method_brand: null,
        payment_method_last4: null,
        ...(plan(row) !== "free" ? { plan: "free", ...resetWindows(ctx.now, row.monthly_anchor_at) } : {}),
        updated_at: ctx.now,
      });
      break;
    }
    default:
      break;
  }
  ctx.db.run("INSERT INTO billing_stripe_events (id, created_at) VALUES (?, ?)", event.id, ctx.now);
  ctx.db.run("DELETE FROM billing_stripe_events WHERE created_at < ?", ctx.now - RECEIPT_RETENTION_MS);
};

export const stopStripeRenewal = async (ctx: OwnerContext): Promise<void> => {
  const row = readAccount(ctx.db, ctx.now);
  if (!row.stripe_subscription_id || row.cancel_at_period_end === 1) return;
  if (!ACTIVE_SUBSCRIPTION_STATUSES.has(row.subscription_status ?? "")) return;
  try {
    await stripeRequest(ctx.env, "POST", `/subscriptions/${encodeURIComponent(row.stripe_subscription_id)}`, {
      cancel_at_period_end: true,
    });
  } catch (error) {
    if (!(error instanceof StripeError && error.status === 404)) throw error;
    return;
  }
  updateAccount(ctx.db, { cancel_at_period_end: 1, updated_at: ctx.now });
};

export const closeStripeCustomer = async (ctx: OwnerContext): Promise<void> => {
  const row = readAccount(ctx.db, ctx.now);
  if (!row.stripe_customer_id) return;
  try {
    await stripeRequest(ctx.env, "DELETE", `/customers/${encodeURIComponent(row.stripe_customer_id)}`);
  } catch (error) {
    if (!(error instanceof StripeError && error.status === 404)) throw error;
  }
};

const usd = (microCents: number) => Number((microCents / MICRO_CENTS_PER_USD).toFixed(4));

const status = (ctx: {
  db: OwnerDbReader;
  env: Cloudflare.Env;
  now: number;
}): BillingStatus => {
  const config = billingConfig(ctx.env);
  const row = readAccount(ctx.db, ctx.now);
  const snapshot = usageSnapshot(config, row, ctx.now);
  const access = accessFor(config, row, ctx.now, reservedGrants(ctx.db, ctx.now));
  return {
    authenticated: true,
    isAnonymous: false,
    identityLevel: identityLevel(row),
    plan: config.enabled ? plan(row) : "max",
    subscriptionStatus: row.subscription_status,
    cancelAtPeriodEnd: row.cancel_at_period_end === 1,
    currentPeriodEnd: row.current_period_end > 0 ? row.current_period_end : null,
    usage: {
      rollingUsedUsd: usd(snapshot.rolling.used),
      rollingLimitUsd: usd(snapshot.rolling.limit),
      weeklyUsedUsd: usd(snapshot.weekly.used),
      weeklyLimitUsd: usd(snapshot.weekly.limit),
      monthlyUsedUsd: usd(snapshot.monthly.used),
      monthlyLimitUsd: usd(snapshot.monthly.limit),
      lifetimeUsedUsd: usd(row.total_used),
      lifetimeLimitUsd: snapshot.lifetime ? usd(snapshot.lifetime.limit) : null,
      rollingResetsAt: snapshot.rolling.resetAt,
      weeklyResetsAt: snapshot.weekly.resetAt,
      monthlyResetsAt: snapshot.monthly.resetAt,
      reservedUsd: usd(access.reservedMicroCents),
      availableUsd: access.availableMicroCents === null ? null : usd(access.availableMicroCents),
    },
    usagePolicy: { kind: "managed_cost" },
    plans: config.plans,
    credits: {
      currency: CREDIT_CURRENCY,
      balanceUsd: usd(Math.max(0, row.credit_balance)),
      totalPurchasedUsd: usd(row.credit_purchased),
      totalConsumedUsd: usd(row.credit_consumed),
    },
    creditPurchase: {
      currency: CREDIT_CURRENCY,
      minAmountCents: CREDIT_MIN_CENTS,
      maxAmountCents: CREDIT_MAX_CENTS,
      presetAmountCents: [...CREDIT_PRESET_CENTS],
    },
  };
};

const returnUrlArg = string({ min: 1, max: 2_048 });

export const billingDomain = {
  name: "billing",
  migrations: [BILLING_MIGRATION, BILLING_COST_LEDGER_MIGRATION],
  calls: {
    "billing.checkout": {
      scope: "owner",
      parse: object({
        plan: literal("plus", "pro", "max"),
        returnUrl: returnUrlArg,
        source: optional(string({ max: 32 })),
        appStoreCountry: optional(string({ max: 8 })),
      }),
      handler: (ctx: OwnerContext, args: BillingCalls["billing.checkout"]["args"]) => checkout(ctx, args),
    },
    "billing.creditCheckout": {
      scope: "owner",
      parse: object({
        amountCents: number({ int: true, min: CREDIT_MIN_CENTS, max: CREDIT_MAX_CENTS }),
        returnUrl: returnUrlArg,
      }),
      handler: (ctx: OwnerContext, args: BillingCalls["billing.creditCheckout"]["args"]) =>
        creditCheckout(ctx, args),
    },
    "billing.portal": {
      scope: "owner",
      parse: object({ returnUrl: returnUrlArg }),
      handler: (ctx: OwnerContext, args: BillingCalls["billing.portal"]["args"]) => portal(ctx, args),
    },
  },
  views: {
    "billing.status": {
      parse: empty(),
      read: (ctx) => status(ctx),
    },
  },
} satisfies OwnerDomain;
