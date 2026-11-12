import {
  EMAIL_BUCKETS,
  EMAIL_PUSH_KIND,
  type EmailAccountStatus,
  type EmailBriefTone,
  type EmailBucket,
  type EmailHistory,
  type EmailHistoryDay,
  type EmailLogKind,
  type EmailMatter,
  type EmailNoiseSender,
  type EmailPrepared,
  type EmailSettledHow,
  type EmailToday,
  type EmailCalls,
  type EmailBrief,
  type EmailDigest,
  type EmailDigests,
  type EmailFocusAction,
  type EmailFound,
  type EmailSearchResult,
  type EmailTargets,
  type EmailThread,
  type EmailFeed,
  type EmailItem,
  type EmailItemState,
  type EmailPushData,
  type EmailReason,
  type EmailRule,
  type EmailStatus,
  type EmailUsage,
  type EmailAccess,
  type EmailPayer,
} from "@stella/contracts/backend/email";
import {
  EMAIL_CARD_MAX_ITEMS,
  EMAIL_CARD_TYPE,
  emailCardNoteText,
  emailFocusNoteText,
  type EmailCard,
  type EmailCardItem,
} from "@stella/contracts/email-card";
import type { OwnerSnapshot } from "@stella/contracts/turn-plane/owner-snapshot";
import { emailFeatureOnFor } from "@stella/contracts/email-feature";
import { GoogleApiError, gmailFetcher, runGoogleAction, type Fetcher } from "../../integrations/google.js";
import {
  addressesIn,
  parseAddress,
  gmailArchiveMany,
  gmailAttachmentBase64,
  gmailMarkRead,
  gmailWritingSamples,
  gmailHistorySince,
  gmailLabelsOf,
  gmailProfile,
  gmailReadMail,
  gmailReadThread,
  gmailSearch,
  gmailSentPeople,
  gmailSetInbox,
  gmailStopWatch,
  gmailWatch,
  type GmailMail,
  type GmailUnsubscribe,
} from "../../integrations/gmail-mail.js";
import {
  DECISION_INPUT_USD_PER_M,
  DEFAULT_NOTE,
  DecisionRefused,
  NOTE_MAX_CHARS,
  gmailQueryFor,
  rewriteNote,
  sortEmail,
  writeMatters,
  writeTodayLead,
  writeVoiceReply,
  type MatterEmail,
  type MatterOutput,
  type SorterAccess,
  type SortVerdict,
} from "../../integrations/email-sorter.js";
import { array, boolean, empty, literal, number, object, optional, string } from "../args.js";
import { RpcError } from "../errors.js";
import { enforceOwnerRateLimit } from "../rate-limit.js";
import type { InternalDef, JobDef, OwnerContext, OwnerDbReader, OwnerDomain, OwnerViewContext } from "../registry.js";
import { BillingConfigError } from "../../billing/plans.js";
import { billingAccess } from "./billing.js";
import { readMainConversationId } from "./conversations.js";
import { livePushTokens, sendPushMessages } from "./devices.js";
import { stellaGmailTokens, stellaGoogleAccounts, stellaGoogleAvailable } from "./google-accounts.js";
import { ownerZone } from "./schedules.js";
import { ownerModeEnabled } from "../../selfhost/owner-mode.js";

const SYNC_JOB = "email.sync";
const TICK_JOB = "email.tick";
const SUMMARY_JOB = "email.summary";
/** A summary the user asked for (Check now, turning on), kept apart so a routine check can't replace it. */
const SUMMARY_NOW_ID = "email.summary:now";
const NOTE_JOB = "email.note";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const TICK_LIVE_MS = 30 * MIN;
const TICK_POLL_MS = 3 * MIN;
const WATCH_RENEW_MS = DAY;
const MAX_PER_SYNC = 25;
const BACKFILL_MAX = 20;
const ITEM_RETENTION_MS = 30 * DAY;
const FEED_WINDOW_MS = 7 * DAY;
const FEED_ITEMS = 60;
const EXCERPT_CHARS = 1_500;

const SUMMARY_MIN_GAP_MS = 2 * HOUR;
const SUMMARY_PILE = 3;
const SUMMARY_OLDEST_MS = 4 * HOUR;
const SUMMARY_WORTH_PILE = 8;
const SUMMARY_WORTH_OLDEST_MS = 6 * HOUR;
const SUMMARIES_PER_DAY = 4;
const QUIET_FROM_HOUR = 22;
const QUIET_UNTIL_HOUR = 7;
const URGENT_PER_DAY = 5;
const NOTE_AFTER_CORRECTIONS = 3;

const IMAGE_MAX_BYTES = 1_500_000;
const PDF_MAX_BYTES = 1_000_000;

/** Hard per-owner guard on what sorting may spend. */
/**
 * Email's allowance per owner on Stella's key. Free is a taste: sorting only
 * (no written items or replies), a cent a month, about a hundred emails.
 */
const CAPS = {
  free: { perDay: 25, usdPerMonth: 0.01 },
  paid: { perDay: 600, usdPerMonth: 2 },
} as const;
/** On the owner's own key, or a self-hosted server's, only this daily rate limit applies. */
const OWN_KEY_PER_DAY = 600;
/** After the owner's key is refused, Stella's allowance is used this long (or until they save a new key). */
const OWN_KEY_RETRY_MS = HOUR;

export const EMAIL_MIGRATION = {
  id: "email.1-init",
  statements: [
    `CREATE TABLE email_state (
       id INTEGER PRIMARY KEY CHECK (id = 1),
       enabled INTEGER NOT NULL,
       note TEXT NOT NULL DEFAULT '',
       corrections_since_note INTEGER NOT NULL DEFAULT 0,
       last_summary_at INTEGER,
       summary_day TEXT,
       summaries_today INTEGER NOT NULL DEFAULT 0,
       urgent_day TEXT,
       urgent_today INTEGER NOT NULL DEFAULT 0,
       month TEXT,
       month_sorted INTEGER NOT NULL DEFAULT 0,
       month_tokens INTEGER NOT NULL DEFAULT 0,
       month_line_usd REAL NOT NULL DEFAULT 0,
       sort_day TEXT,
       sorted_today INTEGER NOT NULL DEFAULT 0,
       plan TEXT,
       updated_at INTEGER NOT NULL
     )`,
    `CREATE TABLE email_accounts (
       email TEXT PRIMARY KEY,
       history_id TEXT,
       watch_expires_at INTEGER,
       last_sync_at INTEGER,
       last_error TEXT,
       people_at INTEGER,
       created_at INTEGER NOT NULL
     )`,
    `CREATE TABLE email_items (
       item_id TEXT PRIMARY KEY,
       account TEXT NOT NULL,
       message_id TEXT NOT NULL,
       thread_id TEXT NOT NULL,
       from_name TEXT NOT NULL,
       from_address TEXT NOT NULL,
       subject TEXT NOT NULL,
       excerpt TEXT,
       bucket TEXT NOT NULL,
       first_bucket TEXT NOT NULL,
       urgent_p REAL NOT NULL DEFAULT 0,
       reason TEXT NOT NULL,
       rule_id TEXT,
       sorted_by TEXT NOT NULL,
       tokens INTEGER NOT NULL DEFAULT 0,
       received_at INTEGER NOT NULL,
       sorted_at INTEGER NOT NULL,
       state TEXT NOT NULL,
       line TEXT,
       corrected INTEGER NOT NULL DEFAULT 0,
       card_id TEXT,
       UNIQUE (account, message_id)
     )`,
    "CREATE INDEX email_items_by_state ON email_items (state, sorted_at)",
    `CREATE TABLE email_people (
       address TEXT PRIMARY KEY,
       sent_count INTEGER NOT NULL,
       last_at INTEGER NOT NULL
     )`,
    `CREATE TABLE email_rules (
       rule_id TEXT PRIMARY KEY,
       text TEXT NOT NULL,
       match_text TEXT NOT NULL,
       action TEXT NOT NULL,
       created_at INTEGER NOT NULL,
       fired_count INTEGER NOT NULL DEFAULT 0,
       last_fired_at INTEGER
     )`,
    `CREATE TABLE email_senders (
       address TEXT PRIMARY KEY,
       bucket TEXT NOT NULL,
       corrections INTEGER NOT NULL DEFAULT 0,
       updated_at INTEGER NOT NULL
     )`,
    `CREATE TABLE email_corrections (
       correction_id INTEGER PRIMARY KEY AUTOINCREMENT,
       from_label TEXT NOT NULL,
       subject TEXT NOT NULL,
       was TEXT NOT NULL,
       now TEXT NOT NULL,
       at INTEGER NOT NULL
     )`,
  ],
};

/**
 * One row per email row posted in the chat, so the opened Email view can show
 * it and every earlier one. Named `email_briefings` because owners who had the
 * October digest still have its `email_digests`, `email_digest_state` and
 * `email_digest_seen` tables, which are kept as they are.
 */
export const EMAIL_DIGESTS_MIGRATION = {
  id: "email.2-digests",
  statements: [
    `CREATE TABLE email_briefings (
       digest_id TEXT PRIMARY KEY,
       kind TEXT NOT NULL,
       created_at INTEGER NOT NULL,
       rule_text TEXT,
       item_ids TEXT
     )`,
    "CREATE INDEX email_briefings_by_time ON email_briefings (created_at)",
    "ALTER TABLE email_items ADD COLUMN archived INTEGER NOT NULL DEFAULT 0",
    "CREATE INDEX email_items_by_card ON email_items (card_id)",
    `INSERT OR IGNORE INTO email_briefings (digest_id, kind, created_at)
     SELECT card_id,
            CASE WHEN COUNT(*) > 1 OR SUM(state = 'summarized') > 0 THEN 'summary'
                 WHEN MAX(rule_id) IS NOT NULL THEN 'rule'
                 ELSE 'urgent' END,
            MAX(sorted_at)
       FROM email_items WHERE card_id IS NOT NULL GROUP BY card_id`,
  ],
};

/** The written briefing of each summary, kept with its digest. */
export const EMAIL_BRIEF_MIGRATION = {
  id: "email.3-brief",
  statements: ["ALTER TABLE email_briefings ADD COLUMN brief TEXT"],
};

/**
 * Dev stores ran the first versions of the two migrations above, which named
 * the table `email_digests` (dropping the October one): give them the new
 * table, rebuilt from their items. A no-op where `email.2-digests` made it.
 */
export const EMAIL_BRIEFINGS_MIGRATION = {
  id: "email.4-briefings",
  statements: [
    `CREATE TABLE IF NOT EXISTS email_briefings (
       digest_id TEXT PRIMARY KEY,
       kind TEXT NOT NULL,
       created_at INTEGER NOT NULL,
       rule_text TEXT,
       item_ids TEXT,
       brief TEXT
     )`,
    "CREATE INDEX IF NOT EXISTS email_briefings_by_time ON email_briefings (created_at)",
    `INSERT OR IGNORE INTO email_briefings (digest_id, kind, created_at)
     SELECT card_id,
            CASE WHEN COUNT(*) > 1 OR SUM(state = 'summarized') > 0 THEN 'summary'
                 WHEN MAX(rule_id) IS NOT NULL THEN 'rule'
                 ELSE 'urgent' END,
            MAX(sorted_at)
       FROM email_items WHERE card_id IS NOT NULL GROUP BY card_id`,
  ],
};

/**
 * The Today view: items (matters) that stay until done, put off, or acted on;
 * a plain log of what Stella read and did; and what a left-out sender needs
 * to unsubscribe.
 */
/** What the owner's own key spent this month, and when it was last refused. */
export const EMAIL_OWN_KEY_MIGRATION = {
  id: "email.6-own-key",
  statements: [
    "ALTER TABLE email_state ADD COLUMN month_own_usd REAL NOT NULL DEFAULT 0",
    "ALTER TABLE email_state ADD COLUMN own_key_refused_at INTEGER",
    "ALTER TABLE email_state ADD COLUMN own_key_error TEXT",
  ],
};

export const EMAIL_TODAY_MIGRATION = {
  id: "email.5-today",
  statements: [
    `CREATE TABLE email_matters (
       matter_id TEXT PRIMARY KEY,
       briefing_id TEXT,
       announced_in TEXT,
       kind TEXT NOT NULL,
       tone TEXT NOT NULL,
       headline TEXT NOT NULL,
       wants TEXT NOT NULL,
       points TEXT,
       item_ids TEXT NOT NULL,
       thread_ids TEXT NOT NULL,
       account TEXT NOT NULL,
       from_name TEXT NOT NULL,
       from_address TEXT NOT NULL,
       subject TEXT NOT NULL,
       thread_id TEXT NOT NULL,
       message_id TEXT NOT NULL,
       received_at INTEGER NOT NULL,
       rule_text TEXT,
       prepared TEXT,
       later_at INTEGER NOT NULL,
       later_why TEXT,
       status TEXT NOT NULL,
       snooze_until INTEGER,
       returned_at INTEGER,
       settled_at INTEGER,
       settled_how TEXT,
       arrived_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL
     )`,
    "CREATE INDEX email_matters_by_status ON email_matters (status, arrived_at)",
    `CREATE TABLE email_log (
       log_id INTEGER PRIMARY KEY AUTOINCREMENT,
       at INTEGER NOT NULL,
       kind TEXT NOT NULL,
       who TEXT,
       subject TEXT,
       count INTEGER,
       until_at INTEGER,
       matter_id TEXT
     )`,
    "CREATE INDEX email_log_by_time ON email_log (at)",
    "ALTER TABLE email_items ADD COLUMN matter_id TEXT",
    "ALTER TABLE email_items ADD COLUMN unsubscribe TEXT",
    "ALTER TABLE email_items ADD COLUMN cleared INTEGER NOT NULL DEFAULT 0",
    "ALTER TABLE email_state ADD COLUMN today_lead TEXT",
    "ALTER TABLE email_state ADD COLUMN lead_ids TEXT",
    "ALTER TABLE email_state ADD COLUMN voice TEXT",
    "ALTER TABLE email_state ADD COLUMN last_fold_at INTEGER",
    "ALTER TABLE email_senders ADD COLUMN unsubscribed_at INTEGER",
    "ALTER TABLE email_briefings ADD COLUMN matter_ids TEXT",
  ],
};

type DigestRow = {
  digest_id: string;
  kind: string;
  created_at: number;
  rule_text: string | null;
  item_ids: string | null;
  brief?: string | null;
};

type StateRow = {
  enabled: number;
  note: string;
  corrections_since_note: number;
  last_summary_at: number | null;
  summary_day: string | null;
  summaries_today: number;
  urgent_day: string | null;
  urgent_today: number;
  month: string | null;
  month_sorted: number;
  month_tokens: number;
  month_line_usd: number;
  sort_day: string | null;
  sorted_today: number;
  plan: string | null;
  today_lead?: string | null;
  lead_ids?: string | null;
  voice?: string | null;
  last_fold_at?: number | null;
  month_own_usd?: number;
  own_key_refused_at?: number | null;
  own_key_error?: string | null;
};

type AccountRow = {
  email: string;
  history_id: string | null;
  watch_expires_at: number | null;
  last_sync_at: number | null;
  last_error: string | null;
  people_at: number | null;
};

type ItemRow = {
  item_id: string;
  account: string;
  message_id: string;
  thread_id: string;
  from_name: string;
  from_address: string;
  subject: string;
  excerpt: string | null;
  bucket: string;
  first_bucket: string;
  reason: string;
  rule_id: string | null;
  received_at: number;
  sorted_at: number;
  state: string;
  line: string | null;
  corrected: number;
  card_id: string | null;
  archived?: number;
  matter_id?: string | null;
  unsubscribe?: string | null;
  cleared?: number;
};

type RuleRow = {
  rule_id: string;
  text: string;
  match_text: string;
  action: string;
  created_at: number;
  fired_count: number;
  last_fired_at: number | null;
};

type LiveAccount = { email: string; get: () => Promise<Fetcher> };

const stateOf = (db: OwnerDbReader): StateRow | null =>
  db.one<StateRow>(
    `SELECT enabled, note, corrections_since_note, last_summary_at, summary_day, summaries_today, urgent_day, urgent_today,
            month, month_sorted, month_tokens, month_line_usd, sort_day, sorted_today, plan,
            today_lead, lead_ids, voice, last_fold_at, month_own_usd, own_key_refused_at, own_key_error
       FROM email_state WHERE id = 1`,
  );

const ensureState = (ctx: OwnerContext): void => {
  ctx.db.run("INSERT INTO email_state (id, enabled, updated_at) VALUES (1, 0, ?) ON CONFLICT (id) DO NOTHING", ctx.now);
};

const enabled = (db: OwnerDbReader): boolean => stateOf(db)?.enabled === 1;

const env = (ctx: OwnerContext, name: string): string =>
  String((ctx.env as unknown as Record<string, unknown>)[name] ?? "").trim();

const pushTopic = (ctx: OwnerContext): string => env(ctx, "GMAIL_PUSH_TOPIC");

