import { isBillingPlan, normalizeBillingPlan, PLAN_CATALOG } from "@stella/contracts/billing-plans";
import { MICRO_CENTS_PER_USD } from "@stella/contracts/billing-tariffs";
import { fail, json } from "../http/response.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const DAYS_PER_MONTH = 30.44;
const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 400;
const OWNER_DEFAULT_LIMIT = 50;
const OWNER_MAX_LIMIT = 500;
const GROUP_BY = ["plan", "category", "owner"] as const;
type GroupBy = (typeof GROUP_BY)[number];

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const usd = (microCents: number) => Number((microCents / MICRO_CENTS_PER_USD).toFixed(4));

const isoDay = (at: number) => new Date(at).toISOString().slice(0, 10);

/** Parses an inclusive UTC day range (`YYYY-MM-DD`), defaulting to the last 30 days. */
export const dayRange = (url: URL): { from: string; to: string; days: number } | Response => {
  const to = url.searchParams.get("to")?.trim() || isoDay(Date.now());
  const from = url.searchParams.get("from")?.trim() || isoDay(Date.parse(`${to}T00:00:00Z`) - (DEFAULT_RANGE_DAYS - 1) * DAY_MS);
  if (!DAY_PATTERN.test(from) || !DAY_PATTERN.test(to)) return fail(400, "from and to must be YYYY-MM-DD (UTC).");
  const fromAt = Date.parse(`${from}T00:00:00Z`);
  const toAt = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(fromAt) || !Number.isFinite(toAt) || toAt < fromAt) return fail(400, "Invalid day range.");
  const days = Math.round((toAt - fromAt) / DAY_MS) + 1;
  if (days > MAX_RANGE_DAYS) return fail(400, `Range is at most ${MAX_RANGE_DAYS} days.`);
  return { from, to, days };
};

type Row = {
  owner_id: string;
  plan: string;
  category: string;
  basis: string;
  days: number;
  attempts: number;
  failures: number;
  provider_cost: number;
  charged: number;
};

type Totals = {
  variableCost: number;
  fixedInfraCost: number;
  charged: number;
  attempts: number;
  failures: number;
  estimatedCost: number;
};

const emptyTotals = (): Totals => ({
  variableCost: 0,
  fixedInfraCost: 0,
  charged: 0,
  attempts: 0,
  failures: 0,
  estimatedCost: 0,
});

const add = (totals: Totals, row: Row) => {
  if (row.category === "infra_fixed") totals.fixedInfraCost += row.provider_cost;
  else {
    totals.variableCost += row.provider_cost;
    totals.attempts += row.attempts;
    totals.failures += row.failures;
    if (row.basis === "estimated") totals.estimatedCost += row.provider_cost;
  }
  totals.charged += row.charged;
};

const totalsUsd = (totals: Totals) => ({
  variableProviderCostUsd: usd(totals.variableCost),
  fixedInfraCostUsd: usd(totals.fixedInfraCost),
  allInCostUsd: usd(totals.variableCost + totals.fixedInfraCost),
  chargedUsd: usd(totals.charged),
  attempts: totals.attempts,
  failures: totals.failures,
  estimatedShare: totals.variableCost > 0 ? Number((totals.estimatedCost / totals.variableCost).toFixed(3)) : 0,
});

const percentile = (sorted: number[], p: number): number => {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[index]!;
};

const distribution = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    owners: sorted.length,
    p50Usd: usd(percentile(sorted, 0.5)),
    p95Usd: usd(percentile(sorted, 0.95)),
    maxUsd: usd(sorted.at(-1) ?? 0),
  };
};

type OwnerPlan = { totals: Totals };

/**
 * Cross-owner cost report over D1's owner_cost_daily. Revenue is an estimate:
 * each owner seen in the range pays their plan's monthly price prorated to the
 * range, split across plans by the share of active days on each.
 */
