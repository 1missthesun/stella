#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const usage = `Usage: node scripts/worker-logs.mjs [--worker <script>] [--minutes <n>] [--search <text>] [--limit <n>] [--json]

Reads stored Workers Logs (including Durable Object logs, which \`wrangler tail\` misses)
through the Workers Observability API.

  --worker   script name (default stella-v2-cloud-builder-dev)
  --minutes  look back this many minutes (default 30)
  --search   only events containing this text
  --limit    at most this many events (default 50, max 2000)
  --json     print raw events

Token: CLOUDFLARE_OBSERVABILITY_TOKEN, else ~/.config/stella-dev/cloudflare-observability-token
(an API token with Account > Workers Observability > Read). Account: CLOUDFLARE_ACCOUNT_ID,
else Stella's account.`;

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] !== undefined ? args[index + 1] : fallback;
};
if (args.includes("--help") || args.includes("-h")) {
  console.log(usage);
  process.exit(0);
}

const tokenFile = path.join(os.homedir(), ".config/stella-dev/cloudflare-observability-token");
const token =
  process.env.CLOUDFLARE_OBSERVABILITY_TOKEN?.trim() ||
  (existsSync(tokenFile) ? readFileSync(tokenFile, "utf8").trim() : "");
if (!token) {
  console.error(`No observability token. Set CLOUDFLARE_OBSERVABILITY_TOKEN or create ${tokenFile} (DEPLOY.md, "Reading Worker logs").`);
  process.exit(2);
}
const account = process.env.CLOUDFLARE_ACCOUNT_ID?.trim() || "f34b91c9c7dc22f0aef0ba855a9f026f";
const worker = flag("--worker", "stella-v2-cloud-builder-dev");
const minutes = Number(flag("--minutes", "30"));
const limit = Math.min(Number(flag("--limit", "50")), 2000);
const search = flag("--search", "");
const now = Date.now();

const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/observability/telemetry/query`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  body: JSON.stringify({
    queryId: "worker-logs-cli",
    timeframe: { from: now - minutes * 60_000, to: now },
    view: "events",
    limit,
    parameters: {
      ...(search ? { needle: { value: search } } : {}),
      filters: [{ key: "$metadata.service", operation: "eq", type: "string", value: worker }],
    },
  }),
});
const body = await response.json().catch(() => null);
if (!response.ok || !body?.success) {
  console.error(`Query failed: HTTP ${response.status} ${JSON.stringify(body?.errors ?? body).slice(0, 400)}`);
  process.exit(1);
}
const events = (body.result?.events?.events ?? []).sort((a, b) => a.timestamp - b.timestamp);
if (args.includes("--json")) {
  console.log(JSON.stringify(events, null, 2));
} else {
  for (const event of events) {
    const source = event.source ?? {};
    const text = typeof source === "string" ? source : source.message ?? source.event ?? JSON.stringify(source);
    const extra = typeof source === "object" ? Object.entries(source).filter(([key]) => !["message", "level"].includes(key)) : [];
    console.log(
      `${new Date(event.timestamp).toISOString()} ${source.level ?? event.$metadata?.level ?? ""} ${event.$workers?.durableObjectId ? "[DO] " : ""}${text}${extra.length ? ` ${JSON.stringify(Object.fromEntries(extra))}` : ""}`.slice(0, 1000),
    );
  }
  console.error(`${events.length} event(s) from ${worker} in the last ${minutes} min${search ? ` matching "${search}"` : ""}.`);
}
