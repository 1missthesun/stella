-- Per-owner daily cost rollups copied from each owner DO's billing_cost_daily
-- (src/owner-store/domains/billing-costs.ts). Rows hold running totals, so the
-- export upserts them whole and replays are harmless. Money is micro-cents.
CREATE TABLE owner_cost_daily (
  owner_id TEXT NOT NULL,
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
  PRIMARY KEY (owner_id, day, category, provider, sku, basis, plan, tariff_version)
);

CREATE INDEX owner_cost_daily_day ON owner_cost_daily (day);
