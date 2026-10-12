import type {
  EmailDigest,
  EmailDigestFeed,
  EmailDigestItem,
  EmailDigestOutcome,
} from "@stella/contracts/backend/email-digest";
import { composioConfig, composioToolkitConnected } from "../../integrations/composio.js";
import { GMAIL_INTEGRATION_ID, fetchGmailSince, pickImportant } from "../../integrations/gmail-digest.js";
import { empty } from "../args.js";
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

type StateRow = {
  enabled: number;
  running_since: number | null;
  last_checked_at: number | null;
  last_outcome: string | null;
  last_error: string | null;
  next_check_at: number | null;
  rate_per_hour: number | null;
};

const stateOf = (db: OwnerDbReader): StateRow | null =>
  db.one<StateRow>(
    `SELECT enabled, running_since, last_checked_at, last_outcome, last_error, next_check_at, rate_per_hour
       FROM email_digest_state WHERE id = 1`,
  );

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
  } catch {
    return false;
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
  outcome: { kind: EmailDigestOutcome; error?: string; newCount: number; since: number; rate: number | null },
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
       last_outcome = ?, last_error = ?, rate_per_hour = ?, updated_at = ? WHERE id = 1`,
    outcome.kind === "error" ? 1 : 0,
    now,
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

const runDigest = async (ctx: OwnerContext): Promise<void> => {
  const state = stateOf(ctx.db);
  if (!state || state.enabled !== 1) return;
  if (state.running_since !== null && ctx.now - state.running_since < STALE_RUN_MS) return;
  const since = state.last_checked_at === null ? ctx.now - FIRST_WINDOW_MS : state.last_checked_at - OVERLAP_MS;
  const sessionId = gmailSession(ctx.db);
  const config = composioConfig(ctx.env);
  if (!sessionId || !config || !(await gmailConnected(ctx))) {
    ctx.db.run(
      `UPDATE email_digest_state SET enabled = 0, running_since = NULL, next_check_at = NULL,
         last_outcome = 'error', last_error = 'Gmail is not connected.', updated_at = ? WHERE id = 1`,
      Date.now(),
    );
    return;
  }
  ctx.db.run("UPDATE email_digest_state SET running_since = ?, updated_at = ? WHERE id = 1", ctx.now, ctx.now);
  let newCount = 0;
  try {
    const messages = await fetchGmailSince(config, sessionId, since);
    const fresh = messages.filter(
      (message) =>
        (message.receivedAt === undefined || message.receivedAt >= since) &&
        !ctx.db.one("SELECT 1 AS seen FROM email_digest_seen WHERE message_id = ?", message.id),
    );
    newCount = fresh.length;
    if (fresh.length === 0) {
      finishRun(ctx, { kind: "nothing_new", newCount, since, rate: state.rate_per_hour });
      return;
    }
    const snapshot = await ctx.host.snapshot();
    const { verdict, model } = await pickImportant({
      env: ctx.env,
      ownerId: ctx.ownerId,
      ownerGeneration: snapshot.ownerGeneration,
      runId: crypto.randomUUID(),
      execution: snapshot.execution,
      audience: snapshot.allowance.audience,
      budgetMicroCents: snapshot.allowance.budgetMicroCents,
      messages: fresh,
    });
    const seenAt = Date.now();
    for (const message of fresh) {
      ctx.db.run(
        "INSERT OR IGNORE INTO email_digest_seen (message_id, seen_at) VALUES (?, ?)",
        message.id,
        seenAt,
      );
    }
    ctx.db.run("DELETE FROM email_digest_seen WHERE seen_at < ?", seenAt - SEEN_RETENTION_MS);
    if (verdict.kind === "important") recordDigest(ctx, newCount, verdict.items, model);
    finishRun(ctx, {
      kind: verdict.kind === "important" ? "digest" : "nothing_important",
      newCount,
      since,
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
  return {
    status: {
      enabled: state?.enabled === 1,
      running: state?.running_since != null && now - state.running_since < STALE_RUN_MS,
      ...(state?.last_checked_at != null ? { lastCheckedAt: state.last_checked_at } : {}),
      ...(outcome ? { lastOutcome: outcome } : {}),
      ...(state?.last_error ? { lastError: state.last_error } : {}),
      ...(state?.next_check_at != null ? { nextCheckAt: state.next_check_at } : {}),
    },
    digests,
  };
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
  migrations: [EMAIL_DIGEST_MIGRATION],
  calls: {
    "emailDigest.start": {
      scope: "owner",
      requireAccount: true,
      parse: empty(),
      handler: start,
    },
    "emailDigest.checkNow": {
      scope: "owner",
      requireAccount: true,
      parse: empty(),
      handler: checkNow,
    },
  },
  views: {
    "emailDigest.feed": {
      requireAccount: true,
      parse: empty(),
      read: (ctx) => readFeed(ctx.db, ctx.now),
    },
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
