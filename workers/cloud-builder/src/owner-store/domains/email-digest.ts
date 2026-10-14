import type {
  EmailDigest,
  EmailDigestFeed,
  EmailDigestItem,
  EmailDigestNotice,
  EmailDigestOutcome,
} from "@stella/contracts/backend/email-digest";
import { ComposioHttpError, composioConfig, composioToolkitConnected } from "../../integrations/composio.js";
import {
  GMAIL_INTEGRATION_ID,
  type GmailMessage,
  fetchGmailSince,
  pickImportant,
} from "../../integrations/gmail-digest.js";
import { empty } from "../args.js";
import { claudeCloudAccount } from "./engines.js";
import { enforceOwnerRateLimit } from "../rate-limit.js";
import type { OwnerContext, OwnerDbReader, OwnerDomain } from "../registry.js";

const RUN_JOB = "emailDigest.run";
const MIN = 60_000;
const HOUR = 60 * MIN;
export const MIN_INTERVAL_MS = HOUR;
export const MAX_INTERVAL_MS = 8 * HOUR;
const FIRST_RUN_DELAY_MS = 2_000;
const FIRST_WINDOW_MS = 24 * HOUR;
const OVERLAP_MS = 10 * MIN;
const MESSAGES_PER_RUN = 4;
const RATE_WEIGHT = 0.5;
const SEEN_RETENTION_MS = 3 * 24 * HOUR;
const KEPT_DIGESTS = 50;
const FEED_DIGESTS = 30;
const STALE_RUN_MS = 5 * MIN;
const MAX_FRESH_PER_RUN = 30;
const MAX_PAGES_PER_RUN = 5;
const CONTINUE_DELAY_MS = MIN;

export const EMAIL_DIGEST_MIGRATION = {
  id: "emailDigest.1-init",
  statements: [
    `CREATE TABLE email_digest_state (
       id INTEGER PRIMARY KEY CHECK (id = 1),
       enabled INTEGER NOT NULL,
       running_since INTEGER,
       last_checked_at INTEGER,
       last_outcome TEXT,
       last_error TEXT,
       next_check_at INTEGER,
       rate_per_hour REAL,
       updated_at INTEGER NOT NULL
     )`,
    `CREATE TABLE email_digests (
       digest_id TEXT PRIMARY KEY,
       created_at INTEGER NOT NULL,
       new_count INTEGER NOT NULL,
       items_json TEXT NOT NULL,
       model TEXT
     )`,
    "CREATE INDEX email_digests_by_time ON email_digests (created_at)",
    `CREATE TABLE email_digest_seen (
       message_id TEXT PRIMARY KEY,
       seen_at INTEGER NOT NULL
     )`,
  ],
};

export const EMAIL_DIGEST_WINDOW_MIGRATION = {
  id: "emailDigest.2-window",
  statements: [
    "ALTER TABLE email_digest_state ADD COLUMN window_since INTEGER",
    "ALTER TABLE email_digest_state ADD COLUMN window_end INTEGER",
    "ALTER TABLE email_digest_state ADD COLUMN window_count INTEGER",
    "ALTER TABLE email_digest_state ADD COLUMN page_token TEXT",
  ],
};

export const EMAIL_DIGEST_NOTICE_MIGRATION = {
  id: "emailDigest.3-notice",
  statements: ["ALTER TABLE email_digest_state ADD COLUMN notice_json TEXT"],
};

type StateRow = {
  enabled: number;
  running_since: number | null;
  last_checked_at: number | null;
  last_outcome: string | null;
  last_error: string | null;
  next_check_at: number | null;
  rate_per_hour: number | null;
  window_since: number | null;
  window_end: number | null;
  window_count: number | null;
  page_token: string | null;
  notice_json: string | null;
};