const sortingSwitchedOff = (ctx: OwnerContext): boolean => env(ctx, "EMAIL_SORTING_DISABLED") === "1";

const zoneOf = (ctx: OwnerContext, snapshot?: OwnerSnapshot): string => {
  const zone = ownerZone(ctx.db) ?? snapshot?.timeZone ?? "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return "UTC";
  }
};

const localParts = (at: number, zone: string): { day: string; month: string; hour: number } => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  return { day: `${parts.year}-${parts.month}-${parts.day}`, month: `${parts.year}-${parts.month}`, hour: Number(parts.hour) };
};

const errorText = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replace(/\s+/gu, " ").slice(0, 300);

const log = (event: string, fields: Record<string, unknown> = {}): void => {
  console.log(JSON.stringify({ event: `email_${event}`, ...fields }));
};

const liveAccounts = async (ctx: OwnerContext): Promise<LiveAccount[]> => {
  if (!stellaGoogleAvailable(ctx.env)) return [];
  const tokens = await stellaGmailTokens(ctx);
  return tokens.map((account) => ({
    email: account.email.toLowerCase(),
    get: async () => gmailFetcher(await account.accessToken()),
  }));
};

const composioGmailOnly = (db: OwnerDbReader): boolean =>
  Boolean(db.one("SELECT 1 AS present FROM integration_connections WHERE integration_id = 'gmail'"));

// Usage and the cost guard ---------------------------------------------------

type Reader = { db: OwnerDbReader; env: unknown; now: number };

/** The owner's own OpenRouter key saved to their account, if any. */
const ownKeyRow = (db: OwnerDbReader): { status: string; updated_at: number } | null => {
  try {
    return db.one<{ status: string; updated_at: number }>(
      "SELECT status, updated_at FROM provider_credentials WHERE provider = 'openrouter'",
    );
  } catch {
    return null;
  }
};

/** Whose key pays for this owner's email model calls right now. */
const payerOf = (ctx: Reader): EmailPayer => {
  if (ownerModeEnabled(ctx.env)) return "server";
  const key = ownKeyRow(ctx.db);
  if (key?.status !== "ok") return "stella";
  const refusedAt = stateOf(ctx.db)?.own_key_refused_at ?? null;
  return refusedAt !== null && refusedAt >= key.updated_at && ctx.now - refusedAt < OWN_KEY_RETRY_MS ? "stella" : "own_key";
};

const usageOf = (
  now: number,
  state: StateRow | null,
  plan: string,
  zone: string,
  payer: EmailPayer,
): EmailUsage & { today: number; why?: "month" | "day" } => {
  const { month, day } = localParts(now, zone);
  const sameMonth = state?.month === month;
  const tokens = sameMonth ? state.month_tokens : 0;
  const lineUsd = sameMonth ? state.month_line_usd : 0;
  const own = payer !== "stella";
  const costUsd = own
    ? sameMonth
      ? (state.month_own_usd ?? 0)
      : 0
    : (tokens / 1_000_000) * DECISION_INPUT_USD_PER_M + lineUsd;
  const caps = own
    ? { perDay: OWN_KEY_PER_DAY, usdPerMonth: Number.POSITIVE_INFINITY }
    : plan === "free"
      ? CAPS.free
      : CAPS.paid;
  const today = state?.sort_day === day ? state.sorted_today : 0;
  const why = costUsd >= caps.usdPerMonth ? "month" : today >= caps.perDay ? "day" : undefined;
  return {
    month,
    sorted: sameMonth ? state.month_sorted : 0,
    inputTokens: tokens,
    costUsd: Math.round(costUsd * 10_000) / 10_000,
    capped: why !== undefined,
    today,
    ...(why ? { why } : {}),
  };
};

/**
 * No written parts (Today items, the lead, replies, the note, search wording) for this owner now:
 * the allowance or the day's limit is used up, or they are on Free with Stella's key (sorting only).
 */
const writingOff = (ctx: OwnerContext, plan: string, zone: string): boolean => {
  const payer = payerOf(ctx);
  return usageOf(ctx.now, stateOf(ctx.db), plan, zone, payer).capped || (payer === "stella" && plan === "free");
};

/** The start of the next local month or day, when a paused allowance comes back. */
const nextReset = (now: number, zone: string, why: "month" | "day"): number => {
  if (why === "day") {
    const { day } = localParts(now + DAY, zone);
    return zonedTime(`${day} 00:00`, zone) ?? now + DAY;
  }
  const { month } = localParts(now, zone);
  const [year, number] = month.split("-").map(Number) as [number, number];
  const next = number === 12 ? `${year + 1}-01-01` : `${year}-${String(number + 1).padStart(2, "0")}-01`;
  return zonedTime(`${next} 00:00`, zone) ?? now + 30 * DAY;
};

/** Whose key email runs on, what that allows, and whether sorting is paused: what the Email page says. */
const accessInfo = (ctx: Reader, plan: string, zone: string): EmailAccess => {
  const payer = payerOf(ctx);
  const state = stateOf(ctx.db);
  const usage = usageOf(ctx.now, state, plan, zone, payer);
  const free = plan === "free";
  const refused =
    payer === "stella" && ownKeyRow(ctx.db)?.status === "ok" && state?.own_key_refused_at
      ? state.own_key_error || "Your OpenRouter key was refused."
      : undefined;
  return {
    payer,
    plan: free ? "free" : "paid",
    writes: payer !== "stella" || !free,
    ...(payer === "stella" ? { limitUsd: (free ? CAPS.free : CAPS.paid).usdPerMonth } : {}),
    ...(usage.why ? { paused: { why: usage.why, until: nextReset(ctx.now, zone, usage.why) } } : {}),
    ...(refused ? { ownKeyRefused: refused } : {}),
  };
};

const ownKeyRefused = (ctx: OwnerContext, message: string): void => {
  ctx.db.run(
    "UPDATE email_state SET own_key_refused_at = ?, own_key_error = ?, updated_at = ? WHERE id = 1",
    ctx.now,
    message.slice(0, 300),
    ctx.now,
  );
  log("own_key_refused", { owner: ctx.ownerId.slice(0, 12), message: message.slice(0, 200) });
};

const recordSort = (ctx: OwnerContext, zone: string, inputTokens: number): void => {
  const { month, day } = localParts(ctx.now, zone);
  // Spend on the owner's own key is kept apart: it never counts against Stella's allowance.
  const own = payerOf(ctx) !== "stella";
  const tokens = own ? 0 : inputTokens;
  const ownUsd = own ? (inputTokens / 1_000_000) * DECISION_INPUT_USD_PER_M : 0;
  ctx.db.run(
    `UPDATE email_state SET
       month_sorted = CASE WHEN month = ? THEN month_sorted + 1 ELSE 1 END,
       month_tokens = CASE WHEN month = ? THEN month_tokens + ? ELSE ? END,
       month_line_usd = CASE WHEN month = ? THEN month_line_usd ELSE 0 END,
       month_own_usd = CASE WHEN month = ? THEN month_own_usd + ? ELSE ? END,
       month = ?,
       sorted_today = CASE WHEN sort_day = ? THEN sorted_today + 1 ELSE 1 END,
       sort_day = ?,
       updated_at = ?
     WHERE id = 1`,
    month,
    month,
    tokens,
    tokens,
    month,
    month,
    ownUsd,
    ownUsd,
    month,
    day,
    day,
    ctx.now,
  );
};

const recordLineCost = (ctx: OwnerContext, zone: string, usd: number): void => {
  if (!(usd > 0)) return;
  const { month } = localParts(ctx.now, zone);
  const own = payerOf(ctx) !== "stella";
  const stellaUsd = own ? 0 : usd;
  const ownUsd = own ? usd : 0;
  ctx.db.run(
    `UPDATE email_state SET month_line_usd = CASE WHEN month = ? THEN month_line_usd + ? ELSE ? END,
       month_own_usd = CASE WHEN month = ? THEN month_own_usd + ? ELSE ? END,
       month_tokens = CASE WHEN month = ? THEN month_tokens ELSE 0 END,
       month_sorted = CASE WHEN month = ? THEN month_sorted ELSE 0 END,
       month = ?, updated_at = ? WHERE id = 1`,
    month,
    stellaUsd,
    stellaUsd,
    month,
    ownUsd,
    ownUsd,
    month,
    month,
    month,
    ctx.now,
  );
};

// Sorting ---------------------------------------------------------------------

const rulesOf = (db: OwnerDbReader): RuleRow[] =>
  db.all<RuleRow>(
    "SELECT rule_id, text, match_text, action, created_at, fired_count, last_fired_at FROM email_rules ORDER BY created_at",
  );

const toRule = (row: RuleRow): EmailRule => ({
  ruleId: row.rule_id,
  text: row.text,
  when: row.match_text,
  action: row.action === "act" ? "act" : "tell",
  createdAt: row.created_at,
  firedCount: row.fired_count,
  ...(row.last_fired_at !== null ? { lastFiredAt: row.last_fired_at } : {}),
});

const wroteTo = (db: OwnerDbReader, address: string): number =>
  db.one<{ sent_count: number }>("SELECT sent_count FROM email_people WHERE address = ?", address)?.sent_count ?? 0;

const senderOverride = (db: OwnerDbReader, address: string): EmailBucket | null => {
  const row = db.one<{ bucket: string; corrections: number }>(
    "SELECT bucket, corrections FROM email_senders WHERE address = ?",
    address,
  );
  // 'pending' marks a sender with corrections that haven't added up to an override yet.
  return EMAIL_BUCKETS.find((bucket) => bucket === row?.bucket) ?? null;
};

/** Without the model (off, capped or refused): Gmail's own signals and who they write to. */
const fallbackVerdict = (mail: GmailMail, wrote: number): SortVerdict => {
  const promo = mail.labelIds.some((label) => label === "CATEGORY_PROMOTIONS" || label === "CATEGORY_SOCIAL");
  const bucket: EmailBucket =
    promo || mail.bulk ? "noise" : wrote > 0 || mail.labelIds.includes("IMPORTANT") ? "needs_you" : "worth_knowing";
  return { bucket, urgentP: 0, reason: wrote > 0 ? "personal" : "other", inputTokens: 0 };
};

const attachmentFor = async (
  get: Fetcher,
  mail: GmailMail,
): Promise<{ kind: "image" | "document"; mimeType: string; data: string; filename: string } | undefined> => {
  if (mail.bulk) return undefined;
  const pick = mail.attachments.find(
    (entry) =>
      (entry.mimeType === "application/pdf" && entry.size > 0 && entry.size <= PDF_MAX_BYTES) ||
      (/^image\/(png|jpeg|webp|gif)$/u.test(entry.mimeType) && entry.size > 20_000 && entry.size <= IMAGE_MAX_BYTES),
  );
  if (!pick) return undefined;
  try {
    const data = await gmailAttachmentBase64(get, mail.id, pick.attachmentId);
    return { kind: pick.mimeType === "application/pdf" ? "document" : "image", mimeType: pick.mimeType, data, filename: pick.filename };
  } catch {
    return undefined;
  }
};

type Sorted = { verdict: SortVerdict; sortedBy: "model" | "sender" | "fallback" };

const sortOne = async (
  ctx: OwnerContext,
  snapshot: OwnerSnapshot,
  zone: string,
  account: string,
  get: Fetcher,
  mail: GmailMail,
): Promise<Sorted> => {
  const wrote = wroteTo(ctx.db, mail.fromAddress);
  const override = senderOverride(ctx.db, mail.fromAddress);
  // Dismissals silence a sender outright only when the user never writes to them and no standing
  // instruction could match; a person they correspond with is still read, with the note's lesson.
  if (override === "noise" && wrote === 0 && rulesOf(ctx.db).length === 0) {
    return { verdict: { bucket: "noise", urgentP: 0, reason: "other", inputTokens: 0 }, sortedBy: "sender" };
  }
  const state = stateOf(ctx.db);
  const usage = usageOf(ctx.now, state, snapshot.plan, zone, payerOf(ctx));
  if (sortingSwitchedOff(ctx) || usage.capped) {
    if (usage.capped) log("capped", { owner: ctx.ownerId.slice(0, 12), today: usage.today, costUsd: usage.costUsd });
    return { verdict: fallbackVerdict(mail, wrote), sortedBy: "fallback" };
  }
  const access = accessOf(ctx, snapshot);
  const attachment = await attachmentFor(get, mail);
  const input = {
    note: state?.note ?? "",
    account,
    from: mail.from,
    to: mail.to,
    cc: mail.cc,
    subject: mail.subject,
    receivedAt: mail.receivedAt,
    text: mail.text,
    labels: mail.labelIds.filter((label) => label === "IMPORTANT" || label.startsWith("CATEGORY_") || label === "STARRED"),
    bulk: mail.bulk,
    wroteToSender: wrote,
    rules: rulesOf(ctx.db).map((rule) => ({ ruleId: rule.rule_id, when: rule.match_text })),
    ...(attachment ? { attachment } : {}),
  };
  let verdict: SortVerdict;
  try {
    verdict = await sortEmail(access, input);
  } catch (error) {
    if (error instanceof DecisionRefused && attachment) {
      const { attachment: _dropped, ...withoutAttachment } = input;
      verdict = await sortEmail(access, withoutAttachment).catch(() => fallbackVerdict(mail, wrote));
    } else if (error instanceof DecisionRefused) {
      log("refused", { message: errorText(error) });
      return { verdict: fallbackVerdict(mail, wrote), sortedBy: "fallback" };
    } else {
      throw error;
    }
  }
  recordSort(ctx, zone, verdict.inputTokens);
  log("sorted", {
    owner: ctx.ownerId.slice(0, 12),
    bucket: verdict.bucket,
    urgentP: Math.round(verdict.urgentP * 100) / 100,
    rule: Boolean(verdict.ruleId),
    tokens: verdict.inputTokens,
    attachment: Boolean(attachment),
  });
  // A sender the user moved up is never left out as noise; one they dismissed is left out unless they
  // write to them. Finer judgement (needs you or worth knowing) stays with the model and the note.
  const applies =
    override === "noise" ? wrote === 0 && verdict.bucket !== "urgent" : override !== null && verdict.bucket === "noise";
  if (override && applies) {
    verdict = { ...verdict, bucket: override };
  }
  return { verdict, sortedBy: "model" };
};

// Surfacing -------------------------------------------------------------------

const cardItem = (row: ItemRow, n: number): EmailCardItem => ({
  n,
  itemId: row.item_id,
  account: row.account,
  from: row.from_name,
  subject: row.subject,
  line: row.line ?? "",
  bucket: row.bucket as EmailBucket,
  reason: row.reason as EmailReason,
  messageId: row.message_id,
  threadId: row.thread_id,
  receivedAt: row.received_at,
});

/**
 * Records a briefing, which the Email view and the bell show, and gives Stella
 * its hidden note in the main chat so the user can talk about it there.
 * Nothing visible goes into the chat: a busy inbox never fills it.
 */
const recordBriefing = async (
  ctx: OwnerContext,
  snapshot: OwnerSnapshot,
  card: EmailCard,
  brief?: EmailBrief,
): Promise<boolean> => {
  if (!snapshot.writable) return false;
  ctx.db.run(
    "INSERT OR IGNORE INTO email_briefings (digest_id, kind, created_at, rule_text, item_ids, brief) VALUES (?, ?, ?, ?, ?, ?)",
    card.cardId,
    card.kind,
    ctx.now,
    card.ruleText ?? null,
    JSON.stringify(card.items.map((item) => item.itemId)),
    brief ? JSON.stringify(brief) : null,
  );
  const conversationId = readMainConversationId(ctx.db);
  if (conversationId) {
    await ctx.host
      .appendConversationNote({
        conversationId,
        ownerGeneration: snapshot.ownerGeneration,
        noteId: `email-note-${card.cardId}`,
        text: emailCardNoteText(card, brief?.lead),
      })
      .catch((error: unknown) => log("note_failed", { message: errorText(error) }));
  }
  return true;
};

const pushUrgent = async (
  ctx: OwnerContext,
  row: ItemRow,
  conversationId: string | null,
  title: string,
  body: string,
  matterId?: string,
): Promise<void> => {
  const tokens = livePushTokens(ctx);
  if (tokens.length === 0) return;
  const data: EmailPushData = {
    kind: EMAIL_PUSH_KIND,
    itemId: row.item_id,
    ...(matterId ? { matterId } : {}),
    ...(conversationId ? { conversationId } : {}),
  };
  const collapse = `email:${row.item_id}`.slice(0, 64);
  await sendPushMessages(
    ctx,
    tokens,
    tokens.map((token) => ({
      to: token.token,
      title,
      body: body.slice(0, 300),
      data,
      sound: "default",
      priority: "high",
      ...(token.platform === "android"
        ? { tag: collapse }
        : { threadId: "stella-email", collapseId: collapse, interruptionLevel: "time-sensitive" }),
    })),
  );
};

