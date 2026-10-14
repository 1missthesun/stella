import { normalizeBillingPlan, PLAN_CATALOG } from "@stella/contracts/billing-plans";
import { MICRO_CENTS_PER_USD, TARIFF_VERSION } from "@stella/contracts/billing-tariffs";
import type { OwnerContext, OwnerDbReader, OwnerPurgeMode } from "../registry.js";

export const COST_EXPORT_JOB = "billing.costExport";
const COST_EXPORT_INTERVAL_MS = 60 * 60 * 1000;
const COST_EXPORT_BATCH = 200;
const COST_EXPORT_MAX_BATCHES = 5;
const COST_EXPORT_MEMORY_KEY = "billing.costExportAt";
const LEDGER_DEFAULT_LIMIT = 100;
const LEDGER_MAX_LIMIT = 500;

type DailyRow = {
  day: string;
  category: string;
  provider: string;
  sku: string;
  basis: string;
  plan: string;
  tariff_version: string;
  attempts: number;
  failures: number;
  provider_cost: number;
  charged: number;
  updated_at: number;
  exported_at: number;
};

type LedgerRow = {
  id: string;
  at: number;
  category: string;
  provider: string;
  sku: string | null;
  quantity_json: string | null;
  provider_cost: number;
  basis: string;
  outcome: string;
  attempt: number;
  request_id: string | null;
  charged: number;
  tariff_version: string;
  plan: string;
  identity_level: number;
};

const usd = (microCents: number) => Number((microCents / MICRO_CENTS_PER_USD).toFixed(6));

/** Keeps one pending export job; called on every new cost row. */
export const scheduleCostExport = (ctx: OwnerContext): void => {
  const memory = ctx.db.memory;
  const known = memory?.get(COST_EXPORT_MEMORY_KEY);
  if (typeof known === "number" && known > ctx.now) return;
  const pending = ctx.db.one<{ run_at: number }>("SELECT run_at FROM owner_jobs WHERE id = ?", COST_EXPORT_JOB);
  if (pending) {
    memory?.set(COST_EXPORT_MEMORY_KEY, pending.run_at);
    return;
  }
  const runAt = ctx.now + COST_EXPORT_INTERVAL_MS;
  ctx.jobs.schedule(COST_EXPORT_JOB, runAt, null, { id: COST_EXPORT_JOB });
  memory?.set(COST_EXPORT_MEMORY_KEY, runAt);
};

/**
 * Copies dirty daily rollups (updated since their last export) to D1's
 * owner_cost_daily. Rows are running totals, so the upsert is idempotent.
 */
export const exportCostDaily = async (ctx: OwnerContext): Promise<{ exported: number; remaining: boolean }> => {
  const database = ctx.env.DB;
  if (!database) throw new Error("The DB binding is missing.");
  let exported = 0;
  let remaining = false;
  for (let batch = 0; batch < COST_EXPORT_MAX_BATCHES; batch += 1) {
    const rows = ctx.db.all<DailyRow>(
      `SELECT * FROM billing_cost_daily WHERE updated_at > exported_at ORDER BY day LIMIT ?`,
      COST_EXPORT_BATCH,
    );
    if (rows.length === 0) break;
    await database.batch(
      rows.map((row) =>
        database
          .prepare(
            `INSERT INTO owner_cost_daily
               (owner_id, day, category, provider, sku, basis, plan, tariff_version,
                attempts, failures, provider_cost, charged, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (owner_id, day, category, provider, sku, basis, plan, tariff_version) DO UPDATE SET
               attempts = excluded.attempts, failures = excluded.failures,
               provider_cost = excluded.provider_cost, charged = excluded.charged,
               updated_at = excluded.updated_at
             WHERE excluded.updated_at >= owner_cost_daily.updated_at`,
          )
          .bind(
            ctx.ownerId,
            row.day,
            row.category,
            row.provider,
            row.sku,
            row.basis,
            row.plan,
            row.tariff_version,
            row.attempts,
            row.failures,
            row.provider_cost,
            row.charged,
            row.updated_at,
          ),
      ),
    );
    for (const row of rows) {
      ctx.db.run(
        `UPDATE billing_cost_daily SET exported_at = ?
         WHERE day = ? AND category = ? AND provider = ? AND sku = ? AND basis = ? AND plan = ? AND tariff_version = ?`,
        row.updated_at,
        row.day,
        row.category,
        row.provider,
        row.sku,
        row.basis,
        row.plan,
        row.tariff_version,
      );
    }
    exported += rows.length;
    remaining = rows.length === COST_EXPORT_BATCH;
    if (!remaining) break;
  }
  if (!remaining) {
    remaining = ctx.db.one("SELECT 1 AS dirty FROM billing_cost_daily WHERE updated_at > exported_at LIMIT 1") !== null;
  }
  return { exported, remaining };
};