export const costsReport = async (url: URL, database: D1Database): Promise<Response> => {
  const range = dayRange(url);
  if (range instanceof Response) return range;
  const groupBy = (url.searchParams.get("groupBy")?.trim().toLowerCase() || "plan") as GroupBy;
  if (!GROUP_BY.includes(groupBy)) return fail(400, "groupBy must be plan, category, or owner.");
  const planFilter = url.searchParams.get("plan")?.trim().toLowerCase() || null;
  if (planFilter && !isBillingPlan(planFilter)) return fail(400, `Unsupported plan: ${planFilter}`);
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? OWNER_DEFAULT_LIMIT : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > OWNER_MAX_LIMIT) {
    return fail(400, `limit must be 1 to ${OWNER_MAX_LIMIT}.`);
  }

  const { results } = await database
    .prepare(
      `SELECT owner_id, plan, category, basis, COUNT(DISTINCT day) AS days,
              SUM(attempts) AS attempts, SUM(failures) AS failures,
              SUM(provider_cost) AS provider_cost, SUM(charged) AS charged
       FROM owner_cost_daily WHERE day >= ? AND day <= ?
       GROUP BY owner_id, plan, category, basis`,
    )
    .bind(range.from, range.to)
    .all<Row>();
  const { results: activeDays } = await database
    .prepare(
      `SELECT owner_id, plan, COUNT(DISTINCT day) AS days FROM owner_cost_daily
       WHERE day >= ? AND day <= ? GROUP BY owner_id, plan`,
    )
    .bind(range.from, range.to)
    .all<{ owner_id: string; plan: string; days: number }>();

  const rows = results
    .map((row) => ({ ...row, plan: normalizeBillingPlan(row.plan) }))
    .filter((row) => !planFilter || row.plan === planFilter);
  const daysOnPlan = new Map<string, Map<string, number>>();
  for (const row of activeDays) {
    const plans = daysOnPlan.get(row.owner_id) ?? new Map<string, number>();
    const plan = normalizeBillingPlan(row.plan);
    plans.set(plan, (plans.get(plan) ?? 0) + row.days);
    daysOnPlan.set(row.owner_id, plans);
  }
  const revenueCents = (ownerId: string, plan: string): number => {
    const plans = daysOnPlan.get(ownerId);
    const all = [...(plans?.values() ?? [])].reduce((total, days) => total + days, 0);
    const share = all > 0 ? (plans?.get(plan) ?? 0) / all : 0;
    return PLAN_CATALOG[normalizeBillingPlan(plan)].monthlyPriceCents * (range.days / DAYS_PER_MONTH) * share;
  };

  const overall = emptyTotals();
  const owners = new Map<string, Map<string, OwnerPlan>>();
  for (const row of rows) {
    add(overall, row);
    const plans = owners.get(row.owner_id) ?? new Map<string, OwnerPlan>();
    const entry = plans.get(row.plan) ?? { totals: emptyTotals() };
    add(entry.totals, row);
    plans.set(row.plan, entry);
    owners.set(row.owner_id, plans);
  }
  const ownerCosts = [...owners.values()].map((plans) =>
    [...plans.values()].reduce((total, entry) => total + entry.totals.variableCost + entry.totals.fixedInfraCost, 0),
  );
  let overallRevenueCents = 0;
  for (const [ownerId, plans] of owners) {
    for (const plan of plans.keys()) overallRevenueCents += revenueCents(ownerId, plan);
  }

  const margin = (revenue: number, totals: Totals) => ({
    revenueEstimateUsd: Number((revenue / 100).toFixed(2)),
    marginAfterVariableUsd: Number((revenue / 100 - usd(totals.variableCost)).toFixed(4)),
    marginAllInUsd: Number((revenue / 100 - usd(totals.variableCost + totals.fixedInfraCost)).toFixed(4)),
  });

  let groups: unknown[];
  if (groupBy === "plan") {
    const byPlan = new Map<string, { totals: Totals; revenue: number; ownerCosts: number[] }>();
    for (const [ownerId, plans] of owners) {
      for (const [plan, entry] of plans) {
        const group = byPlan.get(plan) ?? { totals: emptyTotals(), revenue: 0, ownerCosts: [] };
        for (const key of Object.keys(group.totals) as Array<keyof Totals>) group.totals[key] += entry.totals[key];
        group.revenue += revenueCents(ownerId, plan);
        group.ownerCosts.push(entry.totals.variableCost + entry.totals.fixedInfraCost);
        byPlan.set(plan, group);
      }
    }
    groups = [...byPlan.entries()]
      .sort(([a], [b]) => PLAN_CATALOG[normalizeBillingPlan(a)].monthlyPriceCents - PLAN_CATALOG[normalizeBillingPlan(b)].monthlyPriceCents)
      .map(([plan, group]) => ({
        plan,
        monthlyPriceCents: PLAN_CATALOG[normalizeBillingPlan(plan)].monthlyPriceCents,
        monthlyBudgetUsd: PLAN_CATALOG[normalizeBillingPlan(plan)].budget.monthlyUsd,
        ...totalsUsd(group.totals),
        ...margin(group.revenue, group.totals),
        perOwnerAllInCost: distribution(group.ownerCosts),
      }));
  } else if (groupBy === "category") {
    const byCategory = new Map<string, { totals: Totals; owners: Set<string>; basis: Map<string, number> }>();
    for (const row of rows) {
      const group = byCategory.get(row.category) ?? { totals: emptyTotals(), owners: new Set(), basis: new Map() };
      add(group.totals, row);
      group.owners.add(row.owner_id);
      group.basis.set(row.basis, (group.basis.get(row.basis) ?? 0) + row.provider_cost);
      byCategory.set(row.category, group);
    }
    groups = [...byCategory.entries()]
      .map(([category, group]) => ({
        category,
        owners: group.owners.size,
        providerCostUsd: usd(group.totals.variableCost + group.totals.fixedInfraCost),
        chargedUsd: usd(group.totals.charged),
        attempts: group.totals.attempts,
        failures: group.totals.failures,
        costByBasisUsd: Object.fromEntries([...group.basis].map(([basis, cost]) => [basis, usd(cost)])),
        sortKey: group.totals.variableCost + group.totals.fixedInfraCost,
      }))
      .sort((a, b) => b.sortKey - a.sortKey)
      .map(({ sortKey: _sortKey, ...group }) => group);
  } else {
    groups = [...owners.entries()]
      .map(([ownerId, plans]) => {
        const totals = emptyTotals();
        let revenue = 0;
        for (const [plan, entry] of plans) {
          for (const key of Object.keys(totals) as Array<keyof Totals>) totals[key] += entry.totals[key];
          revenue += revenueCents(ownerId, plan);
        }
        return { ownerId, plans: [...plans.keys()], totals, revenue };
      })
      .sort((a, b) => b.totals.variableCost + b.totals.fixedInfraCost - (a.totals.variableCost + a.totals.fixedInfraCost))
      .slice(0, limit)
      .map((owner) => ({
        ownerId: owner.ownerId,
        plans: owner.plans,
        ...totalsUsd(owner.totals),
        ...margin(owner.revenue, owner.totals),
      }));
  }

  return json({
    range,
    groupBy,
    ...(planFilter ? { plan: planFilter } : {}),
    totals: { ...totalsUsd(overall), ...margin(overallRevenueCents, overall) },
    fixedInfra: {
      costUsd: usd(overall.fixedInfraCost),
      ownerDays: rows.filter((row) => row.category === "infra_fixed").reduce((total, row) => total + row.days, 0),
    },
    perOwnerAllInCost: distribution(ownerCosts),
    groups,
  });
};