const readItem = (db: OwnerDbReader, itemId: string): ItemRow | null =>
  db.one<ItemRow>("SELECT * FROM email_items WHERE item_id = ?", itemId);

/**
 * Urgent mail, and mail a standing instruction asked to hear about, goes onto
 * Today at once with its step prepared, and is announced right away: the bell,
 * and a push saying in one sentence what it wants.
 */
const surfaceNow = async (
  ctx: OwnerContext,
  snapshot: OwnerSnapshot,
  zone: string,
  row: ItemRow,
  rule: RuleRow | null,
): Promise<void> => {
  if (!snapshot.writable) return;
  const out = writingOff(ctx, snapshot.plan, zone)
    ? null
    : await writeMatters(accessOf(ctx, snapshot), matterEmails([row]), zone, await voiceOf(ctx))
    .then((result) => {
      recordLineCost(ctx, zone, result.usd);
      return result;
    })
    .catch((error: unknown) => {
      log("today_failed", { message: errorText(error) });
      return null;
    });
  const drafts = draftsFrom([row], out?.matters ?? null, ctx.now, zone);
  if (!rule) for (const draft of drafts) draft.tone = "urgent";
  const cardId = `ec-${crypto.randomUUID()}`;
  const [matterId] = recordMatters(ctx, drafts, {
    briefingId: cardId,
    kind: rule ? "rule" : "urgent",
    ...(rule ? { ruleText: rule.text } : {}),
    announcedIn: cardId,
    state: "surfaced",
  });
  const fresh = readItem(ctx.db, row.item_id) ?? row;
  const card: EmailCard = {
    type: EMAIL_CARD_TYPE,
    cardId,
    kind: rule ? "rule" : "urgent",
    items: [cardItem(fresh, 1)],
    ...(rule ? { ruleText: rule.text } : {}),
  };
  if (!(await recordBriefing(ctx, snapshot, card))) return;
  ctx.db.run("UPDATE email_briefings SET matter_ids = ? WHERE digest_id = ?", JSON.stringify(matterId ? [matterId] : []), cardId);
  const matter = matterId ? readMatter(ctx.db, matterId) : null;
  addLog(ctx, { kind: rule ? "rule" : "urgent", who: fresh.from_name, subject: matter?.headline ?? fresh.subject, ...(matterId ? { matterId } : {}) });
  scheduleLead(ctx);
  const conversationId = readMainConversationId(ctx.db);
  const body = matter?.wants || fresh.line || `${fresh.from_name}: ${fresh.subject}`;
  await pushUrgent(ctx, fresh, conversationId, fresh.from_name || fresh.from_address, body, matterId).catch((error: unknown) =>
    log("push_failed", { message: errorText(error) }),
  );
};

const ruleTurnPrompt = (rule: RuleRow, row: ItemRow): string =>
  [
    `An email just matched one of the user's standing email instructions.`,
    `Their instruction, in their words: "${rule.text}"`,
    `The email: from ${row.from_name} <${row.from_address}>, subject "${row.subject}", in their Gmail account ${row.account} (message_id ${row.message_id}, thread_id ${row.thread_id}).`,
    row.excerpt ? `It begins: ${row.excerpt.slice(0, 400)}` : "",
    `Do what the instruction asks with the email tool (read, reply, draft) using that account and message_id, or other tools for anything else it asks. Send email as the user only if the instruction clearly says to send or reply; otherwise save a draft and ask them. Then tell the user in one or two sentences what came in and what you did.`,
  ]
    .filter(Boolean)
    .join("\n");

const fireRule = async (ctx: OwnerContext, snapshot: OwnerSnapshot, zone: string, row: ItemRow, rule: RuleRow): Promise<void> => {
  ctx.db.run(
    "UPDATE email_rules SET fired_count = fired_count + 1, last_fired_at = ? WHERE rule_id = ?",
    ctx.now,
    rule.rule_id,
  );
  if (rule.action !== "act") {
    await surfaceNow(ctx, snapshot, zone, row, rule);
    return;
  }
  const conversationId = readMainConversationId(ctx.db);
  if (!conversationId) {
    await surfaceNow(ctx, snapshot, zone, row, rule);
    return;
  }
  await ctx.host.startScheduledTurn({
    ownerGeneration: snapshot.ownerGeneration,
    conversationId,
    clientMsgId: `email-rule:${row.item_id}`,
    prompt: ruleTurnPrompt(rule, row),
    title: `Email: ${rule.text}`.slice(0, 120),
  });
  ctx.db.run("UPDATE email_items SET state = 'surfaced', excerpt = NULL WHERE item_id = ?", row.item_id);
  log("rule_turn", { owner: ctx.ownerId.slice(0, 12) });
};

const urgentAllowed = (ctx: OwnerContext, zone: string): boolean => {
  const state = stateOf(ctx.db);
  const { day } = localParts(ctx.now, zone);
  const today = state?.urgent_day === day ? state.urgent_today : 0;
  if (today >= URGENT_PER_DAY) return false;
  ctx.db.run(
    "UPDATE email_state SET urgent_today = ?, urgent_day = ?, updated_at = ? WHERE id = 1",
    today + 1,
    day,
    ctx.now,
  );
  return true;
};

// Gmail sync ------------------------------------------------------------------

const isIncoming = (labels: string[]): boolean =>
  labels.includes("INBOX") && !labels.some((label) => label === "SENT" || label === "DRAFT" || label === "SPAM" || label === "TRASH");

const notePeople = (ctx: OwnerContext, mail: GmailMail): void => {
  for (const address of [...addressesIn(mail.to), ...addressesIn(mail.cc)]) {
    ctx.db.run(
      `INSERT INTO email_people (address, sent_count, last_at) VALUES (?, 1, ?)
       ON CONFLICT (address) DO UPDATE SET sent_count = sent_count + 1, last_at = excluded.last_at`,
      address,
      mail.receivedAt,
    );
  }
};

const processMessage = async (
  ctx: OwnerContext,
  snapshot: OwnerSnapshot,
  zone: string,
  account: string,
  get: Fetcher,
  messageId: string,
  options: { backfill: boolean },
): Promise<void> => {
  if (ctx.db.one("SELECT 1 AS present FROM email_items WHERE account = ? AND message_id = ?", account, messageId)) return;
  const mail = await gmailReadMail(get, messageId);
  if (!mail) return;
  if (mail.labelIds.includes("SENT")) {
    notePeople(ctx, mail);
    settleFromSent(ctx, mail);
    return;
  }
  if (!isIncoming(mail.labelIds) || mail.fromAddress === account) return;
  if (mail.receivedAt < ctx.now - 2 * DAY) return;
  const { verdict, sortedBy } = await sortOne(ctx, snapshot, zone, account, get, mail);
  let bucket = verdict.bucket;
  const rule = verdict.ruleId
    ? (rulesOf(ctx.db).find((entry) => entry.rule_id === verdict.ruleId) ?? null)
    : null;
  if (bucket === "urgent" && !rule && (options.backfill || !urgentAllowed(ctx, zone))) bucket = "needs_you";
  const itemId = `em-${crypto.randomUUID()}`;
  ctx.db.run(
    `INSERT INTO email_items (item_id, account, message_id, thread_id, from_name, from_address, subject, excerpt, bucket,
       first_bucket, urgent_p, reason, rule_id, sorted_by, tokens, received_at, sorted_at, state, unsubscribe)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (account, message_id) DO NOTHING`,
    itemId,
    account,
    mail.id,
    mail.threadId,
    mail.fromName.slice(0, 200),
    mail.fromAddress.slice(0, 320),
    mail.subject.slice(0, 300),
    bucket === "noise" ? null : mail.text.slice(0, EXCERPT_CHARS),
    bucket,
    verdict.bucket,
    verdict.urgentP,
    verdict.reason,
    rule?.rule_id ?? null,
    sortedBy,
    verdict.inputTokens,
    mail.receivedAt,
    ctx.now,
    "waiting" satisfies EmailItemState,
    mail.unsubscribe ? JSON.stringify(mail.unsubscribe) : null,
  );
  const row = readItem(ctx.db, itemId);
  if (!row) return;
  if (rule && !options.backfill) {
    await fireRule(ctx, snapshot, zone, row, rule);
    return;
  }
  if (bucket === "urgent") await surfaceNow(ctx, snapshot, zone, row, null);
};

const markSynced = (ctx: OwnerContext, email: string, fields: { historyId?: string; error?: string | null }): void => {
  ctx.db.run(
    `UPDATE email_accounts SET history_id = COALESCE(?, history_id), last_sync_at = ?, last_error = ? WHERE email = ?`,
    fields.historyId ?? null,
    ctx.now,
    fields.error ?? null,
    email,
  );
};

const syncAccount = async (ctx: OwnerContext, snapshot: OwnerSnapshot, zone: string, account: LiveAccount): Promise<boolean> => {
  const row = ctx.db.one<AccountRow>("SELECT * FROM email_accounts WHERE email = ?", account.email);
  if (!row) return false;
  const get = await account.get();
  if (!row.history_id) {
    const profile = await gmailProfile(get);
    markSynced(ctx, account.email, { historyId: profile.historyId });
    return false;
  }
  const history = await gmailHistorySince(get, row.history_id);
  if (history.expired) {
    const profile = await gmailProfile(get);
    markSynced(ctx, account.email, { historyId: profile.historyId });
    log("history_reset", { owner: ctx.ownerId.slice(0, 12) });
    return false;
  }
  // Labels in the history can be mid-change ("Not spam" adds INBOX before it removes SPAM), so anything that
  // reached the inbox is read again and its labels now decide.
  const pending = history.added.filter((entry) => entry.labelIds.includes("INBOX") || entry.labelIds.includes("SENT"));
  const batch = pending.slice(0, MAX_PER_SYNC);
  for (const entry of batch) {
    await processMessage(ctx, snapshot, zone, account.email, get, entry.id, { backfill: false });
  }
  const more = pending.length > batch.length;
  markSynced(ctx, account.email, { ...(more ? {} : { historyId: history.historyId }), error: null });
  return more;
};

const runSync = async (ctx: OwnerContext, payload: unknown): Promise<void> => {
  if (!enabled(ctx.db)) return;
  // Mail sorted while a sender's 'pending' corrections leaked in as a bucket.
  ctx.db.run(
    "UPDATE email_items SET bucket = 'worth_knowing', first_bucket = 'worth_knowing' WHERE bucket NOT IN ('urgent', 'needs_you', 'worth_knowing', 'noise')",
  );
  const target = payload && typeof payload === "object" ? String((payload as Record<string, unknown>).account ?? "") : "";
  const snapshot = await ctx.host.snapshot();
  rememberPlan(ctx, snapshot);
  const zone = zoneOf(ctx, snapshot);
  const accounts = (await liveAccounts(ctx)).filter((account) => !target || account.email === target);
  for (const account of accounts) {
    try {
      const more = await syncAccount(ctx, snapshot, zone, account);
      if (more) ctx.jobs.schedule(SYNC_JOB, ctx.now + 2_000, { account: account.email }, { id: `${SYNC_JOB}:${account.email}` });
    } catch (error) {
      log("sync_failed", { owner: ctx.ownerId.slice(0, 12), message: errorText(error) });
      markSynced(ctx, account.email, { error: errorText(error) });
    }
  }
  scheduleSummaryCheck(ctx, ctx.now + 5_000);
};

const indexWatch = async (ctx: OwnerContext, address: string, on: boolean): Promise<void> => {
  const db = ctx.env.DB;
  if (!db) return;
  if (on) {
    await db
      .prepare("INSERT INTO gmail_watch (address, owner_id, updated_at) VALUES (?, ?, ?) ON CONFLICT (address, owner_id) DO UPDATE SET updated_at = excluded.updated_at")
      .bind(address, ctx.ownerId, ctx.now)
      .run();
  } else {
    await db.prepare("DELETE FROM gmail_watch WHERE address = ? AND owner_id = ?").bind(address, ctx.ownerId).run();
  }
};

/** Gmail's stop ends push for the whole inbox, so another owner watching the same address keeps it. */
const watchedElsewhere = async (ctx: OwnerContext, address: string): Promise<boolean> => {
  const row = await ctx.env.DB?.prepare("SELECT 1 AS present FROM gmail_watch WHERE address = ? AND owner_id != ? LIMIT 1")
    .bind(address, ctx.ownerId)
    .first<{ present: number }>()
    .catch(() => null);
  return Boolean(row);
};

const watchAccount = async (ctx: OwnerContext, account: LiveAccount): Promise<void> => {
  const topic = pushTopic(ctx);
  if (!topic) return;
  const get = await account.get();
  const watch = await gmailWatch(get, topic);
  ctx.db.run(
    "UPDATE email_accounts SET watch_expires_at = ?, history_id = COALESCE(history_id, ?) WHERE email = ?",
    watch.expiration || ctx.now + 7 * DAY,
    watch.historyId,
    account.email,
  );
  await indexWatch(ctx, account.email, true);
};

/** Joins accounts connected since, drops ones removed, renews watches, and schedules the next tick. */
const reconcileAccounts = async (ctx: OwnerContext, options: { backfill: boolean }): Promise<LiveAccount[]> => {
  const live = await liveAccounts(ctx);
  const known = ctx.db.all<AccountRow>("SELECT * FROM email_accounts");
  for (const row of known) {
    if (live.some((account) => account.email === row.email)) continue;
    ctx.db.run("DELETE FROM email_accounts WHERE email = ?", row.email);
    await indexWatch(ctx, row.email, false).catch(() => undefined);
  }
  const snapshot = await ctx.host.snapshot();
  const zone = zoneOf(ctx, snapshot);
  for (const account of live) {
    const row = known.find((entry) => entry.email === account.email);
    if (!row) {
      ctx.db.run("INSERT INTO email_accounts (email, created_at) VALUES (?, ?) ON CONFLICT (email) DO NOTHING", account.email, ctx.now);
      try {
        const get = await account.get();
        const profile = await gmailProfile(get);
        markSynced(ctx, account.email, { historyId: profile.historyId });
        const people = await gmailSentPeople(get);
        for (const [address, entry] of people) {
          ctx.db.run(
            `INSERT INTO email_people (address, sent_count, last_at) VALUES (?, ?, ?)
             ON CONFLICT (address) DO UPDATE SET sent_count = MAX(sent_count, excluded.sent_count), last_at = MAX(last_at, excluded.last_at)`,
            address,
            entry.count,
            entry.lastAt,
          );
        }
        ctx.db.run("UPDATE email_accounts SET people_at = ? WHERE email = ?", ctx.now, account.email);
        if (options.backfill) await backfill(ctx, snapshot, zone, account.email, get);
      } catch (error) {
        log("join_failed", { owner: ctx.ownerId.slice(0, 12), message: errorText(error) });
        markSynced(ctx, account.email, { error: errorText(error) });
      }
    }
    const current = ctx.db.one<AccountRow>("SELECT * FROM email_accounts WHERE email = ?", account.email);
    if (pushTopic(ctx) && (!current?.watch_expires_at || current.watch_expires_at - ctx.now < 7 * DAY - WATCH_RENEW_MS)) {
      await watchAccount(ctx, account).catch((error: unknown) => {
        log("watch_failed", { owner: ctx.ownerId.slice(0, 12), message: errorText(error) });
        markSynced(ctx, account.email, { error: `Live updates are off: ${errorText(error)}` });
      });
    }
  }
  return live;
};

