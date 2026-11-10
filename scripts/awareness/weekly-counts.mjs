#!/usr/bin/env node
// Weekly awareness numbers: anonymous install counts (telemetry worker),
// stella.sh/r/<source> short-link hits (website worker), and Cloudflare Web
// Analytics referrers for stella.sh.
//
//   node scripts/awareness/weekly-counts.mjs            # production, last 7 days
//   node scripts/awareness/weekly-counts.mjs --dev      # dev datasets
//   node scripts/awareness/weekly-counts.mjs --days 14  # wider window
//   node scripts/awareness/weekly-counts.mjs --json
//
// Credentials (never printed): the Analytics Engine queries use
// CLOUDFLARE_API_TOKEN, else the token file below, else wrangler's own login
// (`wrangler auth token`). Web Analytics (RUM) needs an API token with
// "Account Analytics: Read" (env CLOUDFLARE_ANALYTICS_TOKEN or the token file,
// ~/.config/stella-dev/cloudflare-analytics-token on omarchy: Cloudflare user
// token "stella-agents-analytics-read"); wrangler's login cannot read RUM, so
// that section is skipped without one.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ACCOUNT_ID = "f34b91c9c7dc22f0aef0ba855a9f026f";
const RUM_SITE_TAG = "0b9ef09028c9477aa51197a9e9279a79";
const TOKEN_FILE = path.join(os.homedir(), ".config", "stella-dev", "cloudflare-analytics-token");
const DAY_MS = 24 * 60 * 60_000;

const args = process.argv.slice(2);
const dev = args.includes("--dev");
const asJson = args.includes("--json");
const daysArg = args.indexOf("--days");
const days = daysArg >= 0 ? Math.max(1, Math.min(60, Number(args[daysArg + 1]) || 7)) : 7;
const COUNTS = dev ? "stella_anonymous_counts_dev" : "stella_anonymous_counts";
const SHORT_LINKS = dev ? "stella_short_links_dev" : "stella_short_links";
// Analytics Engine can't delete rows. The 12 prod hits before this time were
// our own launch tests (2026-11-10 07:31–07:52 UTC), so prod counts start here.
const SHORT_LINKS_SINCE = dev ? "1970-01-01 00:00:00" : "2026-11-10 08:00:00";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const readTokenFile = () => {
  try {
    return readFileSync(TOKEN_FILE, "utf8").trim() || null;
  } catch {
    return null;
  }
};

const wranglerToken = () => {
  const candidates = [
    path.join(repoRoot, "workers/telemetry/node_modules/.bin/wrangler"),
    path.join(repoRoot, "node_modules/.bin/wrangler"),
  ].filter((file) => existsSync(file));
  for (const bin of candidates) {
    try {
      const out = execFileSync(bin, ["auth", "token", "--json"], {
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 60_000,
      }).toString();
      const token = JSON.parse(out).token;
      if (typeof token === "string" && token) return token;
    } catch {
      // Try the next install.
    }
  }
  return null;
};

const analyticsToken = process.env.CLOUDFLARE_ANALYTICS_TOKEN?.trim() || readTokenFile();
const engineToken = process.env.CLOUDFLARE_API_TOKEN?.trim() || analyticsToken || wranglerToken();

const sql = async (query) => {
  if (!engineToken) throw new Error("no Cloudflare credential for Analytics Engine");
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/analytics_engine/sql`,
    { method: "POST", headers: { authorization: `Bearer ${engineToken}` }, body: query },
  );
  const text = await response.text();
  if (!response.ok) throw new Error(`Analytics Engine ${response.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text).data ?? [];
};

// A dataset that has never been written does not exist yet; treat it as empty.
const sqlOrEmpty = async (query) => {
  try {
    return { rows: await sql(query), error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/unknown table|does not exist|UNKNOWN_TABLE/i.test(message)) return { rows: [], error: null };
    return { rows: [], error: message };
  }
};