const stateOf = (db: OwnerDbReader): StateRow | null =>
  db.one<StateRow>(
    `SELECT enabled, running_since, last_checked_at, last_outcome, last_error, next_check_at, rate_per_hour,
            window_since, window_end, window_count, page_token, notice_json
       FROM email_digest_state WHERE id = 1`,
  );

const noticeOf = (json: string | null): EmailDigestNotice | undefined => {
  if (!json) return undefined;
  try {
    const parsed = JSON.parse(json) as EmailDigestNotice;
    return parsed && (parsed.kind === "claude_usage_limit" || parsed.kind === "claude_failed") ? parsed : undefined;
  } catch {
    return undefined;
  }
};

const gmailSession = (db: OwnerDbReader): string | null =>
  db.one<{ session_id: string }>(
    "SELECT session_id FROM integration_connections WHERE integration_id = ?",
    GMAIL_INTEGRATION_ID,
  )?.session_id ?? null;

const scheduleRun = (ctx: OwnerContext, at: number): void => {
  ctx.jobs.schedule(RUN_JOB, at, {}, { id: RUN_JOB });
  ctx.db.run("UPDATE email_digest_state SET next_check_at = ?, updated_at = ? WHERE id = 1", at, ctx.now);
};

export const startEmailDigest = (ctx: OwnerContext): void => {
  const state = stateOf(ctx.db);
  if (state?.enabled === 1 && state.next_check_at !== null) return;
  ctx.db.run(
    `INSERT INTO email_digest_state (id, enabled, updated_at) VALUES (1, 1, ?)
     ON CONFLICT (id) DO UPDATE SET enabled = 1, last_error = NULL, updated_at = excluded.updated_at`,
    ctx.now,
  );
  scheduleRun(ctx, ctx.now + FIRST_RUN_DELAY_MS);
};

const gmailConnected = async (ctx: OwnerContext): Promise<boolean> => {
  const sessionId = gmailSession(ctx.db);
  const config = composioConfig(ctx.env);
  if (!sessionId || !config) return false;
  try {
    return await composioToolkitConnected(config, sessionId, GMAIL_INTEGRATION_ID);
  } catch (error) {
    if (error instanceof ComposioHttpError && error.status === 404) return false;
    throw error;
  }
};

export const nextInterval = (ratePerHour: number): number =>
  ratePerHour <= 0
    ? MAX_INTERVAL_MS
    : Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, (MESSAGES_PER_RUN / ratePerHour) * HOUR));

const errorText = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/gu, " ").slice(0, 300);
};

const finishRun = (
  ctx: OwnerContext,
  outcome: {
    kind: EmailDigestOutcome;
    error?: string;
    newCount: number;
    since: number;
    checkedAt?: number;
    rate: number | null;
  },
): void => {
  const now = Date.now();
  const hours = Math.max((now - outcome.since) / HOUR, 0.25);
  const observed = outcome.kind === "error" ? null : outcome.newCount / hours;
  const rate =
    observed === null
      ? (outcome.rate ?? 0)
      : outcome.rate === null
        ? observed
        : outcome.rate * (1 - RATE_WEIGHT) + observed * RATE_WEIGHT;
  const interval = outcome.kind === "error" ? MIN_INTERVAL_MS * 2 : nextInterval(rate);
  ctx.db.run(
    `UPDATE email_digest_state SET running_since = NULL, last_checked_at = CASE WHEN ? THEN last_checked_at ELSE ? END,
       window_since = CASE WHEN ? THEN window_since ELSE NULL END,
       window_end = CASE WHEN ? THEN window_end ELSE NULL END,
       window_count = CASE WHEN ? THEN window_count ELSE NULL END,
       page_token = NULL,
       last_outcome = ?, last_error = ?, rate_per_hour = ?, updated_at = ? WHERE id = 1`,
    outcome.kind === "error" ? 1 : 0,
    outcome.checkedAt ?? now,
    outcome.kind === "error" ? 1 : 0,
    outcome.kind === "error" ? 1 : 0,
    outcome.kind === "error" ? 1 : 0,
    outcome.kind,
    outcome.error ?? null,
    rate,
    now,
  );
  scheduleRun({ ...ctx, now }, now + interval);
};