const backfill = async (
  ctx: OwnerContext,
  snapshot: OwnerSnapshot,
  zone: string,
  account: string,
  get: Fetcher,
): Promise<void> => {
  const list = (await get(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({ q: "in:inbox is:unread newer_than:1d", maxResults: String(BACKFILL_MAX) }).toString()}`,
  )) as { messages?: { id?: string }[] };
  for (const entry of list.messages ?? []) {
    if (!entry.id) continue;
    await processMessage(ctx, snapshot, zone, account, get, entry.id, { backfill: true }).catch((error: unknown) =>
      log("backfill_failed", { message: errorText(error) }),
    );
  }
};

const scheduleTick = (ctx: OwnerContext, delay?: number): void => {
  const live = ctx.db.one("SELECT 1 AS live FROM email_accounts WHERE watch_expires_at > ?", ctx.now);
  ctx.jobs.schedule(TICK_JOB, ctx.now + (delay ?? (live ? TICK_LIVE_MS : TICK_POLL_MS)), {}, { id: TICK_JOB });
};

const runTick = async (ctx: OwnerContext): Promise<void> => {
  if (!enabled(ctx.db)) return;
  try {
    await reconcileAccounts(ctx, { backfill: false });
    ctx.db.run("DELETE FROM email_items WHERE sorted_at < ?", ctx.now - ITEM_RETENTION_MS);
    ctx.db.run("DELETE FROM email_corrections WHERE at < ?", ctx.now - ITEM_RETENTION_MS);
    ctx.db.run("DELETE FROM email_matters WHERE status = 'done' AND settled_at < ?", ctx.now - MATTER_RETENTION_MS);
    ctx.db.run("DELETE FROM email_log WHERE at < ?", ctx.now - MATTER_RETENTION_MS);
    await settleArchived(ctx).catch((error: unknown) => log("settle_check_failed", { message: errorText(error) }));
    await runSync(ctx, {});
  } finally {
    scheduleTick(ctx);
  }
};

// Summaries -------------------------------------------------------------------

const scheduleSummaryCheck = (ctx: OwnerContext, at: number): void => {
  ctx.jobs.schedule(SUMMARY_JOB, at, {}, { id: SUMMARY_JOB });
};

/** When a summary is due: enough has built up, something has waited long, or it is the first moment of the day. */
export const summaryDue = (args: {
  now: number;
  hour: number;
  lastSummaryAt: number | null;
  summariesToday: number;
  needsYou: number[];
  worth: number[];
  firstOfDay: boolean;
}): boolean => {
  const { now, hour, needsYou, worth } = args;
  if (needsYou.length === 0 && worth.length === 0) return false;
  if (hour >= QUIET_FROM_HOUR || hour < QUIET_UNTIL_HOUR) return false;
  if (args.summariesToday >= SUMMARIES_PER_DAY) return false;
  if (args.lastSummaryAt !== null && now - args.lastSummaryAt < SUMMARY_MIN_GAP_MS) return false;
  const oldestNeeds = needsYou.length > 0 ? now - Math.min(...needsYou) : 0;
  const oldestWorth = worth.length > 0 ? now - Math.min(...worth) : 0;
  if (args.firstOfDay && needsYou.length + worth.length > 0) return true;
  if (needsYou.length >= SUMMARY_PILE) return true;
  if (needsYou.length > 0 && oldestNeeds >= SUMMARY_OLDEST_MS) return true;
  return worth.length >= SUMMARY_WORTH_PILE && oldestWorth >= SUMMARY_WORTH_OLDEST_MS;
};

/** Drops what the user already dealt with in Gmail (read or archived) before it is summarized. */
const dropHandled = async (ctx: OwnerContext, rows: ItemRow[]): Promise<ItemRow[]> => {
  const accounts = new Map((await liveAccounts(ctx)).map((account) => [account.email, account]));
  const keep: ItemRow[] = [];
  for (const row of rows) {
    const account = accounts.get(row.account);
    if (!account) continue;
    const labels = await gmailLabelsOf(await account.get(), row.message_id).catch(() => ["UNREAD", "INBOX"]);
    if (labels && labels.includes("INBOX") && labels.includes("UNREAD")) keep.push(row);
    else ctx.db.run("UPDATE email_items SET state = 'summarized', excerpt = NULL WHERE item_id = ?", row.item_id);
  }
  return keep;
};

/** Folds waiting mail into Today, then announces it when a summary is due. */
const postSummary = async (ctx: OwnerContext, snapshot: OwnerSnapshot, zone: string, force: boolean): Promise<boolean> => {
  await fold(ctx, snapshot, zone, force);
  return await announce(ctx, snapshot, zone, force);
};

const runSummary = async (ctx: OwnerContext, payload: unknown): Promise<void> => {
  if (!enabled(ctx.db)) return;
  const force = Boolean(payload && typeof payload === "object" && (payload as Record<string, unknown>).force === true);
  const snapshot = await ctx.host.snapshot();
  await postSummary(ctx, snapshot, zoneOf(ctx, snapshot), force);
};

// Learning --------------------------------------------------------------------

const correct = (ctx: OwnerContext, row: ItemRow, now: EmailBucket | "dismissed"): void => {
  const was = row.bucket as EmailBucket;
  ctx.db.run(
    "INSERT INTO email_corrections (from_label, subject, was, now, at) VALUES (?, ?, ?, ?, ?)",
    `${row.from_name} <${row.from_address}>`,
    row.subject,
    was,
    now,
    ctx.now,
  );
  const target: EmailBucket = now === "dismissed" ? "noise" : now === "urgent" ? "needs_you" : now;
  const sender = ctx.db.one<{ bucket: string; corrections: number }>(
    "SELECT bucket, corrections FROM email_senders WHERE address = ?",
    row.from_address,
  );
  const count = sender && sender.bucket === target ? sender.corrections + 1 : 1;
  const bulkSender = row.excerpt === null && was === "noise";
  if (count >= 2 || bulkSender || target !== "noise") {
    ctx.db.run(
      `INSERT INTO email_senders (address, bucket, corrections, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (address) DO UPDATE SET bucket = excluded.bucket, corrections = excluded.corrections, updated_at = excluded.updated_at`,
      row.from_address,
      target,
      count,
      ctx.now,
    );
  } else {
    ctx.db.run(
      `INSERT INTO email_senders (address, bucket, corrections, updated_at) VALUES (?, 'pending', 0, ?)
       ON CONFLICT (address) DO NOTHING`,
      row.from_address,
      ctx.now,
    );
    ctx.db.run(
      "UPDATE email_senders SET corrections = ?, updated_at = ? WHERE address = ? AND bucket IN ('pending', ?)",
      count,
      ctx.now,
      row.from_address,
      target,
    );
  }
  ctx.db.run(
    "UPDATE email_state SET corrections_since_note = corrections_since_note + 1, updated_at = ? WHERE id = 1",
    ctx.now,
  );
  const state = stateOf(ctx.db);
  if ((state?.corrections_since_note ?? 0) >= NOTE_AFTER_CORRECTIONS) {
    ctx.jobs.schedule(NOTE_JOB, ctx.now + 30_000, {}, { id: NOTE_JOB });
  }
};

const runNote = async (ctx: OwnerContext): Promise<void> => {
  const state = stateOf(ctx.db);
  if (!state || state.corrections_since_note === 0) return;
  const corrections = ctx.db
    .all<{ from_label: string; subject: string; was: string; now: string }>(
      "SELECT from_label, subject, was, now FROM email_corrections ORDER BY correction_id DESC LIMIT ?",
      Math.max(state.corrections_since_note, NOTE_AFTER_CORRECTIONS),
    )
    .map((row) => ({
      from: row.from_label,
      subject: row.subject,
      was: row.was as EmailBucket,
      now: row.now as EmailBucket | "dismissed",
    }));
  const snapshot = await ctx.host.snapshot();
  if (writingOff(ctx, snapshot.plan, zoneOf(ctx, snapshot))) return;
  const rewritten = await rewriteNote(
    accessOf(ctx, snapshot),
    state.note,
    corrections,
  );
  recordLineCost(ctx, zoneOf(ctx, snapshot), rewritten.usd);
  const note = rewritten.note;
  if (!note) return;
  ctx.db.run(
    "UPDATE email_state SET note = ?, corrections_since_note = 0, updated_at = ? WHERE id = 1",
    note,
    ctx.now,
  );
  log("note_rewritten", { owner: ctx.ownerId.slice(0, 12), corrections: corrections.length });
};

// Today -----------------------------------------------------------------------------

const LEAD_JOB = "email.lead";
const LATER_JOB = "email.later";
/** New mail is folded into Today a few minutes after it lands (so a burst lands together) and at most this often; announcing it keeps the summary caps. */
const FOLD_GAP_MS = 10 * MIN;
const FOLD_SETTLE_MS = 3 * MIN;
const FOLD_MAX = 15;
const MATTER_RETENTION_MS = 30 * DAY;
const HISTORY_DAYS = 14;
const NOISE_WINDOW_MS = 7 * DAY;
const NOISE_SENDERS = 30;
const SETTLE_CHECKS = 10;
const VOICE_CHARS = 2_000;

type MatterRow = {
  matter_id: string;
  briefing_id: string | null;
  announced_in: string | null;
  kind: string;
  tone: string;
  headline: string;
  wants: string;
  points: string | null;
  item_ids: string;
  thread_ids: string;
  account: string;
  from_name: string;
  from_address: string;
  subject: string;
  thread_id: string;
  message_id: string;
  received_at: number;
  rule_text: string | null;
  prepared: string | null;
  later_at: number;
  later_why: string | null;
  status: string;
  snooze_until: number | null;
  returned_at: number | null;
  settled_at: number | null;
  settled_how: string | null;
  arrived_at: number;
  updated_at: number;
};

const TONE_ORDER: Record<string, number> = { urgent: 0, needs_you: 1, fyi: 2 };

const jsonList = (text: string | null | undefined): string[] => {
  if (!text) return [];
  try {
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
};

const placeholders = (values: readonly unknown[]): string => values.map(() => "?").join(", ");

const accessOf = (ctx: OwnerContext, snapshot: OwnerSnapshot): SorterAccess => ({
  env: ctx.env,
  ownerId: ctx.ownerId,
  ownerGeneration: snapshot.ownerGeneration,
  execution: snapshot.execution,
  audience: snapshot.allowance.audience,
  budgetMicroCents: snapshot.allowance.budgetMicroCents,
  ...(payerOf(ctx) === "own_key"
    ? { ownKey: "openrouter" as const, onOwnKeyRefused: (message: string) => ownKeyRefused(ctx, message) }
    : {}),
});

/** A wall-clock time ("YYYY-MM-DD HH:MM") in a time zone, as an instant. */
const zonedTime = (local: string, zone: string): number | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})/u.exec(local.trim());
  if (!match) return null;
  const wall = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
  if (!Number.isFinite(wall)) return null;
  const offsetAt = (at: number): number => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(at)
        .map((part) => [part.type, part.value]),
    );
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute)) - Math.floor(at / MIN) * MIN;
  };
  const first = wall - offsetAt(wall);
  return wall - offsetAt(first);
};

const defaultLater = (now: number, zone: string): number =>
  zonedTime(`${localParts(now + DAY, zone).day} 09:00`, zone) ?? now + DAY;

const laterFrom = (text: string | undefined, now: number, zone: string): number => {
  const at = text ? zonedTime(text, zone) : null;
  return at !== null && at > now + 30 * MIN && at < now + 60 * DAY ? at : defaultLater(now, zone);
};

const startOfDay = (now: number, zone: string): number => zonedTime(`${localParts(now, zone).day} 00:00`, zone) ?? now - DAY;

const addLog = (
  ctx: OwnerContext,
  entry: { kind: EmailLogKind; who?: string; subject?: string; count?: number; until?: number; matterId?: string },
): void => {
  ctx.db.run(
    "INSERT INTO email_log (at, kind, who, subject, count, until_at, matter_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ctx.now,
    entry.kind,
    entry.who?.slice(0, 200) ?? null,
    entry.subject?.slice(0, 300) ?? null,
    entry.count ?? null,
    entry.until ?? null,
    entry.matterId ?? null,
  );
};

const parsePrepared = (text: string | null): EmailPrepared | undefined => {
  if (!text) return undefined;
  try {
    const value = JSON.parse(text) as EmailPrepared;
    if (value?.kind === "reply" && typeof value.label === "string" && typeof value.body === "string") return value;
    if (value?.kind === "ask" && typeof value.label === "string" && typeof value.ask === "string") return value;
  } catch {
    return undefined;
  }
  return undefined;
};

const SETTLED: readonly EmailSettledHow[] = ["done", "replied", "drafted", "handled", "archived", "replied_in_gmail", "archived_in_gmail"];

const toMatter = (row: MatterRow, now: number): EmailMatter => {
  const due = row.status === "later" && row.snooze_until !== null && row.snooze_until <= now;
  const prepared = parsePrepared(row.prepared);
  const settledHow = SETTLED.find((how) => how === row.settled_how);
  const returnedAt = due ? row.snooze_until! : row.returned_at;
  return {
    matterId: row.matter_id,
    kind: row.kind === "urgent" || row.kind === "rule" ? row.kind : "summary",
    ...(row.briefing_id ? { briefingId: row.briefing_id } : {}),
    tone: row.tone === "urgent" || row.tone === "needs_you" ? row.tone : "fyi",
    headline: row.headline,
    wants: row.wants,
    points: jsonList(row.points),
    from: row.from_name,
    fromAddress: row.from_address,
    subject: row.subject,
    account: row.account,
    itemIds: jsonList(row.item_ids),
    threadId: row.thread_id,
    messageId: row.message_id,
    receivedAt: row.received_at,
    arrivedAt: row.arrived_at,
    status: due ? "open" : row.status === "later" || row.status === "done" ? row.status : "open",
    ...(row.status === "later" && !due && row.snooze_until !== null ? { laterUntil: row.snooze_until } : {}),
    laterSuggestion: { at: row.later_at, why: row.later_why ?? "" },
    ...(returnedAt ? { returnedAt } : {}),
    ...(row.status === "done" && row.settled_at !== null ? { settledAt: row.settled_at } : {}),
    ...(row.status === "done" && settledHow ? { settledHow } : {}),
    ...(prepared ? { prepared } : {}),
    ...(row.rule_text ? { ruleText: row.rule_text } : {}),
  };
};

const readMatter = (db: OwnerDbReader, matterId: string): MatterRow | null =>
  db.one<MatterRow>("SELECT * FROM email_matters WHERE matter_id = ?", matterId);

const requireMatter = (ctx: OwnerContext, matterId: string): MatterRow => {
  const row = readMatter(ctx.db, matterId);
  if (!row) throw new RpcError("NOT_FOUND", "That item is no longer here.");
  return row;
};

/** The unsettled item a thread already belongs to, so a new email in it joins it instead of repeating it. */
const unsettledMatterFor = (db: OwnerDbReader, threads: string[]): MatterRow | null => {
  for (const thread of threads) {
    const row = db.one<MatterRow>(
      "SELECT * FROM email_matters WHERE status != 'done' AND thread_ids LIKE ? ORDER BY updated_at DESC LIMIT 1",
      `%"${thread.replace(/[%_"]/gu, "")}"%`,
    );
    if (row) return row;
  }
  return null;
};

const openRows = (db: OwnerDbReader, now: number): MatterRow[] =>
  db
    .all<MatterRow>("SELECT * FROM email_matters WHERE status = 'open' OR (status = 'later' AND snooze_until <= ?) LIMIT 200", now)
    .sort(
      (a, b) =>
        (TONE_ORDER[a.tone] ?? 2) - (TONE_ORDER[b.tone] ?? 2) ||
        Math.max(b.updated_at, b.snooze_until ?? 0) - Math.max(a.updated_at, a.snooze_until ?? 0),
    );

type MatterDraft = {
  rows: ItemRow[];
  tone: EmailBriefTone;
  headline: string;
  wants: string;
  points: string[];
  prepared?: EmailPrepared;
  laterAt: number;
  laterWhy: string;
};

const plainDraft = (row: ItemRow, now: number, zone: string): MatterDraft => ({
  rows: [row],
  tone: row.bucket === "urgent" ? "urgent" : row.bucket === "needs_you" ? "needs_you" : "fyi",
  headline: row.subject.slice(0, 120),
  wants: row.line ?? `${row.from_name}: ${row.subject}`,
  points: [],
  laterAt: defaultLater(now, zone),
  laterWhy: "",
});

/** The model's items, with anything it left out added plainly so no email goes missing. */
const draftsFrom = (rows: ItemRow[], out: MatterOutput[] | null, now: number, zone: string): MatterDraft[] => {
  const drafts: MatterDraft[] = [];
  const used = new Set<number>();
  for (const matter of out ?? []) {
    const own = matter.emails.flatMap((n) => (rows[n - 1] ? [rows[n - 1]!] : []));
    if (own.length === 0) continue;
    matter.emails.forEach((n) => used.add(n));
    drafts.push({
      rows: own,
      tone: matter.tone,
      headline: matter.headline,
      wants: matter.wants || matter.headline,
      points: matter.points,
      ...(matter.reply
        ? { prepared: { kind: "reply" as const, ...matter.reply } }
        : matter.action
          ? { prepared: { kind: "ask" as const, ...matter.action } }
          : {}),
      laterAt: laterFrom(matter.laterAt, now, zone),
      laterWhy: matter.laterWhy ?? "",
    });
  }
  rows.forEach((row, index) => {
    if (!used.has(index + 1)) drafts.push(plainDraft(row, now, zone));
  });
  return drafts;
};

/**
 * Writes items onto Today. An email in a thread that already has an open (or
 * put-off) item joins it: the item is rewritten from the newest email and, if
 * it was put off, comes back.
 */