const tally = (values) => {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Object.fromEntries([...counts].sort((a, b) => b[1] - a[1]));
};

const now = Date.now();
const windowStart = now - days * DAY_MS;

const installCounts = async () => {
  // Rows are tiny (one per event); 60 days covers the cohort for 7-day return.
  const { rows, error } = await sqlOrEmpty(
    `SELECT index1 AS install, blob1 AS type, blob2 AS detail, blob3 AS platform, double1 AS at, _sample_interval AS weight
     FROM ${COUNTS}
     WHERE timestamp > NOW() - INTERVAL '${Math.max(days * 2, 14) + 1}' DAY
     LIMIT 100000 FORMAT JSON`,
  );
  if (error) return { error };
  const byInstall = new Map();
  for (const row of rows) {
    const entry = byInstall.get(row.install) ?? { events: [] };
    entry.events.push({ type: row.type, detail: row.detail, platform: row.platform, at: Number(row.at) });
    byInstall.set(row.install, entry);
  }
  const firstOf = (events, type) =>
    events.filter((event) => event.type === type).sort((a, b) => a.at - b.at)[0] ?? null;

  const newInstalls = [];
  const startedCounting = [];
  const engineChosen = [];
  const firstReplies = [];
  const foundVia = [];
  const activeInWindow = new Set();
  const cohort = { size: 0, returned: 0 };
  for (const [install, { events }] of byInstall) {
    const firstRun = firstOf(events, "first_run");
    if (firstRun && firstRun.at >= windowStart) {
      (firstRun.detail === "new" ? newInstalls : startedCounting).push(firstRun.platform);
    }
    const chosen = firstOf(events, "engine_chosen");
    if (chosen && chosen.at >= windowStart) engineChosen.push(chosen.detail);
    const reply = firstOf(events, "first_reply");
    if (reply && reply.at >= windowStart) firstReplies.push(reply.detail);
    const answer = firstOf(events, "found_via");
    if (answer && answer.at >= windowStart) foundVia.push(answer.detail);
    if (events.some((event) => event.type === "active_day" && event.at >= windowStart)) activeInWindow.add(install);
    // 7-day return: installs from 8-14 days ago that were opened on another
    // local day within their first 7 days (one active_day per local day).
    if (firstRun?.detail === "new" && firstRun.at <= now - 8 * DAY_MS && firstRun.at > now - 15 * DAY_MS) {
      cohort.size += 1;
      const activeDays = events.filter(
        (event) => event.type === "active_day" && event.at >= firstRun.at - 60_000 && event.at <= firstRun.at + 7 * DAY_MS,
      ).length;
      if (activeDays >= 2) cohort.returned += 1;
    }
  }
  return {
    installs: { new: newInstalls.length, byPlatform: tally(newInstalls), existingStartedCounting: startedCounting.length },
    activeInstalls: activeInWindow.size,
    engineChosen: tally(engineChosen),
    firstReplies: { total: firstReplies.length, byEngine: tally(firstReplies) },
    activation: newInstalls.length
      ? `${firstReplies.length} first replies / ${newInstalls.length} new installs`
      : "no new installs",
    sevenDayReturn: cohort.size
      ? { cohort: cohort.size, returned: cohort.returned, rate: `${Math.round((100 * cohort.returned) / cohort.size)}%` }
      : { cohort: 0, note: "no installs 8-14 days ago yet" },
    foundVia: tally(foundVia),
    // Analytics Engine samples bursts from one install; true means some rows stand for several events.
    sampled: rows.some((row) => Number(row.weight) > 1),
  };
};