const recordDigest = (ctx: OwnerContext, newCount: number, items: EmailDigestItem[], model: string): void => {
  const now = Date.now();
  ctx.db.run(
    "INSERT INTO email_digests (digest_id, created_at, new_count, items_json, model) VALUES (?, ?, ?, ?, ?)",
    `ed-${crypto.randomUUID()}`,
    now,
    newCount,
    JSON.stringify(items),
    model,
  );
  ctx.db.run(
    `DELETE FROM email_digests WHERE digest_id NOT IN
       (SELECT digest_id FROM email_digests ORDER BY created_at DESC LIMIT ?)`,
    KEPT_DIGESTS,
  );
};

const disableDisconnected = (ctx: OwnerContext): void => {
  ctx.db.run(
    `UPDATE email_digest_state SET enabled = 0, running_since = NULL, next_check_at = NULL, page_token = NULL,
       last_outcome = 'error', last_error = 'Gmail is not connected.', updated_at = ? WHERE id = 1`,
    Date.now(),
  );
};

const continueWindow = (
  ctx: OwnerContext,
  window: { since: number; end: number; count: number; pageToken: string; outcome: EmailDigestOutcome },
): void => {
  const now = Date.now();
  ctx.db.run(
    `UPDATE email_digest_state SET running_since = NULL, window_since = ?, window_end = ?, window_count = ?,
       page_token = ?, last_outcome = ?, last_error = NULL, updated_at = ? WHERE id = 1`,
    window.since,
    window.end,
    window.count,
    window.pageToken,
    window.outcome,
    now,
  );
  scheduleRun({ ...ctx, now }, now + CONTINUE_DELAY_MS);
};

const judge = async (
  ctx: OwnerContext,
  state: StateRow,
  fresh: GmailMessage[],
  cli?: string,
): Promise<{ outcome: EmailDigestOutcome; model: string; notice?: EmailDigestNotice }> => {
  const snapshot = await ctx.host.snapshot();
  const claude = snapshot.execution.engine === "anthropic" ? await claudeCloudAccount(ctx) : null;
  const held = noticeOf(state.notice_json);
  const { verdict, model, notice } = await pickImportant({
    claudeAccount: claude && !("missing" in claude) ? claude : null,
    ...(held?.kind === "claude_usage_limit" && held.resetsAt !== undefined ? { claudeHeldUntil: held.resetsAt } : {}),
    ...(cli ? { claudeCli: cli } : {}),
    env: ctx.env,
    ownerId: ctx.ownerId,
    ownerGeneration: snapshot.ownerGeneration,
    runId: crypto.randomUUID(),
    execution: snapshot.execution,
    audience: snapshot.allowance.audience,
    budgetMicroCents: snapshot.allowance.budgetMicroCents,
    messages: fresh,
  });
  ctx.db.run("UPDATE email_digest_state SET notice_json = ? WHERE id = 1", notice ? JSON.stringify(notice) : null);
  const seenAt = Date.now();
  for (const message of fresh) {
    ctx.db.run("INSERT OR IGNORE INTO email_digest_seen (message_id, seen_at) VALUES (?, ?)", message.id, seenAt);
  }
  ctx.db.run("DELETE FROM email_digest_seen WHERE seen_at < ?", seenAt - SEEN_RETENTION_MS);
  if (verdict.kind === "important") recordDigest(ctx, fresh.length, verdict.items, model);
  return {
    outcome: verdict.kind === "important" ? "digest" : "nothing_important",
    model,
    ...(notice ? { notice } : {}),
  };
};