const recordMatters = (
  ctx: OwnerContext,
  drafts: MatterDraft[],
  options: { briefingId: string; kind: "summary" | "urgent" | "rule"; ruleText?: string; announcedIn?: string; state: EmailItemState },
): string[] => {
  const ids: string[] = [];
  for (const draft of drafts) {
    const rows = [...draft.rows].sort((a, b) => a.received_at - b.received_at);
    const newest = rows[rows.length - 1]!;
    const threads = [...new Set(rows.map((row) => row.thread_id))];
    const existing = unsettledMatterFor(ctx.db, threads);
    const prepared = draft.prepared ? JSON.stringify(draft.prepared) : null;
    let matterId: string;
    if (existing) {
      matterId = existing.matter_id;
      ctx.db.run(
        `UPDATE email_matters SET briefing_id = ?, announced_in = ?, kind = ?, tone = ?, headline = ?, wants = ?, points = ?,
           item_ids = ?, thread_ids = ?, from_name = ?, from_address = ?, subject = ?, thread_id = ?, message_id = ?,
           received_at = ?, rule_text = COALESCE(?, rule_text), prepared = ?, later_at = ?, later_why = ?, status = 'open',
           snooze_until = NULL, returned_at = CASE WHEN status = 'later' THEN ? ELSE returned_at END, updated_at = ?
         WHERE matter_id = ?`,
        options.briefingId,
        options.announcedIn ?? null,
        options.kind,
        draft.tone,
        draft.headline,
        draft.wants,
        JSON.stringify(draft.points),
        JSON.stringify([...new Set([...jsonList(existing.item_ids), ...rows.map((row) => row.item_id)])]),
        JSON.stringify([...new Set([...jsonList(existing.thread_ids), ...threads])]),
        newest.from_name,
        newest.from_address,
        newest.subject,
        newest.thread_id,
        newest.message_id,
        newest.received_at,
        options.ruleText ?? null,
        prepared,
        draft.laterAt,
        draft.laterWhy,
        ctx.now,
        ctx.now,
        matterId,
      );
    } else {
      matterId = `mt-${crypto.randomUUID()}`;
      ctx.db.run(
        `INSERT INTO email_matters (matter_id, briefing_id, announced_in, kind, tone, headline, wants, points, item_ids, thread_ids,
           account, from_name, from_address, subject, thread_id, message_id, received_at, rule_text, prepared, later_at, later_why,
           status, arrived_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)`,
        matterId,
        options.briefingId,
        options.announcedIn ?? null,
        options.kind,
        draft.tone,
        draft.headline,
        draft.wants,
        JSON.stringify(draft.points),
        JSON.stringify(rows.map((row) => row.item_id)),
        JSON.stringify(threads),
        newest.account,
        newest.from_name,
        newest.from_address,
        newest.subject,
        newest.thread_id,
        newest.message_id,
        newest.received_at,
        options.ruleText ?? null,
        prepared,
        draft.laterAt,
        draft.laterWhy,
        ctx.now,
        ctx.now,
      );
    }
    ids.push(matterId);
    for (const row of rows) {
      ctx.db.run(
        "UPDATE email_items SET matter_id = ?, line = ?, state = ?, card_id = ?, excerpt = NULL WHERE item_id = ?",
        matterId,
        draft.wants,
        options.state,
        options.briefingId,
        row.item_id,
      );
    }
  }
  return ids;
};

/** A few lines of the user's own writing, read once from their sent mail, so drafted replies sound like them. */
const voiceOf = async (ctx: OwnerContext): Promise<string> => {
  const stored = stateOf(ctx.db)?.voice;
  if (typeof stored === "string") return stored;
  const account = (await liveAccounts(ctx))[0];
  if (!account) return "";
  const samples = await gmailWritingSamples(await account.get()).catch(() => [] as string[]);
  const voice = samples
    .map((sample, index) => `--- ${index + 1}\n${sample}`)
    .join("\n")
    .slice(0, VOICE_CHARS);
  ctx.db.run("UPDATE email_state SET voice = ? WHERE id = 1", voice);
  return voice;
};

const matterEmails = (rows: ItemRow[]): MatterEmail[] =>
  rows.map((row, index) => ({
    n: index + 1,
    bucket: row.bucket as EmailBucket,
    from: `${row.from_name} <${row.from_address}>`,
    to: row.account,
    subject: row.subject,
    threadId: row.thread_id,
    receivedAt: row.received_at,
    excerpt: (row.excerpt ?? "").slice(0, EXCERPT_CHARS),
  }));

const scheduleLead = (ctx: OwnerContext): void => {
  ctx.jobs.schedule(LEAD_JOB, ctx.now + 15_000, {}, { id: LEAD_JOB });
};

const scheduleLater = (ctx: OwnerContext): void => {
  const next = ctx.db.one<{ at: number | null }>("SELECT MIN(snooze_until) AS at FROM email_matters WHERE status = 'later'")?.at;
  if (next) ctx.jobs.schedule(LATER_JOB, Math.max(next, ctx.now + 1_000), {}, { id: LATER_JOB });
  else ctx.jobs.cancel(LATER_JOB);
};

/** Folds mail sorted since the last pass into Today, quietly; announcing it is separate. */
const fold = async (ctx: OwnerContext, snapshot: OwnerSnapshot, zone: string, force: boolean): Promise<void> => {
  const waiting = ctx.db.all<ItemRow>(
    "SELECT * FROM email_items WHERE state = 'waiting' AND bucket IN ('urgent', 'needs_you', 'worth_knowing') ORDER BY received_at ASC LIMIT ?",
    FOLD_MAX,
  );
  if (waiting.length === 0) return;
  const last = stateOf(ctx.db)?.last_fold_at ?? null;
  const oldest = Math.min(...waiting.map((row) => row.sorted_at));
  const at = Math.max(oldest + FOLD_SETTLE_MS, last === null ? 0 : last + FOLD_GAP_MS);
  if (!force && waiting.length < FOLD_MAX && ctx.now < at) {
    scheduleSummaryCheck(ctx, at);
    return;
  }
  ctx.db.run("UPDATE email_state SET last_fold_at = ? WHERE id = 1", ctx.now);
  const rows = await dropHandled(ctx, waiting);
  if (rows.length === 0) return;
  const out = writingOff(ctx, snapshot.plan, zone)
    ? null
    : await writeMatters(accessOf(ctx, snapshot), matterEmails(rows), zone, await voiceOf(ctx))
    .then((result) => {
      recordLineCost(ctx, zone, result.usd);
      return result;
    })
    .catch((error: unknown) => {
      log("today_failed", { message: errorText(error) });
      return null;
    });
  const briefingId = `ef-${crypto.randomUUID()}`;
  const ids = recordMatters(ctx, draftsFrom(rows, out?.matters ?? null, ctx.now, zone), {
    briefingId,
    kind: "summary",
    state: "summarized",
  });
  ctx.db.run(
    "INSERT INTO email_briefings (digest_id, kind, created_at, item_ids, matter_ids, brief) VALUES (?, 'fold', ?, ?, ?, ?)",
    briefingId,
    ctx.now,
    JSON.stringify(rows.map((row) => row.item_id)),
    JSON.stringify(ids),
    out?.lead ? JSON.stringify({ lead: out.lead, sections: [] }) : null,
  );
  log("folded", { owner: ctx.ownerId.slice(0, 12), items: rows.length, matters: ids.length });
  scheduleLead(ctx);
  if (waiting.length === FOLD_MAX) ctx.jobs.schedule(SUMMARY_JOB, ctx.now + 2_000, { force: true }, { id: SUMMARY_NOW_ID });
};

const TONE_HEADINGS: Record<EmailBriefTone, string> = { urgent: "Urgent", needs_you: "Needs you", fyi: "Worth knowing" };

/** The written form of an announcement, kept with it (and read by the chat's hidden note). */
const briefFromMatters = (rows: MatterRow[]): EmailBrief => {
  const sections: EmailBrief["sections"] = [];
  for (const row of rows) {
    const tone = row.tone === "urgent" || row.tone === "needs_you" ? row.tone : "fyi";
    let section = sections.find((entry) => entry.tone === tone);
    if (!section) {
      section = { heading: TONE_HEADINGS[tone], tone, blocks: [] };
      sections.push(section);
    }
    const prepared = parsePrepared(row.prepared);
    section.blocks.push({
      itemIds: jsonList(row.item_ids),
      title: `**${row.from_name}** · ${row.headline}`,
      points: jsonList(row.points),
      ...(prepared ? { suggestion: { label: prepared.label, ask: prepared.kind === "ask" ? prepared.ask : prepared.label } } : {}),
    });
  }
  return { lead: rows[0]?.wants ?? "", sections };
};

/**
 * Announces what was folded in since the last announcement (the bell, the
 * badge, the chat's hidden note), on the summary cadence and caps.
 */
const announce = async (ctx: OwnerContext, snapshot: OwnerSnapshot, zone: string, force: boolean): Promise<boolean> => {
  const pending = ctx.db.all<MatterRow>(
    "SELECT * FROM email_matters WHERE status = 'open' AND announced_in IS NULL ORDER BY updated_at DESC LIMIT 20",
  );
  if (pending.length === 0) return false;
  const state = stateOf(ctx.db);
  const { day, hour } = localParts(ctx.now, zone);
  const summariesToday = state?.summary_day === day ? state.summaries_today : 0;
  const due =
    force ||
    summaryDue({
      now: ctx.now,
      hour,
      lastSummaryAt: state?.last_summary_at ?? null,
      summariesToday,
      needsYou: pending.filter((row) => row.tone !== "fyi").map((row) => row.updated_at),
      worth: pending.filter((row) => row.tone === "fyi").map((row) => row.updated_at),
      firstOfDay: summariesToday === 0 && (state?.last_summary_at ?? 0) < ctx.now - 6 * HOUR,
    });
  if (!due || !snapshot.writable) return false;
  const ordered = [...pending].sort(
    (a, b) => (TONE_ORDER[a.tone] ?? 2) - (TONE_ORDER[b.tone] ?? 2) || b.updated_at - a.updated_at,
  );
  const itemIds = ordered.flatMap((row) => jsonList(row.item_ids));
  const items = itemIds.flatMap((id) => {
    const row = readItem(ctx.db, id);
    return row ? [row] : [];
  });
  const briefingId = `ec-${crypto.randomUUID()}`;
  const card: EmailCard = {
    type: EMAIL_CARD_TYPE,
    cardId: briefingId,
    kind: "summary",
    items: items.slice(0, EMAIL_CARD_MAX_ITEMS).map((row, index) => cardItem(row, index + 1)),
  };
  const brief = briefFromMatters(ordered);
  if (!(await recordBriefing(ctx, snapshot, card, brief))) return false;
  const matterIds = ordered.map((row) => row.matter_id);
  ctx.db.run("UPDATE email_briefings SET matter_ids = ? WHERE digest_id = ?", JSON.stringify(matterIds), briefingId);
  ctx.db.run(`UPDATE email_matters SET announced_in = ? WHERE matter_id IN (${placeholders(matterIds)})`, briefingId, ...matterIds);
  ctx.db.run(
    "UPDATE email_state SET last_summary_at = ?, summaries_today = ?, summary_day = ?, updated_at = ? WHERE id = 1",
    ctx.now,
    summariesToday + 1,
    day,
    ctx.now,
  );
  addLog(ctx, { kind: "briefed", count: ordered.length });
  log("summary", { owner: ctx.ownerId.slice(0, 12), matters: ordered.length });
  return true;
};

const runLead = async (ctx: OwnerContext): Promise<void> => {
  if (!enabled(ctx.db)) return;
  const open = openRows(ctx.db, ctx.now);
  const ids = open.map((row) => row.matter_id).sort();
  if (open.length <= 1) {
    ctx.db.run("UPDATE email_state SET today_lead = NULL, lead_ids = ? WHERE id = 1", JSON.stringify(ids));
    return;
  }
  const state = stateOf(ctx.db);
  if (state?.today_lead && jsonList(state.lead_ids).sort().join(",") === ids.join(",")) return;
  const snapshot = await ctx.host.snapshot();
  if (writingOff(ctx, snapshot.plan, zoneOf(ctx, snapshot))) {
    ctx.db.run("UPDATE email_state SET today_lead = NULL, lead_ids = ? WHERE id = 1", JSON.stringify(ids));
    return;
  }
  const { lead, usd } = await writeTodayLead(
    accessOf(ctx, snapshot),
    open.slice(0, 12).map((row) => ({ tone: row.tone, headline: row.headline, wants: row.wants })),
  );
  recordLineCost(ctx, zoneOf(ctx, snapshot), usd);
  ctx.db.run("UPDATE email_state SET today_lead = ?, lead_ids = ? WHERE id = 1", lead || null, JSON.stringify(ids));
};

const runLater = (ctx: OwnerContext): void => {
  const due = ctx.db.all<MatterRow>("SELECT * FROM email_matters WHERE status = 'later' AND snooze_until <= ?", ctx.now);
  for (const row of due) {
    ctx.db.run(
      "UPDATE email_matters SET status = 'open', returned_at = snooze_until, snooze_until = NULL, updated_at = ? WHERE matter_id = ?",
      ctx.now,
      row.matter_id,
    );
    addLog(ctx, { kind: "returned", subject: row.headline, matterId: row.matter_id });
  }
  if (due.length > 0) scheduleLead(ctx);
  scheduleLater(ctx);
};

/** Settles an item because of something done through Stella or seen in Gmail. */
const settleAs = (ctx: OwnerContext, row: MatterRow, how: Exclude<EmailSettledHow, "done">): void => {
  if (row.status === "done") return;
  ctx.db.run(
    "UPDATE email_matters SET status = 'done', settled_at = ?, settled_how = ?, snooze_until = NULL, updated_at = ? WHERE matter_id = ?",
    ctx.now,
    how,
    ctx.now,
    row.matter_id,
  );
  const kind: EmailLogKind = how === "replied" ? "sent" : how;
  addLog(ctx, { kind, who: row.from_name, subject: row.headline, matterId: row.matter_id });
  scheduleLead(ctx);
  scheduleLater(ctx);
};

const markRead = async (ctx: OwnerContext, row: MatterRow): Promise<void> => {
  const ids = jsonList(row.item_ids);
  if (ids.length === 0) return;
  const messages = ctx.db
    .all<{ message_id: string }>(`SELECT message_id FROM email_items WHERE item_id IN (${placeholders(ids)})`, ...ids)
    .map((entry) => entry.message_id);
  const account = (await liveAccounts(ctx)).find((entry) => entry.email === row.account);
  if (!account || messages.length === 0) return;
  await gmailMarkRead(await account.get(), messages);
};

const settle = async (ctx: OwnerContext, args: EmailCalls["email.settle"]["args"]): Promise<{ ok: true }> => {
  enforceOwnerRateLimit(ctx.db, ctx.now, "email.settle", { count: 600, windowMs: HOUR }, "Too many changes. Try again later.");
  const row = requireMatter(ctx, args.matterId);
  const zone = ownerZone(ctx.db) ?? "UTC";
  if (args.status === "done") {
    if (row.status === "done") return { ok: true };
    ctx.db.run(
      "UPDATE email_matters SET status = 'done', settled_at = ?, settled_how = 'done', snooze_until = NULL, updated_at = ? WHERE matter_id = ?",
      ctx.now,
      ctx.now,
      row.matter_id,
    );
    addLog(ctx, { kind: "done", subject: row.headline, matterId: row.matter_id });
    await markRead(ctx, row).catch((error: unknown) => log("mark_read_failed", { message: errorText(error) }));
  } else if (args.status === "later") {
    const asked = args.laterUntil;
    const until =
      asked !== undefined && asked > ctx.now + MIN && asked < ctx.now + 366 * DAY
        ? asked
        : row.later_at > ctx.now + MIN
          ? row.later_at
          : defaultLater(ctx.now, zone);
    ctx.db.run(
      "UPDATE email_matters SET status = 'later', snooze_until = ?, returned_at = NULL, settled_at = NULL, settled_how = NULL, updated_at = ? WHERE matter_id = ?",
      until,
      ctx.now,
      row.matter_id,
    );
    addLog(ctx, { kind: "later", subject: row.headline, until, matterId: row.matter_id });
  } else {
    if (row.status === "open" && row.snooze_until === null) return { ok: true };
    ctx.db.run(
      "UPDATE email_matters SET status = 'open', snooze_until = NULL, settled_at = NULL, settled_how = NULL, updated_at = ? WHERE matter_id = ?",
      ctx.now,
      row.matter_id,
    );
    addLog(ctx, { kind: "reopened", subject: row.headline, matterId: row.matter_id });
  }
  scheduleLater(ctx);
  scheduleLead(ctx);
  return { ok: true };
};

const sendReply = async (ctx: OwnerContext, args: EmailCalls["email.sendReply"]["args"]): Promise<{ text: string }> => {
  const row = requireMatter(ctx, args.matterId);
  const result = await mailAction(ctx, {
    action: args.mode === "send" ? "reply" : "draft",
    account: row.account,
    messageId: row.message_id,
    body: args.body,
  });
  settleAs(ctx, readMatter(ctx.db, row.matter_id) ?? row, args.mode === "send" ? "replied" : "drafted");
  return result;
};