const shortLinkHits = async () => {
  const { rows, error } = await sqlOrEmpty(
    `SELECT blob1 AS source, blob2 AS country, blob3 AS referrer, SUM(_sample_interval) AS hits
     FROM ${SHORT_LINKS}
     WHERE timestamp > NOW() - INTERVAL '${days}' DAY
       AND timestamp >= toDateTime('${SHORT_LINKS_SINCE}')
     GROUP BY source, country, referrer
     FORMAT JSON`,
  );
  if (error) return { error };
  const sum = (key) => {
    const totals = new Map();
    for (const row of rows) totals.set(row[key] || "(none)", (totals.get(row[key] || "(none)") ?? 0) + Number(row.hits));
    return Object.fromEntries([...totals].sort((a, b) => b[1] - a[1]));
  };
  return { bySource: sum("source"), byCountry: sum("country"), byReferrer: sum("referrer") };
};

const rumReferrers = async () => {
  if (!analyticsToken) {
    return {
      skipped: `needs an API token with Account Analytics: Read in CLOUDFLARE_ANALYTICS_TOKEN or ${TOKEN_FILE}`,
    };
  }
  const query = `query ($account: string!, $filter: AccountRumPageloadEventsAdaptiveGroupsFilter_InputObject!) {
    viewer { accounts(filter: { accountTag: $account }) {
      referrers: rumPageloadEventsAdaptiveGroups(limit: 30, filter: $filter, orderBy: [sum_visits_DESC]) {
        count sum { visits } dimensions { refererHost }
      }
      paths: rumPageloadEventsAdaptiveGroups(limit: 15, filter: $filter, orderBy: [sum_visits_DESC]) {
        count sum { visits } dimensions { requestPath }
      }
    } } }`;
  const variables = {
    account: ACCOUNT_ID,
    filter: {
      siteTag: RUM_SITE_TAG,
      datetime_geq: new Date(windowStart).toISOString(),
      datetime_leq: new Date(now).toISOString(),
      bot: 0,
    },
  };
  const response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST",
    headers: { authorization: `Bearer ${analyticsToken}`, "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.errors?.length) {
    return { error: `GraphQL ${response.status}: ${JSON.stringify(body?.errors ?? body).slice(0, 300)}` };
  }
  const account = body?.data?.viewer?.accounts?.[0] ?? {};
  const visits = (group, key) =>
    Object.fromEntries((group ?? []).map((row) => [row.dimensions[key] || "(no referrer)", row.sum.visits]));
  const referrers = visits(account.referrers, "refererHost");
  const total = Object.values(referrers).reduce((a, b) => a + b, 0);
  return {
    visits: total,
    noReferrerShare: total ? `${Math.round((100 * (referrers["(no referrer)"] ?? 0)) / total)}%` : "n/a",
    referrers,
    topPages: visits(account.paths, "requestPath"),
  };
};

const [counts, shortLinks, rum] = await Promise.all([
  installCounts().catch((error) => ({ error: String(error?.message ?? error) })),
  shortLinkHits().catch((error) => ({ error: String(error?.message ?? error) })),
  rumReferrers().catch((error) => ({ error: String(error?.message ?? error) })),
]);

const report = {
  window: `${new Date(windowStart).toISOString().slice(0, 10)} → ${new Date(now).toISOString().slice(0, 10)} (${days} days, ${dev ? "dev" : "production"})`,
  installCounts: counts,
  shortLinkHits: shortLinks,
  webAnalyticsReferrers: rum,
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const show = (title, value) => {
    console.log(`\n${title}`);
    console.log(`${"-".repeat(title.length)}`);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [key, inner] of Object.entries(value)) {
        const rendered =
          inner && typeof inner === "object"
            ? Object.entries(inner).map(([k, v]) => `${k} ${typeof v === "object" ? JSON.stringify(v) : v}`).join(", ") || "none"
            : String(inner);
        console.log(`  ${key}: ${rendered}`);
      }
    } else {
      console.log(`  ${value}`);
    }
  };
  console.log(`Stella weekly counts — ${report.window}`);
  show("Installs and activation (anonymous counts)", counts);
  show("stella.sh/r/ short-link hits", shortLinks);
  show("stella.sh Web Analytics referrers", rum);
}