const runCostExport = async (ctx: OwnerContext): Promise<void> => {
  const { remaining } = await exportCostDaily(ctx);
  if (remaining) {
    const runAt = ctx.now + COST_EXPORT_INTERVAL_MS;
    ctx.jobs.schedule(COST_EXPORT_JOB, runAt, null, { id: COST_EXPORT_JOB });
    ctx.db.memory?.set(COST_EXPORT_MEMORY_KEY, runAt);
  } else {
    ctx.db.memory?.delete(COST_EXPORT_MEMORY_KEY);
  }
};

export const costExportJobs = {
  [COST_EXPORT_JOB]: { run: runCostExport, maxAttempts: 20 },
};

export const purgeCostExport = async (ctx: OwnerContext, mode: OwnerPurgeMode): Promise<{ pending: boolean }> => {
  if (mode !== "delete") return { pending: false };
  ctx.jobs.cancel(COST_EXPORT_JOB);
  ctx.db.memory?.delete(COST_EXPORT_MEMORY_KEY);
  await ctx.env.DB?.prepare("DELETE FROM owner_cost_daily WHERE owner_id = ?").bind(ctx.ownerId).run();
  return { pending: false };
};

export type OwnerCostQuery = {
  from: string;
  to: string;
  limit?: number;
  cursor?: string;
};

const dayStart = (day: string): number => Date.parse(`${day}T00:00:00Z`);

const parseCursor = (cursor: string | undefined): { at: number; id: string } | null => {
  if (!cursor) return null;
  const split = cursor.indexOf(":");
  const at = Number(cursor.slice(0, split));
  return split > 0 && Number.isFinite(at) ? { at, id: cursor.slice(split + 1) } : null;
};