const runDigest = async (ctx: OwnerContext): Promise<void> => {
  const state = stateOf(ctx.db);
  if (!state || state.enabled !== 1) return;
  if (state.running_since !== null && ctx.now - state.running_since < STALE_RUN_MS) return;
  const since =
    state.window_since ??
    (state.last_checked_at === null ? ctx.now - FIRST_WINDOW_MS : state.last_checked_at - OVERLAP_MS);
  const windowEnd = state.window_end ?? ctx.now;
  const priorCount = state.window_count ?? 0;
  const sessionId = gmailSession(ctx.db);
  const config = composioConfig(ctx.env);
  let connected: boolean;
  try {
    connected = Boolean(sessionId && config) && (await gmailConnected(ctx));
  } catch (error) {
    console.error(JSON.stringify({ event: "email_digest_probe_failed", message: errorText(error) }));
    finishRun(ctx, { kind: "error", error: errorText(error), newCount: 0, since, rate: state.rate_per_hour });
    return;
  }
  if (!sessionId || !config || !connected) {
    disableDisconnected(ctx);
    return;
  }
  ctx.db.run(
    "UPDATE email_digest_state SET running_since = ?, window_since = ?, window_end = ?, updated_at = ? WHERE id = 1",
    ctx.now,
    since,
    windowEnd,
    ctx.now,
  );
  let newCount = 0;
  try {
    const fresh: GmailMessage[] = [];
    const taken = new Set<string>();
    let pageToken = state.page_token ?? undefined;
    let pages = 0;
    do {
      const page = await fetchGmailSince(config, sessionId, since, pageToken);
      pages += 1;
      for (const message of page.messages) {
        if (taken.has(message.id)) continue;
        if (message.receivedAt !== undefined && message.receivedAt < since) continue;
        if (ctx.db.one("SELECT 1 AS seen FROM email_digest_seen WHERE message_id = ?", message.id)) continue;
        taken.add(message.id);
        fresh.push(message);
      }
      pageToken = page.nextPageToken;
    } while (pageToken && fresh.length < MAX_FRESH_PER_RUN && pages < MAX_PAGES_PER_RUN);
    newCount = fresh.length;
    const outcome: EmailDigestOutcome = fresh.length > 0 ? (await judge(ctx, state, fresh)).outcome : "nothing_new";
    if (pageToken) {
      continueWindow(ctx, { since, end: windowEnd, count: priorCount + newCount, pageToken, outcome });
      return;
    }
    finishRun(ctx, {
      kind: outcome,
      newCount: priorCount + newCount,
      since,
      checkedAt: windowEnd,
      rate: state.rate_per_hour,
    });
  } catch (error) {
    console.error(JSON.stringify({ event: "email_digest_run_failed", message: errorText(error) }));
    finishRun(ctx, { kind: "error", error: errorText(error), newCount, since, rate: state.rate_per_hour });
  }
};

const parseItems = (json: string): EmailDigestItem[] => {
  try {
    const parsed = JSON.parse(json) as unknown;
    return Array.isArray(parsed) ? (parsed as EmailDigestItem[]) : [];
  } catch {
    return [];
  }
};

const readFeed = (db: OwnerDbReader, now: number): EmailDigestFeed => {
  const state = stateOf(db);
  const digests: EmailDigest[] = db
    .all<{ digest_id: string; created_at: number; new_count: number; items_json: string }>(
      "SELECT digest_id, created_at, new_count, items_json FROM email_digests ORDER BY created_at DESC LIMIT ?",
      FEED_DIGESTS,
    )
    .map((row) => ({
      digestId: row.digest_id,
      createdAt: row.created_at,
      newCount: row.new_count,
      items: parseItems(row.items_json),
    }));
  const outcome = state?.last_outcome as EmailDigestOutcome | null | undefined;
  const notice = noticeOf(state?.notice_json ?? null);
  return {
    status: {
      enabled: state?.enabled === 1,
      running: state?.running_since != null && now - state.running_since < STALE_RUN_MS,
      ...(state?.last_checked_at != null ? { lastCheckedAt: state.last_checked_at } : {}),
      ...(outcome ? { lastOutcome: outcome } : {}),
      ...(state?.last_error ? { lastError: state.last_error } : {}),
      ...(state?.next_check_at != null ? { nextCheckAt: state.next_check_at } : {}),
      ...(notice ? { notice } : {}),
    },
    digests,
  };
};