const voiceReply = async (ctx: OwnerContext, args: EmailCalls["email.voiceReply"]["args"]): Promise<{ body: string }> => {
  enforceOwnerRateLimit(ctx.db, ctx.now, "email.voiceReply", { count: 60, windowMs: HOUR }, "Too many replies. Try again later.");
  const row = requireMatter(ctx, args.matterId);
  const account = (await liveAccounts(ctx)).find((entry) => entry.email === row.account);
  if (!account) throw new RpcError("NOT_FOUND", `${row.account} isn't connected through Stella anymore.`);
  const mail = await gmailReadMail(await account.get(), row.message_id).catch(() => null);
  const snapshot = await ctx.host.snapshot();
  const zone = zoneOf(ctx, snapshot);
  if (writingOff(ctx, snapshot.plan, zone)) {
    const paused = usageOf(ctx.now, stateOf(ctx.db), snapshot.plan, zone, payerOf(ctx)).capped;
    throw new RpcError(
      "RATE_LIMITED",
      paused
        ? "Email's allowance is used up for now, so Stella can't write replies until it resets. You can still type one."
        : "Stella writes replies on a paid plan or with your own OpenRouter key. You can still type one.",
    );
  }
  const { body, usd } = await writeVoiceReply(accessOf(ctx, snapshot), {
    words: args.words,
    from: `${row.from_name} <${row.from_address}>`,
    subject: row.subject,
    text: mail?.text ?? "",
    ...(args.draft ? { draft: args.draft } : {}),
    voice: await voiceOf(ctx),
  });
  recordLineCost(ctx, zone, usd);
  if (!body) throw new RpcError("UNAVAILABLE", "Couldn't write the reply. Try again.");
  return { body };
};

const noiseRows = (db: OwnerDbReader, now: number, address?: string): ItemRow[] =>
  db.all<ItemRow>(
    `SELECT * FROM email_items WHERE (bucket = 'noise' OR state = 'dismissed') AND cleared = 0 AND sorted_at > ?
       ${address ? "AND from_address = ?" : ""} ORDER BY received_at DESC LIMIT 400`,
    now - NOISE_WINDOW_MS,
    ...(address ? [address] : []),
  );

const unsubscribeOf = (row: ItemRow): GmailUnsubscribe | null => {
  if (!row.unsubscribe) return null;
  try {
    return JSON.parse(row.unsubscribe) as GmailUnsubscribe;
  } catch {
    return null;
  }
};

const noiseSenders = (db: OwnerDbReader, now: number): EmailNoiseSender[] => {
  const groups = new Map<string, ItemRow[]>();
  for (const row of noiseRows(db, now)) {
    const list = groups.get(row.from_address) ?? [];
    list.push(row);
    groups.set(row.from_address, list);
  }
  const unsubscribed = new Set(
    db.all<{ address: string }>("SELECT address FROM email_senders WHERE unsubscribed_at IS NOT NULL").map((row) => row.address),
  );
  return [...groups.entries()]
    .map(([address, rows]): EmailNoiseSender => {
      const ways = rows.map(unsubscribeOf).filter((entry): entry is GmailUnsubscribe => entry !== null);
      const stella = ways.some((way) => (way.oneClick && way.url) || way.mailto);
      const link = ways.some((way) => way.url);
      return {
        address,
        name: rows[0]!.from_name || address,
        count: rows.length,
        latestSubject: rows[0]!.subject,
        latestAt: rows[0]!.received_at,
        itemIds: rows.map((row) => row.item_id),
        ...(stella ? { unsubscribe: "stella" as const } : link ? { unsubscribe: "link" as const } : {}),
        ...(unsubscribed.has(address) ? { unsubscribed: true } : {}),
      };
    })
    .sort((a, b) => b.count - a.count || b.latestAt - a.latestAt)
    .slice(0, NOISE_SENDERS);
};

const unsubscribe = async (ctx: OwnerContext, args: { address: string }): Promise<{ done: boolean; url?: string }> => {
  enforceOwnerRateLimit(ctx.db, ctx.now, "email.unsubscribe", { count: 60, windowMs: HOUR }, "Too many changes. Try again later.");
  const address = args.address.trim().toLowerCase();
  const row = ctx.db.one<ItemRow>(
    "SELECT * FROM email_items WHERE from_address = ? AND unsubscribe IS NOT NULL ORDER BY received_at DESC LIMIT 1",
    address,
  );
  const way = row ? unsubscribeOf(row) : null;
  if (!row || !way) throw new RpcError("NOT_FOUND", "This sender has no unsubscribe link.");
  let done = false;
  if (way.oneClick && way.url) {
    const response = await fetch(way.url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    }).catch(() => null);
    done = Boolean(response && response.status < 400);
  }
  if (!done && way.mailto) {
    const target = new URL(way.mailto);
    const to = decodeURIComponent(target.pathname);
    const account = (await liveAccounts(ctx)).find((entry) => entry.email === row.account);
    if (account && to.includes("@")) {
      await runGoogleAction(await account.get(), "gmail", "GMAIL_SEND_EMAIL", {
        to: [to],
        subject: target.searchParams.get("subject") || "unsubscribe",
        body: target.searchParams.get("body") || "unsubscribe",
      });
      done = true;
    }
  }
  if (!done) {
    if (way.url) return { done: false, url: way.url };
    throw new RpcError("UNAVAILABLE", "Couldn't unsubscribe from this sender.");
  }
  ctx.db.run(
    `INSERT INTO email_senders (address, bucket, corrections, updated_at, unsubscribed_at) VALUES (?, 'noise', 0, ?, ?)
     ON CONFLICT (address) DO UPDATE SET bucket = 'noise', updated_at = excluded.updated_at, unsubscribed_at = excluded.unsubscribed_at`,
    address,
    ctx.now,
    ctx.now,
  );
  addLog(ctx, { kind: "unsubscribed", who: row.from_name || address });
  log("unsubscribed", { owner: ctx.ownerId.slice(0, 12) });
  return { done: true };
};

const clearSender = async (ctx: OwnerContext, args: { address: string }): Promise<{ cleared: number }> => {
  enforceOwnerRateLimit(ctx.db, ctx.now, "email.clearSender", { count: 120, windowMs: HOUR }, "Too many changes. Try again later.");
  const rows = noiseRows(ctx.db, ctx.now, args.address.trim().toLowerCase());
  if (rows.length === 0) return { cleared: 0 };
  const accounts = await liveAccounts(ctx);
  const cleared: ItemRow[] = [];
  for (const email of new Set(rows.map((row) => row.account))) {
    const account = accounts.find((entry) => entry.email === email);
    if (!account) continue;
    const own = rows.filter((row) => row.account === email);
    try {
      await gmailArchiveMany(
        await account.get(),
        own.map((row) => row.message_id),
      );
      cleared.push(...own);
    } catch (error) {
      if (error instanceof GoogleApiError) throw new RpcError("UNAVAILABLE", error.message);
      throw error;
    }
  }
  if (cleared.length === 0) throw new RpcError("NOT_FOUND", "That inbox isn't connected through Stella anymore.");
  const ids = cleared.map((row) => row.item_id);
  ctx.db.run(`UPDATE email_items SET cleared = 1, archived = 1 WHERE item_id IN (${placeholders(ids)})`, ...ids);
  addLog(ctx, { kind: "cleared", who: cleared[0]!.from_name || cleared[0]!.from_address, count: cleared.length });
  return { cleared: cleared.length };
};

/** Items the user dealt with in Gmail itself: a reply they sent there settles the item. */
const settleFromSent = (ctx: OwnerContext, mail: GmailMail): void => {
  const row = unsettledMatterFor(ctx.db, [mail.threadId]);
  if (row && mail.receivedAt >= row.received_at) settleAs(ctx, row, "replied_in_gmail");
};

/** ...and so does archiving it there. A few items are checked each tick. */
const settleArchived = async (ctx: OwnerContext): Promise<void> => {
  const rows = ctx.db.all<MatterRow>(
    "SELECT * FROM email_matters WHERE status != 'done' ORDER BY updated_at ASC LIMIT ?",
    SETTLE_CHECKS,
  );
  if (rows.length === 0) return;
  const accounts = new Map((await liveAccounts(ctx)).map((account) => [account.email, account]));
  for (const row of rows) {
    const account = accounts.get(row.account);
    if (!account) continue;
    const labels = await gmailLabelsOf(await account.get(), row.message_id).catch(() => undefined);
    if (labels === undefined) continue;
    if (labels === null || !labels.includes("INBOX")) settleAs(ctx, row, "archived_in_gmail");
  }
};

/**
 * The owner's plan as their turns see it now, so the page follows an upgrade or a lapse at once
 * instead of at the next sync; the plan remembered at the last sync when billing can't say.
 */
const planNow = (ctx: Reader): string => {
  try {
    return billingAccess({ db: ctx.db, env: ctx.env as Cloudflare.Env, now: ctx.now }).plan;
  } catch (error) {
    if (error instanceof BillingConfigError) return stateOf(ctx.db)?.plan ?? "free";
    throw error;
  }
};

const readToday = (ctx: Reader): EmailToday => {
  const state = stateOf(ctx.db);
  const zone = ownerZone(ctx.db) ?? "UTC";
  const midnight = startOfDay(ctx.now, zone);
  const open = openRows(ctx.db, ctx.now).map((row) => toMatter(row, ctx.now));
  const later = ctx.db
    .all<MatterRow>("SELECT * FROM email_matters WHERE status = 'later' AND snooze_until > ? ORDER BY snooze_until LIMIT 100", ctx.now)
    .map((row) => toMatter(row, ctx.now));
  const doneToday = ctx.db
    .all<MatterRow>("SELECT * FROM email_matters WHERE status = 'done' AND settled_at >= ? ORDER BY settled_at DESC LIMIT 40", midnight)
    .map((row) => toMatter(row, ctx.now));
  const openIds = open.map((matter) => matter.matterId).sort().join(",");
  const leadFits = Boolean(state?.today_lead) && jsonList(state?.lead_ids).sort().join(",") === openIds;
  const read = ctx.db.one<{ total: number; noise: number }>(
    "SELECT COUNT(*) AS total, COALESCE(SUM(first_bucket = 'noise'), 0) AS noise FROM email_items WHERE sorted_at >= ?",
    midnight,
  );
  const alerts = ctx.db
    .all<{ digest_id: string; kind: string; created_at: number; matter_ids: string | null }>(
      `SELECT digest_id, kind, created_at, matter_ids FROM email_briefings
        WHERE kind IN ('summary', 'urgent', 'rule') AND matter_ids IS NOT NULL AND created_at > ?
        ORDER BY created_at DESC LIMIT 20`,
      ctx.now - 2 * DAY,
    )
    .map((row): EmailToday["alerts"][number] => ({
      briefingId: row.digest_id,
      kind: row.kind === "urgent" || row.kind === "rule" ? row.kind : "summary",
      at: row.created_at,
      matterIds: jsonList(row.matter_ids),
    }));
  const checked = ctx.db.one<{ at: number | null }>("SELECT MAX(last_sync_at) AS at FROM email_accounts")?.at;
  return {
    enabled: state?.enabled === 1,
    ...(leadFits && state?.today_lead ? { lead: state.today_lead } : {}),
    open,
    later,
    doneToday,
    noise: noiseSenders(ctx.db, ctx.now),
    readToday: { total: read?.total ?? 0, leftOut: read?.noise ?? 0 },
    alerts,
    multipleAccounts: (ctx.db.one<{ count: number }>("SELECT COUNT(*) AS count FROM email_accounts")?.count ?? 0) > 1,
    ...(checked ? { lastCheckedAt: checked } : {}),
    access: accessInfo(ctx, planNow(ctx), zone),
  };
};

const LOG_KINDS: readonly EmailLogKind[] = [
  "briefed",
  "urgent",
  "rule",
  "sent",
  "drafted",
  "done",
  "later",
  "returned",
  "reopened",
  "handled",
  "archived",
  "unsubscribed",
  "cleared",
  "replied_in_gmail",
  "archived_in_gmail",
];

const readHistory = (ctx: { db: OwnerDbReader; now: number }): EmailHistory => {
  const zone = ownerZone(ctx.db) ?? "UTC";
  const since = ctx.now - HISTORY_DAYS * DAY;
  const days = new Map<string, EmailHistoryDay>();
  const dayOf = (at: number): EmailHistoryDay => {
    const day = localParts(at, zone).day;
    let entry = days.get(day);
    if (!entry) {
      entry = { day, read: 0, leftOut: 0, arrived: [], log: [] };
      days.set(day, entry);
    }
    return entry;
  };
  for (const row of ctx.db.all<{ sorted_at: number; noise: number }>(
    "SELECT sorted_at, first_bucket = 'noise' AS noise FROM email_items WHERE sorted_at > ?",
    since,
  )) {
    const entry = dayOf(row.sorted_at);
    entry.read += 1;
    if (row.noise) entry.leftOut += 1;
  }
  for (const row of ctx.db.all<MatterRow>("SELECT * FROM email_matters WHERE arrived_at > ? ORDER BY arrived_at DESC LIMIT 300", since)) {
    dayOf(row.arrived_at).arrived.push(toMatter(row, ctx.now));
  }
  for (const row of ctx.db.all<{
    at: number;
    kind: string;
    who: string | null;
    subject: string | null;
    count: number | null;
    until_at: number | null;
    matter_id: string | null;
  }>("SELECT * FROM email_log WHERE at > ? ORDER BY at DESC LIMIT 600", since)) {
    const kind = LOG_KINDS.find((entry) => entry === row.kind);
    if (!kind) continue;
    dayOf(row.at).log.push({
      at: row.at,
      kind,
      ...(row.who ? { who: row.who } : {}),
      ...(row.subject ? { subject: row.subject } : {}),
      ...(row.count !== null ? { count: row.count } : {}),
      ...(row.until_at !== null ? { until: row.until_at } : {}),
      ...(row.matter_id ? { matterId: row.matter_id } : {}),
    });
  }
  return { days: [...days.values()].sort((a, b) => (a.day < b.day ? 1 : -1)) };
};

// Feed and calls ----------------------------------------------------------------

const toItem = (row: ItemRow): EmailItem => ({
  itemId: row.item_id,
  account: row.account,
  messageId: row.message_id,
  threadId: row.thread_id,
  from: row.from_name,
  fromAddress: row.from_address,
  subject: row.subject,
  bucket: row.bucket as EmailBucket,
  reason: row.reason as EmailReason,
  receivedAt: row.received_at,
  state: row.state as EmailItemState,
  ...(row.line ? { line: row.line } : {}),
  ...(row.rule_id ? { ruleId: row.rule_id } : {}),
  ...(row.corrected ? { corrected: true } : {}),
  ...(row.archived ? { archived: true } : {}),
});

const DIGESTS_SHOWN = 20;
const SKIPPED_SHOWN = 60;

const bucketRank = (bucket: string): number => (bucket === "worth_knowing" ? 1 : bucket === "noise" ? 2 : 0);

const digestItems = (db: OwnerDbReader, row: DigestRow): EmailItem[] => {
  const rows = db.all<ItemRow>("SELECT * FROM email_items WHERE card_id = ?", row.digest_id);
  let order: string[] = [];
  try {
    const parsed = row.item_ids ? (JSON.parse(row.item_ids) as unknown) : null;
    if (Array.isArray(parsed)) order = parsed.filter((id): id is string => typeof id === "string");
  } catch {
    order = [];
  }
  const position = (id: string): number => {
    const index = order.indexOf(id);
    return index === -1 ? Number.MAX_SAFE_INTEGER : index;
  };
  return rows
    .sort(
      (a, b) =>
        position(a.item_id) - position(b.item_id) ||
        bucketRank(a.first_bucket) - bucketRank(b.first_bucket) ||
        b.received_at - a.received_at,
    )
    .map(toItem);
};

const parseBrief = (text: string): { brief?: EmailBrief } => {
  try {
    const brief = JSON.parse(text) as EmailBrief;
    return brief && typeof brief.lead === "string" && Array.isArray(brief.sections) ? { brief } : {};
  } catch {
    return {};
  }
};

/** Each email row in the chat, opened: what it surfaced, and what was skipped as noise in its stretch. */
const readDigests = (ctx: { db: OwnerDbReader; now: number }): EmailDigests => {
  const rows = ctx.db.all<DigestRow>(
    "SELECT * FROM email_briefings WHERE kind != 'fold' AND created_at > ? ORDER BY created_at DESC LIMIT ?",
    ctx.now - FEED_WINDOW_MS,
    DIGESTS_SHOWN,
  );
  const newestSummary = rows.find((row) => row.kind === "summary")?.digest_id;
  const digests = rows.map((row): EmailDigest => {
    const kind = row.kind === "urgent" || row.kind === "rule" ? row.kind : "summary";
    const previous =
      ctx.db.one<{ created_at: number }>(
        "SELECT created_at FROM email_briefings WHERE kind = 'summary' AND created_at < ? ORDER BY created_at DESC LIMIT 1",
        row.created_at,
      )?.created_at ?? null;
    // The newest summary also lists noise that arrived after it, so nothing skipped is out of sight.
    const until = row.digest_id === newestSummary ? ctx.now : row.created_at;
    const skipped =
      kind === "summary"
        ? ctx.db
            .all<ItemRow>(
              `SELECT * FROM email_items WHERE first_bucket = 'noise' AND card_id IS NULL AND sorted_at > ? AND sorted_at <= ?
               ORDER BY received_at DESC LIMIT ?`,
              previous ?? row.created_at - DAY,
              until,
              SKIPPED_SHOWN,
            )
            .map(toItem)
        : [];
    return {
      digestId: row.digest_id,
      kind,
      createdAt: row.created_at,
      ...(kind === "summary" && previous !== null ? { sinceAt: previous } : {}),
      ...(row.rule_text ? { ruleText: row.rule_text } : {}),
      items: digestItems(ctx.db, row),
      skipped,
      ...(row.brief ? parseBrief(row.brief) : {}),
    };
  });
  return {
    digests,
    multipleAccounts: (ctx.db.one<{ count: number }>("SELECT COUNT(*) AS count FROM email_accounts")?.count ?? 0) > 1,
  };
};