/** One owner's raw ledger page (newest first), rollups for the day range, and revenue context. */
export const ownerCostReport = (ctx: { db: OwnerDbReader; now: number }, query: OwnerCostQuery) => {
  const limit = Math.min(LEDGER_MAX_LIMIT, Math.max(1, Math.floor(query.limit ?? LEDGER_DEFAULT_LIMIT)));
  const fromAt = dayStart(query.from);
  const toAt = dayStart(query.to) + 24 * 60 * 60 * 1000;
  const cursor = parseCursor(query.cursor);
  const ledger = cursor
    ? ctx.db.all<LedgerRow>(
        `SELECT * FROM billing_cost_ledger WHERE at >= ? AND at < ? AND (at < ? OR (at = ? AND id < ?))
         ORDER BY at DESC, id DESC LIMIT ?`,
        fromAt,
        toAt,
        cursor.at,
        cursor.at,
        cursor.id,
        limit + 1,
      )
    : ctx.db.all<LedgerRow>(
        "SELECT * FROM billing_cost_ledger WHERE at >= ? AND at < ? ORDER BY at DESC, id DESC LIMIT ?",
        fromAt,
        toAt,
        limit + 1,
      );
  const page = ledger.slice(0, limit);
  const last = page.at(-1);
  const rollup = ctx.db.all<{
    category: string;
    provider: string;
    sku: string;
    basis: string;
    plan: string;
    tariff_version: string;
    days: number;
    attempts: number;
    failures: number;
    provider_cost: number;
    charged: number;
  }>(
    `SELECT category, provider, sku, basis, plan, tariff_version, COUNT(DISTINCT day) AS days,
            SUM(attempts) AS attempts, SUM(failures) AS failures,
            SUM(provider_cost) AS provider_cost, SUM(charged) AS charged
     FROM billing_cost_daily WHERE day >= ? AND day <= ?
     GROUP BY category, provider, sku, basis, plan, tariff_version
     ORDER BY provider_cost DESC`,
    query.from,
    query.to,
  );
  const variable = rollup.filter((row) => row.category !== "infra_fixed");
  const infra = rollup.filter((row) => row.category === "infra_fixed");
  const sum = (rows: typeof rollup, key: "provider_cost" | "charged") => rows.reduce((total, row) => total + row[key], 0);
  const exportState = ctx.db.one<{ dirty: number; exported_at: number | null }>(
    "SELECT SUM(updated_at > exported_at) AS dirty, MAX(exported_at) AS exported_at FROM billing_cost_daily",
  );
  const account = ctx.db.one<{
    plan: string;
    usage_mode: string;
    subscription_status: string;
    stripe_price_id: string | null;
    total_used: number;
    credit_balance: number;
    credit_purchased: number;
    credit_consumed: number;
  }>(
    `SELECT plan, usage_mode, subscription_status, stripe_price_id, total_used,
            credit_balance, credit_purchased, credit_consumed
     FROM billing_account WHERE id = 1`,
  );
  const plan = normalizeBillingPlan(account?.plan ?? "free");
  const catalog = PLAN_CATALOG[plan];
  return {
    range: { from: query.from, to: query.to },
    tariffVersion: TARIFF_VERSION,
    revenue: {
      plan,
      label: catalog.label,
      monthlyPriceCents: catalog.monthlyPriceCents,
      budgetUsd: catalog.budget,
      usageMode: account?.usage_mode ?? "default",
      subscriptionStatus: account?.subscription_status ?? "none",
      stripePriceId: account?.stripe_price_id ?? null,
      lifetimeChargedUsd: usd(account?.total_used ?? 0),
      creditBalanceUsd: usd(Math.max(0, account?.credit_balance ?? 0)),
      creditPurchasedUsd: usd(account?.credit_purchased ?? 0),
      creditConsumedUsd: usd(account?.credit_consumed ?? 0),
    },
    totals: {
      variableProviderCostUsd: usd(sum(variable, "provider_cost")),
      fixedInfraCostUsd: usd(sum(infra, "provider_cost")),
      chargedUsd: usd(sum(rollup, "charged")),
      attempts: variable.reduce((total, row) => total + row.attempts, 0),
      failures: variable.reduce((total, row) => total + row.failures, 0),
    },
    rollup: rollup.map((row) => ({
      category: row.category,
      provider: row.provider,
      sku: row.sku,
      basis: row.basis,
      plan: row.plan,
      tariffVersion: row.tariff_version,
      days: row.days,
      attempts: row.attempts,
      failures: row.failures,
      providerCostMicroCents: row.provider_cost,
      chargedMicroCents: row.charged,
      providerCostUsd: usd(row.provider_cost),
      chargedUsd: usd(row.charged),
    })),
    ledger: page.map((row) => ({
      id: row.id,
      at: new Date(row.at).toISOString(),
      category: row.category,
      provider: row.provider,
      sku: row.sku,
      quantity: row.quantity_json ? (JSON.parse(row.quantity_json) as Record<string, number>) : null,
      providerCostMicroCents: row.provider_cost,
      chargedMicroCents: row.charged,
      basis: row.basis,
      outcome: row.outcome,
      attempt: row.attempt,
      requestId: row.request_id,
      tariffVersion: row.tariff_version,
      plan: row.plan,
      identityLevel: row.identity_level,
    })),
    nextCursor: ledger.length > limit && last ? `${last.at}:${last.id}` : null,
    export: {
      dirtyDays: exportState?.dirty ?? 0,
      lastExportedAt: exportState?.exported_at ? new Date(exportState.exported_at).toISOString() : null,
    },
  };
};

export type OwnerCostReport = ReturnType<typeof ownerCostReport>;