const probeMessages = (value: unknown): GmailMessage[] =>
  (Array.isArray(value) ? value : []).slice(0, MAX_FRESH_PER_RUN).flatMap((raw, index) => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Record<string, unknown>;
    const field = (key: string) => (typeof row[key] === "string" ? (row[key] as string).slice(0, 400) : "");
    return [
      {
        id: field("id") || `probe-${crypto.randomUUID()}-${index}`,
        from: field("from") || "Unknown sender",
        subject: field("subject") || "(no subject)",
        snippet: field("snippet"),
        receivedAt: Date.now(),
        important: row.important === true,
        starred: false,
      },
    ];
  });

const probe = async (ctx: OwnerContext, args: unknown) => {
  const input = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const fresh = probeMessages(input.messages);
  if (fresh.length === 0) throw new Error("Need messages.");
  ctx.db.run(
    `INSERT INTO email_digest_state (id, enabled, updated_at) VALUES (1, 1, ?) ON CONFLICT (id) DO NOTHING`,
    ctx.now,
  );
  const state = stateOf(ctx.db);
  if (!state) throw new Error("No digest state.");
  const cli = typeof input.cli === "string" && input.cli.startsWith("/tmp/") ? input.cli : undefined;
  const judged = await judge(ctx, state, fresh, cli);
  ctx.db.run(
    "UPDATE email_digest_state SET last_outcome = ?, last_checked_at = ?, last_error = NULL, updated_at = ? WHERE id = 1",
    judged.outcome,
    Date.now(),
    Date.now(),
  );
  return { ...judged, feed: readFeed(ctx.db, Date.now()) };
};

const start = async (ctx: OwnerContext): Promise<{ connected: boolean }> => {
  const connected = await gmailConnected(ctx);
  if (connected) startEmailDigest(ctx);
  return { connected };
};

const checkNow = async (ctx: OwnerContext): Promise<{ connected: boolean }> => {
  enforceOwnerRateLimit(
    ctx.db,
    ctx.now,
    "emailDigest.checkNow",
    { count: 10, windowMs: 10 * MIN },
    "Checked recently. Try again in a few minutes.",
  );
  const connected = await gmailConnected(ctx);
  if (!connected) return { connected };
  startEmailDigest(ctx);
  scheduleRun(ctx, ctx.now);
  return { connected };
};

export const emailDigestDomain = {
  name: "emailDigest",
  migrations: [EMAIL_DIGEST_MIGRATION, EMAIL_DIGEST_WINDOW_MIGRATION, EMAIL_DIGEST_NOTICE_MIGRATION],
  calls: {
    "emailDigest.start": {
      scope: "owner",
      parse: empty(),
      handler: start,
    },
    "emailDigest.checkNow": {
      scope: "owner",
      parse: empty(),
      handler: checkNow,
    },
  },
  views: {
    "emailDigest.feed": {
      parse: empty(),
      read: (ctx) => readFeed(ctx.db, ctx.now),
    },
  },
  internal: {
    "emailDigest.probe": probe,
  },
  jobs: {
    [RUN_JOB]: { run: (ctx) => runDigest(ctx), maxAttempts: 3 },
  },
  purge: (ctx) => {
    ctx.jobs.cancel(RUN_JOB);
    ctx.db.run("DELETE FROM email_digests");
    ctx.db.run("DELETE FROM email_digest_seen");
    ctx.db.run("DELETE FROM email_digest_state");
    return { pending: false };
  },
} satisfies OwnerDomain;