const statusOf = (ctx: Reader, plan: string, zone: string): EmailStatus => {
  const state = stateOf(ctx.db);
  const accounts: EmailAccountStatus[] = ctx.db
    .all<AccountRow>("SELECT * FROM email_accounts ORDER BY created_at")
    .map((row) => ({
      email: row.email,
      live: row.watch_expires_at !== null && row.watch_expires_at > ctx.now,
      ...(row.last_sync_at !== null ? { lastSyncAt: row.last_sync_at } : {}),
      ...(row.last_error ? { error: row.last_error } : {}),
    }));
  const { today: _today, why: _why, ...usage } = usageOf(ctx.now, state, plan, zone, payerOf(ctx));
  return {
    enabled: state?.enabled === 1,
    access: accessInfo(ctx, plan, zone),
    gmailConnected: stellaGoogleAccounts(ctx.db, "gmail").map((account) => account.email ?? account.label),
    accounts,
    needsReconnect: accounts.length === 0 && stellaGoogleAccounts(ctx.db, "gmail").length === 0 && composioGmailOnly(ctx.db),
    usage,
    ...(state?.last_summary_at ? { lastSummaryAt: state.last_summary_at } : {}),
  };
};

const rememberPlan = (ctx: OwnerContext, snapshot: OwnerSnapshot): void => {
  ctx.db.run("UPDATE email_state SET plan = ? WHERE id = 1", snapshot.plan);
};

const readFeed = (ctx: Reader): EmailFeed => {
  const zone = ownerZone(ctx.db) ?? "UTC";
  const items = ctx.db
    .all<ItemRow>(
      "SELECT * FROM email_items WHERE bucket != 'noise' AND state != 'dismissed' AND sorted_at > ? ORDER BY received_at DESC LIMIT ?",
      ctx.now - FEED_WINDOW_MS,
      FEED_ITEMS,
    )
    .map(toItem);
  const noiseCount =
    ctx.db.one<{ count: number }>(
      "SELECT COUNT(*) AS count FROM email_items WHERE (bucket = 'noise' OR state = 'dismissed') AND sorted_at > ?",
      ctx.now - FEED_WINDOW_MS,
    )?.count ?? 0;
  return {
    status: statusOf(ctx, planNow(ctx), zone),
    note: stateOf(ctx.db)?.note ?? "",
    rules: rulesOf(ctx.db).map(toRule),
    items,
    noiseCount,
  };
};

const setEnabled = async (ctx: OwnerContext, args: { enabled: boolean }): Promise<EmailStatus> => {
  ensureState(ctx);
  const snapshot = await ctx.host.snapshot();
  rememberPlan(ctx, snapshot);
  const zone = zoneOf(ctx, snapshot);
  if (!args.enabled) {
    const accounts = await liveAccounts(ctx).catch(() => []);
    for (const account of accounts) {
      await indexWatch(ctx, account.email, false).catch(() => undefined);
      if (!(await watchedElsewhere(ctx, account.email))) await gmailStopWatch(await account.get()).catch(() => undefined);
    }
    for (const job of [TICK_JOB, SUMMARY_JOB, SUMMARY_NOW_ID, NOTE_JOB, LEAD_JOB, LATER_JOB]) ctx.jobs.cancel(job);
    ctx.db.run(
      "UPDATE email_state SET enabled = 0, today_lead = NULL, lead_ids = NULL, voice = NULL, updated_at = ? WHERE id = 1",
      ctx.now,
    );
    ctx.db.run("DELETE FROM email_items");
    ctx.db.run("DELETE FROM email_matters");
    ctx.db.run("DELETE FROM email_log");
    ctx.db.run("DELETE FROM email_accounts");
    ctx.db.run("DELETE FROM email_people");
    return statusOf(ctx, snapshot.plan, zone);
  }
  const live = await liveAccounts(ctx);
  if (live.length === 0) {
    throw new RpcError("CONFLICT", "Connect Gmail through Stella first.");
  }
  const wasOn = enabled(ctx.db);
  ctx.db.run("UPDATE email_state SET enabled = 1, updated_at = ? WHERE id = 1", ctx.now);
  await reconcileAccounts(ctx, { backfill: !wasOn });
  scheduleTick(ctx);
  if (wasOn) scheduleSummaryCheck(ctx, ctx.now + 1_000);
  else ctx.jobs.schedule(SUMMARY_JOB, ctx.now + 1_000, { force: true }, { id: SUMMARY_NOW_ID });
  return statusOf(ctx, snapshot.plan, zone);
};

const requireItem = (ctx: OwnerContext, itemId: string): ItemRow => {
  const row = readItem(ctx.db, itemId);
  if (!row) throw new RpcError("NOT_FOUND", "That email is no longer here.");
  return row;
};

const changed = async (ctx: OwnerContext, payload: unknown): Promise<{ ok: true }> => {
  if (!enabled(ctx.db)) return { ok: true };
  const account = payload && typeof payload === "object" ? String((payload as Record<string, unknown>).account ?? "").toLowerCase() : "";
  if (!account || !ctx.db.one("SELECT 1 AS present FROM email_accounts WHERE email = ?", account)) return { ok: true };
  ctx.jobs.schedule(SYNC_JOB, ctx.now, { account }, { id: `${SYNC_JOB}:${account}` });
  return { ok: true };
};

const emailTool = (ctx: OwnerContext, raw: unknown): { rules: EmailRule[]; note: string; added?: EmailRule } => {
  const args = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const text = (key: string, max: number): string => (typeof args[key] === "string" ? (args[key] as string).trim().slice(0, max) : "");
  ensureState(ctx);
  let added: EmailRule | undefined;
  if (args.action === "add") {
    const words = text("text", 500);
    const when = text("when", 400);
    if (!words || !when) throw new RpcError("BAD_REQUEST", "add needs text and when.");
    if ((ctx.db.one<{ count: number }>("SELECT COUNT(*) AS count FROM email_rules")?.count ?? 0) >= 40) {
      throw new RpcError("CONFLICT", "There are already 40 email instructions; remove one first.");
    }
    const id = ruleId();
    ctx.db.run(
      "INSERT INTO email_rules (rule_id, text, match_text, action, created_at) VALUES (?, ?, ?, ?, ?)",
      id,
      words,
      when,
      args.do === "act" ? "act" : "tell",
      ctx.now,
    );
    added = rulesOf(ctx.db).map(toRule).find((rule) => rule.ruleId === id);
  } else if (args.action === "remove") {
    ctx.db.run("DELETE FROM email_rules WHERE rule_id = ?", text("ruleId", 64));
  } else if (args.action === "note") {
    const note = text("note", NOTE_MAX_CHARS).replace(/\s+/gu, " ");
    ctx.db.run("UPDATE email_state SET note = ?, corrections_since_note = 0, updated_at = ? WHERE id = 1", note, ctx.now);
  } else if (args.action !== "list") {
    throw new RpcError("BAD_REQUEST", "action must be add, list, remove or note.");
  }
  return { rules: rulesOf(ctx.db).map(toRule), note: stateOf(ctx.db)?.note ?? "", ...(added ? { added } : {}) };
};

type MailArgs = EmailCalls["email.mail"]["args"];

const MAIL_TEXT_CHARS = 12_000;

const header = (headers: unknown, name: string): string => {
  if (!Array.isArray(headers)) return "";
  const found = headers.find(
    (entry) => entry && typeof entry === "object" && String((entry as Record<string, unknown>).name).toLowerCase() === name.toLowerCase(),
  ) as Record<string, unknown> | undefined;
  return typeof found?.value === "string" ? found.value : "";
};

/**
 * Reads, replies to or drafts a reply to one email in a Gmail account connected
 * through Stella, so "reply to the second one" works from any device, with the
 * same connection that sorted it.
 */
const mailAction = async (ctx: OwnerContext, args: MailArgs): Promise<{ text: string }> => {
  const accounts = await liveAccounts(ctx);
  const wanted = (args.account ?? "").trim().toLowerCase();
  const account = wanted ? accounts.find((entry) => entry.email === wanted) : accounts.length === 1 ? accounts[0] : undefined;
  if (!account) {
    throw new RpcError(
      "NOT_FOUND",
      accounts.length === 0
        ? "No Gmail is connected through Stella."
        : `Say which account: ${accounts.map((entry) => entry.email).join(", ")}.`,
    );
  }
  const get = await account.get();
  try {
    if (args.action === "read") {
      const mail = (await runGoogleAction(get, "gmail", "GMAIL_GET_EMAIL", { message_id: args.messageId })) as Record<string, unknown>;
      const body = typeof mail.body === "string" ? mail.body : "";
      const attachments = Array.isArray(mail.attachments)
        ? mail.attachments.map((entry) => String((entry as Record<string, unknown>).filename ?? "")).filter(Boolean)
        : [];
      return {
        text: [
          `From: ${String(mail.from ?? "")}`,
          `To: ${String(mail.to ?? "")}`,
          ...(mail.cc ? [`Cc: ${String(mail.cc)}`] : []),
          `Subject: ${String(mail.subject ?? "")}`,
          `Date: ${String(mail.date ?? "")}`,
          `Account: ${account.email}, message_id ${String(mail.id ?? args.messageId)}, thread_id ${String(mail.threadId ?? "")}`,
          ...(attachments.length ? [`Attachments: ${attachments.join(", ")}`] : []),
          "",
          body.slice(0, MAIL_TEXT_CHARS),
        ].join("\n"),
      };
    }
    const body = (args.body ?? "").trim();
    if (!body) throw new RpcError("BAD_REQUEST", "reply and draft need a body.");
    enforceOwnerRateLimit(ctx.db, ctx.now, "email.mail.reply", { count: 30, windowMs: HOUR }, "Too many emails sent. Try again later.");
    const original = (await get(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(args.messageId)}?format=metadata&metadataHeaders=From&metadataHeaders=Reply-To&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject`,
    )) as Record<string, unknown>;
    const headers = original.payload && typeof original.payload === "object" ? (original.payload as Record<string, unknown>).headers : undefined;
    const sender = header(headers, "Reply-To") || header(headers, "From");
    const others = args.all
      ? [...addressesIn(header(headers, "To")), ...addressesIn(header(headers, "Cc"))].filter(
          (address) => address !== account.email && address !== parseAddress(sender).address,
        )
      : [];
    const subject = header(headers, "Subject");
    const input = {
      to: [sender],
      ...(others.length ? { cc: [...new Set(others)] } : {}),
      subject: /^re:/iu.test(subject.trim()) ? subject : `Re: ${subject}`,
      body,
      reply_to_message_id: args.messageId,
    };
    const result = (await runGoogleAction(
      get,
      "gmail",
      args.action === "reply" ? "GMAIL_SEND_EMAIL" : "GMAIL_CREATE_DRAFT",
      input,
    )) as Record<string, unknown>;
    log(args.action === "reply" ? "mail_replied" : "mail_drafted", { owner: ctx.ownerId.slice(0, 12) });
    const recipients = [sender, ...(others.length ? others : [])].join(", ");
    return {
      text:
        args.action === "reply"
          ? `Sent from ${account.email} to ${recipients}, in the email's thread (message_id ${String(result.id ?? "")}).`
          : `Saved a draft reply in ${account.email} to ${recipients}, in the email's thread (draft ${String(result.id ?? "")}).`,
    };
  } catch (error) {
    if (error instanceof GoogleApiError) {
      throw new RpcError(error.status === 404 ? "NOT_FOUND" : "UNAVAILABLE", error.status === 404 ? "That email isn't in this account anymore." : error.message);
    }
    throw error;
  }
};

const FOUND = object({
  account: string({ max: 320 }),
  messageId: string({ min: 1, max: 128 }),
  threadId: string({ max: 128 }),
  from: string({ max: 400 }),
  fromAddress: string({ max: 320 }),
  subject: string({ max: 500 }),
  snippet: string({ max: 400 }),
  receivedAt: number(),
  unread: boolean(),
  inInbox: boolean(),
});

const TARGETS = {
  itemId: optional(string({ max: 64 })),
  itemIds: optional(array(string({ max: 64 }), { max: 10 })),
  found: optional(array(FOUND, { max: 10 })),
};

type Target = {
  itemId?: string;
  from: string;
  fromAddress: string;
  subject: string;
  line?: string;
  account: string;
  messageId: string;
  threadId: string;
};

/** The emails a call is about: sorted ones from the store, found ones as the search returned them. */
const resolveTargets = (ctx: OwnerContext, args: EmailTargets): Target[] => {
  const targets: Target[] = [
    ...[...(args.itemId ? [args.itemId] : []), ...(args.itemIds ?? [])].map((itemId): Target => {
      const row = requireItem(ctx, itemId);
      return {
        itemId: row.item_id,
        from: row.from_name,
        fromAddress: row.from_address,
        subject: row.subject,
        ...(row.line ? { line: row.line } : {}),
        account: row.account,
        messageId: row.message_id,
        threadId: row.thread_id,
      };
    }),
    ...(args.found ?? []).map(
      (mail): Target => ({
        from: mail.from,
        fromAddress: mail.fromAddress,
        subject: mail.subject,
        account: mail.account.toLowerCase(),
        messageId: mail.messageId,
        threadId: mail.threadId,
      }),
    ),
  ];
  if (targets.length === 0) throw new RpcError("BAD_REQUEST", "Say which email.");
  return targets;
};

const SEARCH_PER_ACCOUNT = 15;
const SEARCH_SHOWN = 25;

/** Plain words to a Gmail search (by the light model), run across every inbox connected through Stella. */
const searchMail = async (ctx: OwnerContext, words: string): Promise<EmailSearchResult> => {
  enforceOwnerRateLimit(ctx.db, ctx.now, "email.search", { count: 60, windowMs: HOUR }, "Too many searches. Try again later.");
  const accounts = await liveAccounts(ctx);
  if (accounts.length === 0) throw new RpcError("NOT_FOUND", "No Gmail is connected through Stella.");
  const snapshot = await ctx.host.snapshot();
  const zone = zoneOf(ctx, snapshot);
  ensureState(ctx);
  const queries = writingOff(ctx, snapshot.plan, zone)
    ? { q: words.trim(), broader: words.trim() }
    : await gmailQueryFor(
    accessOf(ctx, snapshot),
    words,
    zone,
  )
    .then(({ q, broader, usd }) => {
      recordLineCost(ctx, zone, usd);
      return { q, broader };
    })
    .catch((error: unknown) => {
      log("search_query_failed", { message: errorText(error) });
      return { q: words.trim(), broader: words.trim() };
    });
  const run = async (q: string): Promise<EmailFound[]> =>
    (
      await Promise.all(
        accounts.map(async (account) => {
          try {
            const mails = await gmailSearch(await account.get(), q, SEARCH_PER_ACCOUNT);
            return mails.map(
              (mail): EmailFound => ({
                account: account.email,
                messageId: mail.id,
                threadId: mail.threadId,
                from: mail.fromName || mail.fromAddress,
                fromAddress: mail.fromAddress,
                subject: mail.subject,
                snippet: mail.snippet,
                receivedAt: mail.receivedAt,
                unread: mail.labelIds.includes("UNREAD"),
                inInbox: mail.labelIds.includes("INBOX"),
              }),
            );
          } catch (error) {
            log("search_failed", { message: errorText(error) });
            return [];
          }
        }),
      )
    ).flat();
  let query = queries.q;
  let found = await run(query);
  if (found.length === 0 && queries.broader && queries.broader !== query) {
    query = queries.broader;
    found = await run(query);
  }
  log("searched", { owner: ctx.ownerId.slice(0, 12) });
  return {
    gmailQuery: query,
    results: found
      .sort((a, b) => b.receivedAt - a.receivedAt)
      .slice(0, SEARCH_SHOWN),
  };
};

/** A whole thread, read in place, from a sorted email or a found one. */
const readThread = async (
  ctx: OwnerContext,
  args: { itemId?: string; account?: string; threadId?: string },
): Promise<EmailThread> => {
  enforceOwnerRateLimit(ctx.db, ctx.now, "email.thread", { count: 300, windowMs: HOUR }, "Too many requests. Try again later.");
  const row = args.itemId ? requireItem(ctx, args.itemId) : null;
  const accountEmail = (row?.account ?? args.account ?? "").toLowerCase();
  const threadId = row?.thread_id ?? args.threadId ?? "";
  if (!accountEmail || !threadId) throw new RpcError("BAD_REQUEST", "Say which email.");
  const account = (await liveAccounts(ctx)).find((entry) => entry.email === accountEmail);
  if (!account) throw new RpcError("NOT_FOUND", `${accountEmail} isn't connected through Stella anymore.`);
  let messages;
  try {
    messages = await gmailReadThread(await account.get(), threadId);
  } catch (error) {
    if (error instanceof GoogleApiError) throw new RpcError("UNAVAILABLE", error.message);
    throw error;
  }
  if (!messages || messages.length === 0) throw new RpcError("NOT_FOUND", "That email isn't in this account anymore.");
  return {
    account: account.email,
    threadId,
    subject: messages[0]!.subject,
    messages: messages.map((message) => ({
      messageId: message.id,
      from: message.fromName || message.fromAddress,
      fromAddress: message.fromAddress,
      to: message.to,
      ...(message.cc ? { cc: message.cc } : {}),
      receivedAt: message.receivedAt,
      text: message.text,
      attachments: message.attachments,
      ...(message.draft ? { draft: true } : {}),
    })),
  };
};

const ruleId = (): string => `r${crypto.randomUUID().replace(/-/gu, "").slice(0, 10)}`;

const runningEmailDomain = {
  name: "email",
  migrations: [EMAIL_MIGRATION, EMAIL_DIGESTS_MIGRATION, EMAIL_BRIEF_MIGRATION, EMAIL_BRIEFINGS_MIGRATION, EMAIL_TODAY_MIGRATION, EMAIL_OWN_KEY_MIGRATION],
  calls: {
    "email.setEnabled": {
      scope: "owner",
      parse: object({ enabled: boolean() }),
      handler: setEnabled,
    },
    "email.correct": {
      scope: "owner",
      parse: object({ itemId: string({ max: 64 }), bucket: literal("urgent", "needs_you", "worth_knowing", "noise") }),
      handler: (ctx, args) => {
        const row = requireItem(ctx, args.itemId);
        if (row.bucket !== args.bucket) {
          correct(ctx, row, args.bucket);
          ctx.db.run(
            "UPDATE email_items SET bucket = ?, corrected = 1, state = CASE WHEN ? = 'noise' THEN 'dismissed' ELSE state END WHERE item_id = ?",
            args.bucket,
            args.bucket,
            row.item_id,
          );
        }
        return { ok: true as const };
      },
    },
    "email.dismiss": {
      scope: "owner",
      parse: object({ itemId: string({ max: 64 }) }),
      handler: (ctx, args) => {
        const row = requireItem(ctx, args.itemId);
        if (row.state !== "dismissed") {
          correct(ctx, row, "dismissed");
          ctx.db.run("UPDATE email_items SET state = 'dismissed', corrected = 1 WHERE item_id = ?", row.item_id);
          const matter = row.matter_id ? readMatter(ctx.db, row.matter_id) : null;
          if (matter && matter.status !== "done") {
            ctx.db.run(
              "UPDATE email_matters SET status = 'done', settled_at = ?, settled_how = 'done', snooze_until = NULL, updated_at = ? WHERE matter_id = ?",
              ctx.now,
              ctx.now,
              matter.matter_id,
            );
            addLog(ctx, { kind: "done", subject: matter.headline, matterId: matter.matter_id });
            scheduleLead(ctx);
          }
        }
        return { ok: true as const };
      },
    },
    "email.setNote": {
      scope: "owner",
      parse: object({ note: string({ max: NOTE_MAX_CHARS }) }),
      handler: (ctx, args) => {
        ensureState(ctx);
        const note = args.note.replace(/\s+/gu, " ").trim();
        ctx.db.run("UPDATE email_state SET note = ?, corrections_since_note = 0, updated_at = ? WHERE id = 1", note, ctx.now);
        return { note };
      },
    },
    "email.addRule": {
      scope: "owner",
      parse: object({
        text: string({ min: 1, max: 500 }),
        when: string({ min: 1, max: 400 }),
        action: literal("tell", "act"),
      }),
      handler: (ctx, args) => {
        enforceOwnerRateLimit(ctx.db, ctx.now, "email.addRule", { count: 30, windowMs: HOUR }, "Too many changes. Try again later.");
        if ((ctx.db.one<{ count: number }>("SELECT COUNT(*) AS count FROM email_rules")?.count ?? 0) >= 40) {
          throw new RpcError("CONFLICT", "There are already 40 email instructions; remove one first.");
        }
        ensureState(ctx);
        const id = ruleId();
        ctx.db.run(
          "INSERT INTO email_rules (rule_id, text, match_text, action, created_at) VALUES (?, ?, ?, ?, ?)",
          id,
          args.text.trim(),
          args.when.trim(),
          args.action,
          ctx.now,
        );
        const rules = rulesOf(ctx.db).map(toRule);
        return { rule: rules.find((rule) => rule.ruleId === id)!, rules };
      },
    },
    "email.removeRule": {
      scope: "owner",
      parse: object({ ruleId: string({ max: 64 }) }),
      handler: (ctx, args) => {
        ctx.db.run("DELETE FROM email_rules WHERE rule_id = ?", args.ruleId);
        return { rules: rulesOf(ctx.db).map(toRule) };
      },
    },
    "email.rules": {
      scope: "owner",
      parse: empty(),
      handler: (ctx) => ({ rules: rulesOf(ctx.db).map(toRule), note: stateOf(ctx.db)?.note ?? "" }),
    },
    "email.settle": {
      scope: "owner",
      parse: object({
        matterId: string({ max: 64 }),
        status: literal("open", "later", "done"),
        laterUntil: optional(number()),
      }),
      handler: settle,
    },
    "email.sendReply": {
      scope: "owner",
      parse: object({ matterId: string({ max: 64 }), body: string({ min: 1, max: 20_000 }), mode: literal("send", "draft") }),
      handler: sendReply,
    },
    "email.voiceReply": {
      scope: "owner",
      parse: object({ matterId: string({ max: 64 }), words: string({ min: 1, max: 4_000 }), draft: optional(string({ max: 20_000 })) }),
      handler: voiceReply,
    },
    "email.unsubscribe": {
      scope: "owner",
      parse: object({ address: string({ min: 3, max: 320 }) }),
      handler: unsubscribe,
    },
    "email.clearSender": {
      scope: "owner",
      parse: object({ address: string({ min: 3, max: 320 }) }),
      handler: clearSender,
    },
    "email.mail": {
      scope: "owner",
      parse: object({
        action: literal("read", "reply", "draft"),
        account: optional(string({ max: 320 })),
        messageId: string({ min: 1, max: 128 }),
        body: optional(string({ max: 20_000 })),
        all: optional(boolean()),
      }),
      handler: mailAction,
    },
    "email.archive": {
      scope: "owner",
      parse: object({ ...TARGETS, archived: boolean() }),
      handler: async (ctx, args) => {
        enforceOwnerRateLimit(ctx.db, ctx.now, "email.archive", { count: 120, windowMs: HOUR }, "Too many changes. Try again later.");
        const targets = resolveTargets(ctx, args);
        const accounts = await liveAccounts(ctx);
        for (const target of targets) {
          const account = accounts.find((entry) => entry.email === target.account);
          if (!account) throw new RpcError("NOT_FOUND", `${target.account} isn't connected through Stella anymore.`);
          try {
            await gmailSetInbox(await account.get(), target.messageId, !args.archived);
          } catch (error) {
            if (error instanceof GoogleApiError) {
              throw new RpcError(error.status === 404 ? "NOT_FOUND" : "UNAVAILABLE", error.status === 404 ? "That email isn't in this account anymore." : error.message);
            }
            throw error;
          }
          if (target.itemId) {
            ctx.db.run("UPDATE email_items SET archived = ? WHERE item_id = ?", args.archived ? 1 : 0, target.itemId);
            const item = readItem(ctx.db, target.itemId);
            const matter = item?.matter_id ? readMatter(ctx.db, item.matter_id) : null;
            if (matter && args.archived) settleAs(ctx, matter, "archived");
          }
        }
        log(args.archived ? "archived" : "unarchived", { owner: ctx.ownerId.slice(0, 12), count: targets.length });
        return { ok: true as const };
      },
    },
    "email.focus": {
      scope: "owner",
      parse: object({ ...TARGETS, action: literal("reply", "handle", "tell", "suggest"), matterId: optional(string({ max: 64 })) }),
      handler: async (ctx, args) => {
        enforceOwnerRateLimit(ctx.db, ctx.now, "email.focus", { count: 120, windowMs: HOUR }, "Too many requests. Try again later.");
        const targets = resolveTargets(ctx, args);
        // Handing an item to Stella (its prepared step, a reply or "handle it") settles it; telling Stella something doesn't.
        const matter = args.matterId && args.action !== "tell" ? readMatter(ctx.db, args.matterId) : null;
        if (matter) settleAs(ctx, matter, "handled");
        const conversationId = readMainConversationId(ctx.db);
        if (!conversationId) return { ok: true as const };
        const snapshot = await ctx.host.snapshot();
        await ctx.host.appendConversationNote({
          conversationId,
          ownerGeneration: snapshot.ownerGeneration,
          noteId: `email-focus-${targets[0]!.messageId}-${ctx.now}`.slice(0, 120),
          text: emailFocusNoteText(targets, args.action as EmailFocusAction),
        });
        return { ok: true as const };
      },
    },
    "email.search": {
      scope: "owner",
      parse: object({ query: string({ min: 1, max: 300 }) }),
      handler: (ctx, args) => searchMail(ctx, args.query),
    },
    "email.thread": {
      scope: "owner",
      parse: object({
        itemId: optional(string({ max: 64 })),
        account: optional(string({ max: 320 })),
        threadId: optional(string({ max: 128 })),
      }),
      handler: (ctx, args) => readThread(ctx, args),
    },
    "email.checkNow": {
      scope: "owner",
      parse: empty(),
      handler: async (ctx) => {
        enforceOwnerRateLimit(ctx.db, ctx.now, "email.checkNow", { count: 10, windowMs: 10 * MIN }, "Checked recently. Try again in a few minutes.");
        const snapshot = await ctx.host.snapshot();
        if (enabled(ctx.db)) {
          ctx.jobs.schedule(TICK_JOB, ctx.now, {}, { id: TICK_JOB });
          ctx.jobs.schedule(SUMMARY_JOB, ctx.now + 20_000, { force: true }, { id: SUMMARY_NOW_ID });
        }
        return statusOf(ctx, snapshot.plan, zoneOf(ctx, snapshot));
      },
    },
  },
  views: {
    "email.feed": {
      parse: empty(),
      read: (ctx) => readFeed(ctx),
    },
    "email.digests": {
      parse: empty(),
      read: (ctx) => readDigests(ctx),
    },
    "email.today": {
      parse: empty(),
      read: (ctx) => readToday(ctx),
    },
    "email.history": {
      parse: empty(),
      read: (ctx) => readHistory(ctx),
    },
  },
  internal: {
    "email.changed": changed,
    "email.tool": async (ctx: OwnerContext, args: unknown) => {
      const raw = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
      if (raw.action === "read" || raw.action === "reply" || raw.action === "draft") {
        return await mailAction(ctx, {
          action: raw.action,
          messageId: typeof raw.message_id === "string" ? raw.message_id.trim().slice(0, 128) : "",
          ...(typeof raw.account === "string" ? { account: raw.account.slice(0, 320) } : {}),
          ...(typeof raw.body === "string" ? { body: raw.body.slice(0, 20_000) } : {}),
          ...(raw.all === true ? { all: true } : {}),
        });
      }
      return emailTool(ctx, args);
    },
    "email.summaryNow": async (ctx: OwnerContext) => {
      const snapshot = await ctx.host.snapshot();
      return { posted: await postSummary(ctx, snapshot, zoneOf(ctx, snapshot), true) };
    },
    "email.sortProbe": async (ctx: OwnerContext, args: unknown) => {
      const input = object({ mails: array(object({ from: string({ max: 300 }), subject: string({ max: 300 }), text: string({ max: 4000 }), bulk: boolean() }), { max: 20 }) })(args);
      const snapshot = await ctx.host.snapshot();
      ensureState(ctx);
      const zone = zoneOf(ctx, snapshot);
      const results: unknown[] = [];
      for (const mail of input.mails) {
        const parsed = { name: mail.from, address: mail.from.toLowerCase() };
        const started = Date.now();
        const verdict = await sortEmail(
          accessOf(ctx, snapshot),
          {
            note: stateOf(ctx.db)?.note ?? "",
            account: "probe@example.com",
            from: mail.from,
            to: "probe@example.com",
            cc: "",
            subject: mail.subject,
            receivedAt: ctx.now,
            text: mail.text,
            labels: [],
            bulk: mail.bulk,
            wroteToSender: wroteTo(ctx.db, parsed.address),
            rules: rulesOf(ctx.db).map((rule) => ({ ruleId: rule.rule_id, when: rule.match_text })),
          },
        );
        recordSort(ctx, zone, verdict.inputTokens);
        results.push({ subject: mail.subject, ...verdict, ms: Date.now() - started });
      }
      return { results };
    },
  },
  jobs: {
    [SYNC_JOB]: { run: (ctx, payload) => runSync(ctx, payload), maxAttempts: 3 },
    [TICK_JOB]: { run: (ctx) => runTick(ctx), maxAttempts: 2 },
    [SUMMARY_JOB]: { run: (ctx, payload) => runSummary(ctx, payload), maxAttempts: 3 },
    [NOTE_JOB]: { run: (ctx) => runNote(ctx), maxAttempts: 2 },
    [LEAD_JOB]: { run: (ctx) => runLead(ctx), maxAttempts: 2 },
    [LATER_JOB]: { run: (ctx) => runLater(ctx), maxAttempts: 3 },
  },
  purge: async (ctx) => {
    for (const job of [TICK_JOB, SUMMARY_JOB, SUMMARY_NOW_ID, NOTE_JOB, LEAD_JOB, LATER_JOB]) ctx.jobs.cancel(job);
    const addresses = ctx.db.all<{ email: string }>("SELECT email FROM email_accounts");
    for (const { email } of addresses) await indexWatch(ctx, email, false).catch(() => undefined);
    for (const table of ["email_matters", "email_log", "email_briefings", "email_items", "email_accounts", "email_people", "email_rules", "email_senders", "email_corrections", "email_state"]) {
      ctx.db.run(`DELETE FROM ${table}`);
    }
    return { pending: false };
  },
} satisfies OwnerDomain;

const unavailable = (): never => {
  throw new RpcError("NOT_FOUND", "Email isn't available.");
};

/**
 * Email runs only where it is turned on (`email-feature.ts`). Elsewhere every
 * call and view refuses, jobs and Gmail's change pings end without work, and
 * the tool says it isn't available; `email.available` says which.
 */
type LooseCall = { handler: (ctx: OwnerContext, args: unknown) => unknown };
type LooseView = { parse: unknown; read: (ctx: OwnerViewContext, args: unknown) => unknown };

const gateEmailDomain = (domain: typeof runningEmailDomain): OwnerDomain => {
  const on = (env: unknown): boolean => emailFeatureOnFor(env);
  const calls: Record<string, LooseCall> = {};
  for (const [name, def] of Object.entries(domain.calls as unknown as Record<string, LooseCall>)) {
    calls[name] = { ...def, handler: (ctx, args) => (on(ctx.env) ? def.handler(ctx, args) : unavailable()) };
  }
  const views: Record<string, LooseView> = {
    "email.available": { parse: empty(), read: (ctx) => ({ available: on(ctx.env) }) },
  };
  for (const [name, def] of Object.entries(domain.views as unknown as Record<string, LooseView>)) {
    views[name] = { ...def, read: (ctx, args) => (on(ctx.env) ? def.read(ctx, args) : unavailable()) };
  }
  const internal: Record<string, InternalDef> = {};
  for (const [name, run] of Object.entries(domain.internal as Record<string, InternalDef>)) {
    internal[name] = (ctx, args) => (on(ctx.env) ? run(ctx, args) : name === "email.changed" ? { ok: true } : unavailable());
  }
  const jobs: Record<string, JobDef> = {};
  for (const [name, def] of Object.entries(domain.jobs as Record<string, JobDef>)) {
    jobs[name] = { ...def, run: (ctx, payload) => (on(ctx.env) ? def.run(ctx, payload) : undefined) };
  }
  return { ...domain, calls, views, internal, jobs } as unknown as OwnerDomain;
};

export const emailDomain = gateEmailDomain(runningEmailDomain);
