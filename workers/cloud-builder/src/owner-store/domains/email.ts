import {
  EMAIL_PUSH_KIND,
  type EmailCalls,
  type EmailPageState,
  type EmailPushData,
  type EmailRule,
  type EmailRuleKind,
} from "@stella/contracts/backend/email";
import {
  applyEmailPageUpdate,
  describeEmailPage,
  readEmailPage,
  type EmailPage,
  type EmailPageItem,
  type EmailPageUpdate,
} from "@stella/contracts/email-page";
import type { OwnerSnapshot } from "@stella/contracts/turn-plane/owner-snapshot";
import { emailFeatureOnFor } from "@stella/contracts/email-feature";
import { GoogleApiError, gmailFetcher, runGoogleAction, type Fetcher } from "../../integrations/google.js";
import {
  addressesIn,
  parseAddress,
  gmailDeleteDraft,
  gmailHistorySince,
  gmailProfile,
  gmailReadMail,
  gmailReadThread,
  gmailSearch,
  gmailSentPeople,
  gmailSetThreadInbox,
  gmailStopWatch,
  gmailWatch,
  type GmailMail,
} from "../../integrations/gmail-mail.js";
import {
  DECISION_INPUT_USD_PER_M,
  DecisionRefused,
  WAKE_THRESHOLD,
  checkWake,
  type SorterAccess,
} from "../../integrations/email-sorter.js";
import { boolean, empty, json, object } from "../args.js";
import { RpcError } from "../errors.js";
import { enforceOwnerRateLimit } from "../rate-limit.js";
import type { InternalDef, JobDef, OwnerContext, OwnerDbReader, OwnerDomain, OwnerViewContext } from "../registry.js";
import { readMainConversationId } from "./conversations.js";
import { livePushTokens, resolveCurrentDeviceId, sendPushMessages } from "./devices.js";
import {
  FAKE_GMAIL_DOMAIN,
  FAKE_GMAIL_MIGRATION,
  addFakeGmailInbox,
  fakeGmailEnabled,
  fakeGmailFetcher,
  fakeGmailInboxes,
  fakeGmailList,
  removeFakeGmailInbox,
} from "./fake-gmail.js";
import {
  forgetStellaGoogleAccountsForTest,
  stellaGmailTokens,
  stellaGoogleAccounts,
  stellaGoogleAvailable,
} from "./google-accounts.js";
import { ownerZone } from "./schedules.js";
import { ownerModeEnabled } from "../../selfhost/owner-mode.js";

/**
 * Email, read by Stella herself.
 *
 * New mail from every Gmail account connected through Stella is synced here
 * (Gmail push, else polling) and kept briefly. Stella reads it in batches, a
 * few times a day and whenever she is asked: a backend-started turn tells her
 * there is mail, and the `email` tool's `inbox` gives her a compact listing.
 * She keeps one living page (see email-page.ts) that every client shows, and
 * mentions it in the chat only when something needs the user.
 *
 * A cheap gate (email-sorter.ts) looks at each arriving email for one thing:
 * whether it should wake Stella before her next read. It never decides what
 * the user sees. Whatever reaches the user's phone, Stella marked urgent.
 */

const SYNC_JOB = "email.sync";
const TICK_JOB = "email.tick";
const READ_JOB = "email.read";
const WAKE_JOB = "email.wake";
/** Jobs of the sorter Stella replaced; cancelled wherever they are still queued. */
const RETIRED_JOBS = ["email.summary", "email.summary:now", "email.note", "email.lead", "email.later"];

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const TICK_LIVE_MS = 30 * MIN;
const TICK_POLL_MS = 3 * MIN;
const WATCH_RENEW_MS = DAY;
const MAX_PER_SYNC = 25;
const BACKFILL_MAX = 30;
const MAIL_RETENTION_MS = 14 * DAY;
const SNIPPET_CHARS = 320;
const WAKE_DEBOUNCE_MS = 20_000;

/** Local hours Stella reads the mail on her own. */
const READ_HOURS = { free: [9], paid: [8, 13, 18] } as const;
/** Times a day the gate may wake her before a read. */
const WAKES_PER_DAY = { free: 2, paid: 6 } as const;
const QUIET_FROM_HOUR = 22;
const QUIET_UNTIL_HOUR = 7;

const INBOX_THREADS_SHOWN = 120;
const BULK_FOLD = 3;
const THREAD_TEXT_CHARS = 14_000;
const MESSAGE_TEXT_CHARS = 5_000;
const SEARCH_PER_ACCOUNT = 15;
const SEARCH_SHOWN = 25;
const RULES_MAX = 60;

/**
 * The gate's allowance per owner on Stella's key. The gate only answers
 * "now or later", so a month of mail costs a fraction of a cent.
 */
const CAPS = {
  free: { perDay: 40, usdPerMonth: 0.01 },
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

/**
 * Stella reads the mail herself: what arrived (and what the user sent) is
 * kept here until she has read it, and her page is one document.
 */
export const EMAIL_STELLA_MIGRATION = {
  id: "email.7-stella",
  statements: [
    `CREATE TABLE email_mail (
       mail_id TEXT PRIMARY KEY,
       account TEXT NOT NULL,
       message_id TEXT NOT NULL,
       thread_id TEXT NOT NULL,
       direction TEXT NOT NULL,
       from_name TEXT NOT NULL,
       from_address TEXT NOT NULL,
       to_line TEXT NOT NULL,
       cc_line TEXT NOT NULL,
       subject TEXT NOT NULL,
       snippet TEXT NOT NULL,
       bulk INTEGER NOT NULL DEFAULT 0,
       attachments TEXT,
       received_at INTEGER NOT NULL,
       arrived_at INTEGER NOT NULL,
       urgent_p REAL,
       rule_id TEXT,
       woke INTEGER NOT NULL DEFAULT 0,
       read_at INTEGER,
       UNIQUE (account, message_id)
     )`,
    "CREATE INDEX email_mail_unread ON email_mail (read_at, received_at)",
    `CREATE TABLE email_page (
       id INTEGER PRIMARY KEY CHECK (id = 1),
       json TEXT NOT NULL,
       updated_at INTEGER NOT NULL
     )`,
    "ALTER TABLE email_state ADD COLUMN next_read_at INTEGER",
    "ALTER TABLE email_state ADD COLUMN wake_day TEXT",
    "ALTER TABLE email_state ADD COLUMN wakes_today INTEGER NOT NULL DEFAULT 0",
  ],
};

type StateRow = {
  enabled: number;
  note: string;
  month: string | null;
  month_sorted: number;
  month_tokens: number;
  month_line_usd: number;
  sort_day: string | null;
  sorted_today: number;
  plan: string | null;
  month_own_usd?: number;
  own_key_refused_at?: number | null;
  own_key_error?: string | null;
  next_read_at?: number | null;
  wake_day?: string | null;
  wakes_today?: number;
};

type AccountRow = {
  email: string;
  history_id: string | null;
  watch_expires_at: number | null;
  last_sync_at: number | null;
  last_error: string | null;
  people_at: number | null;
};

type MailRow = {
  mail_id: string;
  account: string;
  message_id: string;
  thread_id: string;
  direction: "in" | "out";
  from_name: string;
  from_address: string;
  to_line: string;
  cc_line: string;
  subject: string;
  snippet: string;
  bulk: number;
  attachments: string | null;
  received_at: number;
  arrived_at: number;
  urgent_p: number | null;
  rule_id: string | null;
  woke: number;
  read_at: number | null;
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

type Reader = { db: OwnerDbReader; env: unknown; now: number };

const stateOf = (db: OwnerDbReader): StateRow | null =>
  db.one<StateRow>(
    `SELECT enabled, note, month, month_sorted, month_tokens, month_line_usd, sort_day, sorted_today, plan,
            month_own_usd, own_key_refused_at, own_key_error, next_read_at, wake_day, wakes_today
       FROM email_state WHERE id = 1`,
  );

const ensureState = (ctx: OwnerContext): void => {
  ctx.db.run("INSERT INTO email_state (id, enabled, updated_at) VALUES (1, 0, ?) ON CONFLICT (id) DO NOTHING", ctx.now);
};

const enabled = (db: OwnerDbReader): boolean => stateOf(db)?.enabled === 1;

const env = (ctx: OwnerContext, name: string): string =>
  String((ctx.env as unknown as Record<string, unknown>)[name] ?? "").trim();

const pushTopic = (ctx: OwnerContext): string => env(ctx, "GMAIL_PUSH_TOPIC");

const gateSwitchedOff = (ctx: OwnerContext): boolean => env(ctx, "EMAIL_SORTING_DISABLED") === "1";

const zoneOf = (ctx: { db: OwnerDbReader }, snapshot?: OwnerSnapshot): string => {
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

const clock = (at: number, zone: string, withDay: boolean): string => {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour: "numeric",
      minute: "2-digit",
      ...(withDay ? { weekday: "short", month: "short", day: "numeric" } : {}),
    }).format(at);
  } catch {
    return new Date(at).toISOString().slice(0, 16).replace("T", " ");
  }
};

const errorText = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).replace(/\s+/gu, " ").slice(0, 300);

const log = (event: string, fields: Record<string, unknown> = {}): void => {
  console.log(JSON.stringify({ event: `email_${event}`, ...fields }));
};

const liveAccounts = async (ctx: OwnerContext): Promise<LiveAccount[]> => {
  // A test account with a fake inbox reads only fake inboxes, whatever else is connected.
  const fake = fakeGmailInboxes(ctx);
  if (fake.length > 0) return fake.map((email) => ({ email, get: async () => fakeGmailFetcher(ctx.db, email, () => ctx.now) }));
  if (!stellaGoogleAvailable(ctx.env)) return [];
  const tokens = await stellaGmailTokens(ctx);
  return tokens.map((account) => ({
    email: account.email.toLowerCase(),
    get: async () => gmailFetcher(await account.accessToken()),
  }));
};

const composioGmailOnly = (db: OwnerDbReader): boolean =>
  Boolean(db.one("SELECT 1 AS present FROM integration_connections WHERE integration_id = 'gmail'"));

const planOf = (ctx: { db: OwnerDbReader }, snapshot?: OwnerSnapshot): "free" | "paid" =>
  (snapshot?.plan ?? stateOf(ctx.db)?.plan ?? "free") === "free" ? "free" : "paid";

// The gate's allowance -------------------------------------------------------

const ownKeyRow = (db: OwnerDbReader): { status: string; updated_at: number } | null => {
  try {
    return db.one<{ status: string; updated_at: number }>(
      "SELECT status, updated_at FROM provider_credentials WHERE provider = 'openrouter'",
    );
  } catch {
    return null;
  }
};

/** Whose key pays for the gate right now: Stella's allowance, the owner's OpenRouter key, or a self-hosted server's. */
const payerOf = (ctx: Reader): "stella" | "own_key" | "server" => {
  if (ownerModeEnabled(ctx.env)) return "server";
  const key = ownKeyRow(ctx.db);
  if (key?.status !== "ok") return "stella";
  const refusedAt = stateOf(ctx.db)?.own_key_refused_at ?? null;
  return refusedAt !== null && refusedAt >= key.updated_at && ctx.now - refusedAt < OWN_KEY_RETRY_MS ? "stella" : "own_key";
};

const gateCapped = (ctx: Reader, plan: "free" | "paid", zone: string): boolean => {
  const state = stateOf(ctx.db);
  const { month, day } = localParts(ctx.now, zone);
  const sameMonth = state?.month === month;
  const own = payerOf(ctx) !== "stella";
  const costUsd = own
    ? 0
    : ((sameMonth ? state.month_tokens : 0) / 1_000_000) * DECISION_INPUT_USD_PER_M + (sameMonth ? state.month_line_usd : 0);
  const caps = own ? { perDay: OWN_KEY_PER_DAY, usdPerMonth: Number.POSITIVE_INFINITY } : CAPS[plan];
  const today = state?.sort_day === day ? state.sorted_today : 0;
  return costUsd >= caps.usdPerMonth || today >= caps.perDay;
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

const recordGate = (ctx: OwnerContext, zone: string, inputTokens: number): void => {
  const { month, day } = localParts(ctx.now, zone);
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

// Rules ------------------------------------------------------------------------

const rulesOf = (db: OwnerDbReader): RuleRow[] =>
  db.all<RuleRow>(
    "SELECT rule_id, text, match_text, action, created_at, fired_count, last_fired_at FROM email_rules ORDER BY created_at",
  );

const kindOf = (action: string): EmailRuleKind => (action === "act" ? "act" : action === "ignore" ? "ignore" : "wake");

const toRule = (row: RuleRow): EmailRule => ({
  ruleId: row.rule_id,
  text: row.text,
  when: row.match_text,
  kind: kindOf(row.action),
  createdAt: row.created_at,
  firedCount: row.fired_count,
  ...(row.last_fired_at !== null ? { lastFiredAt: row.last_fired_at } : {}),
});

const ruleId = (): string => `r${crypto.randomUUID().replace(/-/gu, "").slice(0, 10)}`;

const rulesText = (db: OwnerDbReader): string => {
  const rules = rulesOf(db).map(toRule);
  const note = stateOf(db)?.note?.trim() ?? "";
  return [
    note ? `What matters to the user, in their words: ${note}` : "",
    rules.length > 0
      ? `The user's email rules:\n${rules.map((rule) => `- ${rule.ruleId} (${rule.kind}): "${rule.text}" — about: ${rule.when}`).join("\n")}`
      : "The user has no email rules yet.",
  ]
    .filter(Boolean)
    .join("\n");
};

// People and the gate ---------------------------------------------------------------

const wroteTo = (db: OwnerDbReader, address: string): number =>
  db.one<{ sent_count: number }>("SELECT sent_count FROM email_people WHERE address = ?", address)?.sent_count ?? 0;

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

/** The gate's answer for one arriving email: whether it can wait for Stella's next read. */
const gateOne = async (
  ctx: OwnerContext,
  snapshot: OwnerSnapshot,
  zone: string,
  account: string,
  mail: GmailMail,
): Promise<{ urgentP: number; ruleId?: string } | null> => {
  if (gateSwitchedOff(ctx) || gateCapped(ctx, planOf(ctx, snapshot), zone)) return null;
  const wakeRules = rulesOf(ctx.db).filter((rule) => kindOf(rule.action) !== "ignore");
  try {
    const verdict = await checkWake(accessOf(ctx, snapshot), {
      note: stateOf(ctx.db)?.note ?? "",
      account,
      from: mail.from,
      to: mail.to,
      cc: mail.cc,
      subject: mail.subject,
      receivedAt: mail.receivedAt,
      text: mail.text,
      bulk: mail.bulk,
      wroteToSender: wroteTo(ctx.db, mail.fromAddress),
      rules: wakeRules.map((rule) => ({ ruleId: rule.rule_id, when: rule.match_text })),
    });
    recordGate(ctx, zone, verdict.inputTokens);
    return { urgentP: verdict.urgentP, ...(verdict.ruleId ? { ruleId: verdict.ruleId } : {}) };
  } catch (error) {
    if (!(error instanceof DecisionRefused)) log("gate_failed", { message: errorText(error) });
    return null;
  }
};

// Stella's turns --------------------------------------------------------------------

/** Starts a turn of Stella's in her main conversation, wherever she runs now (a computer, or the cloud). */
const startStellaTurn = async (
  ctx: OwnerContext,
  input: { clientMsgId: string; prompt: string; title: string },
): Promise<boolean> => {
  const conversationId = readMainConversationId(ctx.db);
  if (!conversationId) return false;
  const snapshot = await ctx.host.snapshot();
  const target = await ctx.host
    .agentReportTarget({ conversationId, ownerGeneration: snapshot.ownerGeneration })
    .catch(() => null);
  const deviceId = target?.kind === "device" ? resolveCurrentDeviceId(ctx.db, target.deviceId) : undefined;
  // A computer on an app from before the Email page has the old email tool: the cloud reads instead.
  const targetDeviceId = snapshot.devices?.find((device) => device.deviceId === deviceId)?.capabilities?.includes("email-page")
    ? deviceId
    : undefined;
  try {
    await ctx.host.startScheduledTurn({
      ownerGeneration: snapshot.ownerGeneration,
      conversationId,
      clientMsgId: input.clientMsgId,
      prompt: input.prompt,
      title: input.title,
      ...(targetDeviceId ? { targetDeviceId } : {}),
    });
    return true;
  } catch (error) {
    log("turn_failed", { owner: ctx.ownerId.slice(0, 12), message: errorText(error) });
    return false;
  }
};

const unreadRows = (db: OwnerDbReader): MailRow[] =>
  db.all<MailRow>("SELECT * FROM email_mail WHERE read_at IS NULL ORDER BY received_at ASC");

const unreadIncoming = (db: OwnerDbReader): number =>
  db.one<{ count: number }>("SELECT COUNT(*) AS count FROM email_mail WHERE read_at IS NULL AND direction = 'in'")?.count ?? 0;

const accountsLine = (db: OwnerDbReader): string =>
  db.all<{ email: string }>("SELECT email FROM email_accounts ORDER BY created_at").map((row) => row.email).join(", ");

/** The next local read time after `now`. */
const nextReadAt = (now: number, zone: string, plan: "free" | "paid"): number => {
  const hours = READ_HOURS[plan];
  for (let offset = 0; offset <= 2; offset += 1) {
    const day = localParts(now + offset * DAY, zone).day;
    for (const hour of hours) {
      const at = zonedTime(`${day} ${String(hour).padStart(2, "0")}:00`, zone);
      if (at !== null && at > now + MIN) return at;
    }
  }
  return now + DAY;
};

const scheduleRead = (ctx: OwnerContext, plan: "free" | "paid", zone: string): void => {
  const at = nextReadAt(ctx.now, zone, plan);
  ctx.db.run("UPDATE email_state SET next_read_at = ?, updated_at = ? WHERE id = 1", at, ctx.now);
  ctx.jobs.schedule(READ_JOB, at, {}, { id: READ_JOB });
};

/** A scheduled read: wakes Stella when there is mail she hasn't read. */
const runRead = async (ctx: OwnerContext): Promise<void> => {
  if (!enabled(ctx.db)) return;
  const snapshot = await ctx.host.snapshot();
  const zone = zoneOf(ctx, snapshot);
  const plan = planOf(ctx, snapshot);
  try {
    await runSync(ctx, {}).catch((error: unknown) => log("sync_failed", { owner: ctx.ownerId.slice(0, 12), message: errorText(error) }));
    const count = unreadIncoming(ctx.db);
    if (count > 0) {
      await startStellaTurn(ctx, {
        clientMsgId: `email-read:${ctx.now}`,
        title: "Email",
        prompt: `Scheduled email read (${clock(ctx.now, zone, false)}): ${count} new email${count === 1 ? "" : "s"} since your last read, in ${accountsLine(ctx.db)}. Read them with the email tool's inbox and bring the Email page up to date.`,
      });
      log("read_started", { owner: ctx.ownerId.slice(0, 12), count });
    }
  } finally {
    scheduleRead(ctx, plan, zone);
  }
};

const wakeAllowed = (ctx: OwnerContext, plan: "free" | "paid", zone: string, byRule: boolean): boolean => {
  const { day, hour } = localParts(ctx.now, zone);
  if (!byRule && (hour >= QUIET_FROM_HOUR || hour < QUIET_UNTIL_HOUR)) return false;
  const state = stateOf(ctx.db);
  const today = state?.wake_day === day ? (state.wakes_today ?? 0) : 0;
  if (today >= WAKES_PER_DAY[plan]) return false;
  ctx.db.run("UPDATE email_state SET wakes_today = ?, wake_day = ?, updated_at = ? WHERE id = 1", today + 1, day, ctx.now);
  return true;
};

/** Mail the gate flagged (or a rule asked about) wakes Stella now, a few emails at once. */
const runWake = async (ctx: OwnerContext): Promise<void> => {
  if (!enabled(ctx.db)) return;
  const rows = ctx.db.all<MailRow>("SELECT * FROM email_mail WHERE woke = 1 AND read_at IS NULL ORDER BY received_at ASC");
  if (rows.length === 0) return;
  const snapshot = await ctx.host.snapshot();
  const zone = zoneOf(ctx, snapshot);
  const rules = new Map(rulesOf(ctx.db).map((rule) => [rule.rule_id, rule] as const));
  const matched = rows.flatMap((row) => (row.rule_id && rules.get(row.rule_id) ? [rules.get(row.rule_id)!] : []));
  if (!wakeAllowed(ctx, planOf(ctx, snapshot), zone, matched.length > 0)) {
    ctx.db.run("UPDATE email_mail SET woke = 3 WHERE woke = 1");
    log("wake_held", { owner: ctx.ownerId.slice(0, 12), count: rows.length });
    return;
  }
  for (const rule of matched) {
    ctx.db.run("UPDATE email_rules SET fired_count = fired_count + 1, last_fired_at = ? WHERE rule_id = ?", ctx.now, rule.rule_id);
  }
  const about = rows
    .slice(0, 5)
    .map((row) => `${row.from_name || row.from_address}, "${row.subject}" (${row.account})`)
    .join("; ");
  const ruleLines = [...new Set(matched.map((rule) => rule.action === "act" ? `Their instruction: "${rule.text}"` : `They asked to hear about it at once ("${rule.text}"): if it matches, mark its page item urgent so it reaches their phone.`))];
  const started = await startStellaTurn(ctx, {
    clientMsgId: `email-wake:${rows[0]!.mail_id}`,
    title: "Email",
    prompt: [
      `Email that may not wait: ${rows.length === 1 ? "an email" : `${rows.length} emails`} just arrived that ${matched.length > 0 ? "match the user's email rules" : "the gate thinks shouldn't wait for your next read"}: ${about}.`,
      ...ruleLines,
      "Read the new mail with the email tool's inbox and decide.",
    ].join("\n"),
  });
  ctx.db.run(`UPDATE email_mail SET woke = ? WHERE woke = 1`, started ? 2 : 3);
  log("woke", { owner: ctx.ownerId.slice(0, 12), count: rows.length, started });
};

// Gmail sync -------------------------------------------------------------------------

const isIncoming = (labels: string[]): boolean =>
  labels.includes("INBOX") && !labels.some((label) => label === "SENT" || label === "DRAFT" || label === "SPAM" || label === "TRASH");

const snippetOf = (text: string): string =>
  text
    .split("\n")
    .filter((line) => !/^\s*>/u.test(line))
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, SNIPPET_CHARS);

const insertMail = (ctx: OwnerContext, account: string, mail: GmailMail, direction: "in" | "out", gate: { urgentP: number; ruleId?: string } | null): string => {
  const mailId = `m-${crypto.randomUUID()}`;
  const wake = gate !== null && (gate.ruleId !== undefined || gate.urgentP >= WAKE_THRESHOLD);
  ctx.db.run(
    `INSERT INTO email_mail (mail_id, account, message_id, thread_id, direction, from_name, from_address, to_line, cc_line, subject,
       snippet, bulk, attachments, received_at, arrived_at, urgent_p, rule_id, woke)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (account, message_id) DO NOTHING`,
    mailId,
    account,
    mail.id,
    mail.threadId,
    direction,
    mail.fromName.slice(0, 200),
    mail.fromAddress.slice(0, 320),
    mail.to.slice(0, 600),
    mail.cc.slice(0, 600),
    mail.subject.slice(0, 300),
    snippetOf(mail.text),
    mail.bulk ? 1 : 0,
    mail.attachments.length > 0 ? JSON.stringify(mail.attachments.map((entry) => entry.filename).filter(Boolean).slice(0, 8)) : null,
    mail.receivedAt,
    ctx.now,
    gate?.urgentP ?? null,
    gate?.ruleId ?? null,
    wake && direction === "in" ? 1 : 0,
  );
  return mailId;
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
  if (ctx.db.one("SELECT 1 AS present FROM email_mail WHERE account = ? AND message_id = ?", account, messageId)) return;
  const mail = await gmailReadMail(get, messageId);
  if (!mail) return;
  if (mail.receivedAt < ctx.now - 2 * DAY) return;
  if (mail.labelIds.includes("SENT")) {
    notePeople(ctx, mail);
    insertMail(ctx, account, mail, "out", null);
    return;
  }
  if (!isIncoming(mail.labelIds) || mail.fromAddress === account) return;
  const gate = options.backfill ? null : await gateOne(ctx, snapshot, zone, account, mail);
  insertMail(ctx, account, mail, "in", gate);
  if (gate && (gate.ruleId || gate.urgentP >= WAKE_THRESHOLD)) {
    ctx.jobs.schedule(WAKE_JOB, ctx.now + WAKE_DEBOUNCE_MS, {}, { id: WAKE_JOB });
  }
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
  const target = payload && typeof payload === "object" ? String((payload as Record<string, unknown>).account ?? "") : "";
  const snapshot = await ctx.host.snapshot();
  ctx.db.run("UPDATE email_state SET plan = ? WHERE id = 1", snapshot.plan);
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

/** The last day's inbox of a newly joined account, so Stella's first read has something to read. */
const backfill = async (ctx: OwnerContext, snapshot: OwnerSnapshot, zone: string, account: string, get: Fetcher): Promise<void> => {
  const list = (await get(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({ q: "in:inbox newer_than:1d", maxResults: String(BACKFILL_MAX) }).toString()}`,
  )) as { messages?: { id?: string }[] };
  for (const entry of list.messages ?? []) {
    if (!entry.id) continue;
    await processMessage(ctx, snapshot, zone, account, get, entry.id, { backfill: true }).catch((error: unknown) =>
      log("backfill_failed", { message: errorText(error) }),
    );
  }
};

/** Joins accounts connected since, drops ones removed, and renews watches. */
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
    if (pushTopic(ctx) && !account.email.endsWith(`@${FAKE_GMAIL_DOMAIN}`) && (!current?.watch_expires_at || current.watch_expires_at - ctx.now < 7 * DAY - WATCH_RENEW_MS)) {
      await watchAccount(ctx, account).catch((error: unknown) => {
        log("watch_failed", { owner: ctx.ownerId.slice(0, 12), message: errorText(error) });
        markSynced(ctx, account.email, { error: `Live updates are off: ${errorText(error)}` });
      });
    }
  }
  return live;
};

const scheduleTick = (ctx: OwnerContext, delay?: number): void => {
  const live = ctx.db.one("SELECT 1 AS live FROM email_accounts WHERE watch_expires_at > ?", ctx.now);
  ctx.jobs.schedule(TICK_JOB, ctx.now + (delay ?? (live ? TICK_LIVE_MS : TICK_POLL_MS)), {}, { id: TICK_JOB });
};

/**
 * The page has never been written: the first time Email runs for an owner
 * (or the first time after Stella took over from the sorter), she reads the
 * last day's mail right away.
 */
const pageNeverWritten = (db: OwnerDbReader): boolean => !db.one("SELECT 1 AS present FROM email_page WHERE id = 1");

const runTick = async (ctx: OwnerContext): Promise<void> => {
  if (!enabled(ctx.db)) return;
  try {
    for (const job of RETIRED_JOBS) ctx.jobs.cancel(job);
    const first = pageNeverWritten(ctx.db) && !ctx.db.one("SELECT 1 AS present FROM email_mail LIMIT 1");
    if (first) ctx.db.run("DELETE FROM email_accounts");
    await reconcileAccounts(ctx, { backfill: first });
    ctx.db.run("DELETE FROM email_mail WHERE received_at < ?", ctx.now - MAIL_RETENTION_MS);
    await runSync(ctx, {});
    const state = stateOf(ctx.db);
    if (first) {
      writePage(ctx, readPage(ctx.db, ctx.now));
      ctx.jobs.schedule(READ_JOB, ctx.now + 2_000, {}, { id: READ_JOB });
    } else if (!state?.next_read_at || state.next_read_at < ctx.now - HOUR) {
      const snapshot = await ctx.host.snapshot();
      scheduleRead(ctx, planOf(ctx, snapshot), zoneOf(ctx, snapshot));
    }
  } finally {
    scheduleTick(ctx);
  }
};

// The page ---------------------------------------------------------------------------

const readPage = (db: OwnerDbReader, now: number): EmailPage =>
  readEmailPage(db.one<{ json: string }>("SELECT json FROM email_page WHERE id = 1")?.json, now);

const writePage = (ctx: OwnerContext, page: EmailPage): void => {
  ctx.db.run(
    `INSERT INTO email_page (id, json, updated_at) VALUES (1, ?, ?)
     ON CONFLICT (id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
    JSON.stringify(page),
    ctx.now,
  );
};

const pushUrgent = async (ctx: OwnerContext, item: EmailPageItem): Promise<void> => {
  const tokens = livePushTokens(ctx);
  if (tokens.length === 0) return;
  const conversationId = readMainConversationId(ctx.db);
  const data: EmailPushData = { kind: EMAIL_PUSH_KIND, itemId: item.id, ...(conversationId ? { conversationId } : {}) };
  const collapse = `email:${item.id}`.slice(0, 64);
  await sendPushMessages(
    ctx,
    tokens,
    tokens.map((token) => ({
      to: token.token,
      title: item.title,
      body: item.gist.slice(0, 300),
      data,
      sound: "default",
      priority: "high",
      ...(token.platform === "android"
        ? { tag: collapse }
        : { threadId: "stella-email", collapseId: collapse, interruptionLevel: "time-sensitive" }),
    })),
  );
};

const pageState = (ctx: Reader): EmailPageState => {
  const state = stateOf(ctx.db);
  const on = state?.enabled === 1;
  const accounts = ctx.db.all<{ email: string }>("SELECT email FROM email_accounts ORDER BY created_at").map((row) => row.email);
  const fake = fakeGmailInboxes(ctx);
  const google = fake.length > 0 ? [] : stellaGoogleAccounts(ctx.db, "gmail");
  const gmailConnected =
    fake.length > 0 ? fake : google.filter((account) => account.connected).map((account) => account.email ?? account.label);
  return {
    enabled: on,
    accounts,
    page: readPage(ctx.db, ctx.now),
    unread: on ? unreadIncoming(ctx.db) : 0,
    ...(on && state?.next_read_at ? { nextReadAt: state.next_read_at } : {}),
    gmailConnected,
    needsReconnect: gmailConnected.length === 0 && (google.length > 0 || composioGmailOnly(ctx.db)),
    rules: rulesOf(ctx.db).map(toRule),
  };
};

// The email tool --------------------------------------------------------------------

type ToolArgs = Record<string, unknown>;

const text = (args: ToolArgs, key: string, max: number): string =>
  typeof args[key] === "string" ? (args[key] as string).trim().slice(0, max) : "";

const accountFor = async (ctx: OwnerContext, wanted: string): Promise<LiveAccount> => {
  const accounts = await liveAccounts(ctx);
  const account = wanted ? accounts.find((entry) => entry.email === wanted.toLowerCase()) : accounts.length === 1 ? accounts[0] : undefined;
  if (account) return account;
  throw new RpcError(
    "NOT_FOUND",
    accounts.length === 0
      ? "No Gmail is connected through Stella."
      : wanted
        ? `${wanted} isn't connected through Stella; connected: ${accounts.map((entry) => entry.email).join(", ")}.`
        : `Say which account: ${accounts.map((entry) => entry.email).join(", ")}.`,
  );
};

const googleFailure = (error: unknown): never => {
  if (error instanceof GoogleApiError) {
    throw new RpcError(
      error.status === 404 ? "NOT_FOUND" : "UNAVAILABLE",
      error.status === 404 ? "That email isn't in this account anymore." : error.message,
    );
  }
  throw error;
};

const attachmentsOf = (row: MailRow): string[] => {
  try {
    return row.attachments ? (JSON.parse(row.attachments) as string[]) : [];
  } catch {
    return [];
  }
};

const toYou = (row: MailRow): string => {
  if (addressesIn(row.to_line).includes(row.account)) return "to you";
  if (addressesIn(row.cc_line).includes(row.account)) return "cc you";
  return "not addressed to you";
};

/**
 * What arrived since Stella last read, for her to read: grouped by thread,
 * a mailing list with several emails folded to one line, each with the ids
 * the other actions take. Reading it marks it read.
 */
const inbox = (ctx: OwnerContext, zone: string): string => {
  const rows = unreadRows(ctx.db);
  const incoming = rows.filter((row) => row.direction === "in");
  const sent = rows.filter((row) => row.direction === "out");
  const rules = new Map(rulesOf(ctx.db).map((rule) => [rule.rule_id, rule] as const));
  const multi = new Set(rows.map((row) => row.account)).size > 1 || ctx.db.all("SELECT email FROM email_accounts").length > 1;
  const page = readPage(ctx.db, ctx.now);
  const since = page.readAt;
  const lines: string[] = [];
  lines.push(
    incoming.length === 0 && sent.length === 0
      ? `No new mail since ${since ? clock(since, zone, true) : "Email was turned on"}.`
      : `${incoming.length} new email${incoming.length === 1 ? "" : "s"}${since ? ` since ${clock(since, zone, true)}` : ""} (times are the user's, ${zone}).`,
  );

  const bySender = new Map<string, MailRow[]>();
  for (const row of incoming) {
    const key = `${row.account}\u0000${row.from_address}`;
    bySender.set(key, [...(bySender.get(key) ?? []), row]);
  }
  const blocks: { at: number; text: string }[] = [];
  const threadRows = new Map<string, MailRow[]>();
  for (const group of bySender.values()) {
    const bulk = group.filter((row) => row.bulk === 1);
    if (bulk.length >= BULK_FOLD) {
      const latest = bulk[bulk.length - 1]!;
      const subjects = [...new Set(bulk.map((row) => row.subject))].reverse().slice(0, 4).map((subject) => `"${subject}"`);
      blocks.push({
        at: latest.received_at,
        text: `- ${latest.from_name || latest.from_address} <${latest.from_address}> ×${bulk.length} (mailing list${multi ? `, ${latest.account}` : ""}) — ${subjects.join(", ")}; latest ${clock(latest.received_at, zone, false)}, thread ${latest.thread_id}`,
      });
      for (const row of group.filter((entry) => entry.bulk !== 1)) threadRows.set(`${row.account}\u0000${row.thread_id}`, [...(threadRows.get(`${row.account}\u0000${row.thread_id}`) ?? []), row]);
    } else {
      for (const row of group) threadRows.set(`${row.account}\u0000${row.thread_id}`, [...(threadRows.get(`${row.account}\u0000${row.thread_id}`) ?? []), row]);
    }
  }
  for (const thread of threadRows.values()) {
    const latest = thread[thread.length - 1]!;
    const flags = [
      toYou(latest),
      latest.bulk === 1 ? "mailing list" : "",
      wroteTo(ctx.db, latest.from_address) > 0 ? "a person they write to" : "",
      latest.woke ? "flagged as not able to wait" : "",
      latest.rule_id && rules.get(latest.rule_id) ? `matches rule ${latest.rule_id}` : "",
    ].filter(Boolean);
    const files = attachmentsOf(latest);
    blocks.push({
      at: latest.received_at,
      text: [
        `- ${clock(latest.received_at, zone, true)} · ${latest.from_name ? `${latest.from_name} <${latest.from_address}>` : latest.from_address} · "${latest.subject}"${thread.length > 1 ? ` (${thread.length} new in thread)` : ""} · ${flags.join(", ")}`,
        `  account ${latest.account} · thread ${latest.thread_id} · message ${latest.message_id}`,
        `  ${latest.snippet ? `"${latest.snippet}"` : "(no text)"}${files.length ? ` · attachments: ${files.join(", ")}` : ""}`,
      ].join("\n"),
    });
  }
  blocks.sort((a, b) => b.at - a.at);
  const shown = blocks.slice(0, INBOX_THREADS_SHOWN);
  if (shown.length > 0) lines.push("", ...shown.map((block) => block.text));
  if (blocks.length > shown.length) lines.push(`(${blocks.length - shown.length} more older threads not listed; search finds them.)`);
  if (sent.length > 0) {
    lines.push("", "The user sent:");
    for (const row of sent.slice(-30).reverse()) {
      lines.push(`- ${clock(row.received_at, zone, true)} to ${row.to_line.slice(0, 160)} · "${row.subject}" · account ${row.account} · thread ${row.thread_id}`);
    }
  }
  lines.push("", rulesText(ctx.db), "", describeEmailPage(page));
  if (rows.length > 0) {
    ctx.db.run("UPDATE email_mail SET read_at = ? WHERE read_at IS NULL", ctx.now);
  }
  writePage(ctx, { ...page, readAt: ctx.now });
  return lines.join("\n");
};

const readThreadText = async (ctx: OwnerContext, zone: string, args: ToolArgs): Promise<string> => {
  const thread = text(args, "thread", 128);
  if (!thread) throw new RpcError("BAD_REQUEST", "read needs a thread (and its account).");
  const account = await accountFor(ctx, text(args, "account", 320));
  const messages = await gmailReadThread(await account.get(), thread).catch(googleFailure);
  if (!messages || messages.length === 0) throw new RpcError("NOT_FOUND", "That thread isn't in this account anymore.");
  ctx.db.run("UPDATE email_mail SET read_at = ? WHERE account = ? AND thread_id = ? AND read_at IS NULL", ctx.now, account.email, thread);
  let budget = THREAD_TEXT_CHARS;
  const parts: string[] = [];
  for (const message of [...messages].reverse()) {
    const body = message.text.slice(0, Math.min(MESSAGE_TEXT_CHARS, Math.max(0, budget)));
    budget -= body.length;
    parts.unshift(
      [
        `${message.draft ? "[draft] " : ""}From ${message.fromName ? `${message.fromName} <${message.fromAddress}>` : message.fromAddress} · ${clock(message.receivedAt, zone, true)} · message ${message.id}`,
        `To: ${message.to}${message.cc ? ` · Cc: ${message.cc}` : ""}`,
        ...(message.attachments.length ? [`Attachments: ${message.attachments.join(", ")}`] : []),
        body || "(earlier text left out)",
      ].join("\n"),
    );
  }
  return [`"${messages[0]!.subject}" · account ${account.email} · thread ${thread}`, "", parts.join("\n\n---\n\n")].join("\n");
};

const searchText = async (ctx: OwnerContext, zone: string, args: ToolArgs): Promise<string> => {
  const query = text(args, "query", 300);
  if (!query) throw new RpcError("BAD_REQUEST", "search needs a query (Gmail search syntax).");
  enforceOwnerRateLimit(ctx.db, ctx.now, "email.search", { count: 60, windowMs: HOUR }, "Too many searches. Try again later.");
  const accounts = await liveAccounts(ctx);
  if (accounts.length === 0) throw new RpcError("NOT_FOUND", "No Gmail is connected through Stella.");
  const wanted = text(args, "account", 320).toLowerCase();
  const found = (
    await Promise.all(
      accounts
        .filter((account) => !wanted || account.email === wanted)
        .map(async (account) => {
          try {
            return (await gmailSearch(await account.get(), query, SEARCH_PER_ACCOUNT)).map((mail) => ({ ...mail, account: account.email }));
          } catch (error) {
            log("search_failed", { message: errorText(error) });
            return [];
          }
        }),
    )
  )
    .flat()
    .sort((a, b) => b.receivedAt - a.receivedAt)
    .slice(0, SEARCH_SHOWN);
  if (found.length === 0) return `Nothing matches ${JSON.stringify(query)}.`;
  return [
    `${found.length} match${found.length === 1 ? "" : "es"} for ${JSON.stringify(query)}, newest first:`,
    ...found.map(
      (mail) =>
        `- ${clock(mail.receivedAt, zone, true)} · ${mail.fromName || mail.fromAddress} · "${mail.subject}"${mail.labelIds.includes("UNREAD") ? " · unread" : ""}${mail.labelIds.includes("INBOX") ? "" : " · archived"}\n  account ${mail.account} · thread ${mail.threadId} · message ${mail.id}\n  "${mail.snippet}"`,
    ),
  ].join("\n");
};

const header = (headers: unknown, name: string): string => {
  if (!Array.isArray(headers)) return "";
  const found = headers.find(
    (entry) => entry && typeof entry === "object" && String((entry as Record<string, unknown>).name).toLowerCase() === name.toLowerCase(),
  ) as Record<string, unknown> | undefined;
  return typeof found?.value === "string" ? found.value : "";
};

/** A reply in an email's thread, sent or saved as a Gmail draft. */
const reply = async (ctx: OwnerContext, args: ToolArgs, mode: "send" | "draft"): Promise<string> => {
  const messageId = text(args, "message", 128);
  const body = typeof args.body === "string" ? args.body.trim().slice(0, 20_000) : "";
  if (!messageId || !body) throw new RpcError("BAD_REQUEST", `${mode} needs the message it answers and a body.`);
  enforceOwnerRateLimit(ctx.db, ctx.now, "email.mail.reply", { count: 30, windowMs: HOUR }, "Too many emails sent. Try again later.");
  const account = await accountFor(ctx, text(args, "account", 320));
  const get = await account.get();
  try {
    const original = (await get(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=metadata&metadataHeaders=From&metadataHeaders=Reply-To&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Subject`,
    )) as Record<string, unknown>;
    const headers = original.payload && typeof original.payload === "object" ? (original.payload as Record<string, unknown>).headers : undefined;
    const sender = header(headers, "Reply-To") || header(headers, "From");
    const others =
      args.all === true
        ? [...addressesIn(header(headers, "To")), ...addressesIn(header(headers, "Cc"))].filter(
            (address) => address !== account.email && address !== parseAddress(sender).address,
          )
        : [];
    const subject = header(headers, "Subject");
    const result = (await runGoogleAction(get, "gmail", mode === "send" ? "GMAIL_SEND_EMAIL" : "GMAIL_CREATE_DRAFT", {
      to: [sender],
      ...(others.length ? { cc: [...new Set(others)] } : {}),
      subject: /^re:/iu.test(subject.trim()) ? subject : `Re: ${subject}`,
      body,
      reply_to_message_id: messageId,
    })) as Record<string, unknown>;
    const draftId = text(args, "draft", 128);
    if (mode === "send" && draftId) await gmailDeleteDraft(get, draftId).catch(() => undefined);
    log(mode === "send" ? "sent" : "drafted", { owner: ctx.ownerId.slice(0, 12) });
    const recipients = [sender, ...others].join(", ");
    return mode === "send"
      ? `Sent from ${account.email} to ${recipients}, in the thread.`
      : `Saved a draft in ${account.email} to ${recipients}, in the thread (draft ${String(result.id ?? "")}).`;
  } catch (error) {
    return googleFailure(error);
  }
};

const archive = async (ctx: OwnerContext, args: ToolArgs): Promise<string> => {
  const threads = Array.isArray(args.threads) ? args.threads.slice(0, 100) : [];
  if (threads.length === 0) throw new RpcError("BAD_REQUEST", "archive needs threads: [{ account, thread }].");
  enforceOwnerRateLimit(ctx.db, ctx.now, "email.archive", { count: 200, windowMs: HOUR }, "Too many changes. Try again later.");
  const back = args.undo === true;
  const accounts = await liveAccounts(ctx);
  let done = 0;
  const failed: string[] = [];
  for (const entry of threads) {
    const record = entry && typeof entry === "object" ? (entry as Record<string, unknown>) : {};
    const thread = typeof record.thread === "string" ? record.thread.trim() : "";
    const accountEmail = typeof record.account === "string" ? record.account.trim().toLowerCase() : "";
    const account = accounts.find((candidate) => candidate.email === accountEmail) ?? (accounts.length === 1 ? accounts[0] : undefined);
    if (!thread || !account) {
      failed.push(thread || "(missing thread)");
      continue;
    }
    try {
      await gmailSetThreadInbox(await account.get(), thread, back);
      done += 1;
    } catch (error) {
      failed.push(`${thread} (${errorText(error)})`);
    }
  }
  return `${back ? "Put back in the inbox" : "Archived"}: ${done} thread${done === 1 ? "" : "s"}.${failed.length ? ` Not done: ${failed.join(", ")}.` : ""}`;
};

const updatePage = async (ctx: OwnerContext, args: ToolArgs): Promise<string> => {
  const update: EmailPageUpdate = {
    ...(Array.isArray(args.items) ? { items: args.items as EmailPageUpdate["items"] } : {}),
    ...(Array.isArray(args.remove) ? { remove: (args.remove as unknown[]).filter((id): id is string => typeof id === "string") } : {}),
    ...(args.ignored && typeof args.ignored === "object" ? { ignored: args.ignored as EmailPageUpdate["ignored"] } : {}),
  };
  const before = readPage(ctx.db, ctx.now);
  const { page, problems, newlyUrgent } = applyEmailPageUpdate(before, update, ctx.now);
  for (const item of page.items) {
    const times = (item.threads ?? []).map(
      (thread) =>
        ctx.db.one<{ at: number | null }>(
          "SELECT MAX(received_at) AS at FROM email_mail WHERE account = ? AND thread_id = ? AND direction = 'in'",
          thread.account,
          thread.thread,
        )?.at ?? 0,
    );
    const newest = Math.max(0, ...times);
    if (newest > 0) item.mailAt = newest;
  }
  writePage(ctx, page);
  for (const item of newlyUrgent) {
    await pushUrgent(ctx, item).catch((error: unknown) => log("push_failed", { message: errorText(error) }));
  }
  const needs = page.items.filter((item) => item.section === "needs_you").length;
  return [
    `Updated the Email page: ${needs} need${needs === 1 ? "s" : ""} the user.${newlyUrgent.length ? ` ${newlyUrgent.length} urgent reached their phone.` : ""}`,
    ...problems,
  ].join("\n");
};

const ruleAction = (ctx: OwnerContext, args: ToolArgs): string => {
  ensureState(ctx);
  const op = text(args, "op", 16) || "list";
  if (op === "add") {
    const words = text(args, "text", 500);
    const when = text(args, "when", 400);
    const kind = text(args, "kind", 16);
    if (!words || !when || !["wake", "act", "ignore"].includes(kind)) {
      throw new RpcError("BAD_REQUEST", "Adding a rule needs text (their words), when (which emails) and kind (wake, act or ignore).");
    }
    if ((ctx.db.one<{ count: number }>("SELECT COUNT(*) AS count FROM email_rules")?.count ?? 0) >= RULES_MAX) {
      throw new RpcError("CONFLICT", `There are already ${RULES_MAX} email rules; remove one first.`);
    }
    const id = ruleId();
    ctx.db.run(
      "INSERT INTO email_rules (rule_id, text, match_text, action, created_at) VALUES (?, ?, ?, ?, ?)",
      id,
      words,
      when,
      kind,
      ctx.now,
    );
    return `Saved rule ${id}.\n${rulesText(ctx.db)}`;
  }
  if (op === "remove") {
    const id = text(args, "rule", 64);
    ctx.db.run("DELETE FROM email_rules WHERE rule_id = ?", id);
    return `Removed rule ${id}.\n${rulesText(ctx.db)}`;
  }
  if (op === "note") {
    const note = text(args, "note", 800).replace(/\s+/gu, " ");
    ctx.db.run("UPDATE email_state SET note = ?, updated_at = ? WHERE id = 1", note, ctx.now);
    return rulesText(ctx.db);
  }
  return rulesText(ctx.db);
};

const emailTool = async (ctx: OwnerContext, raw: unknown): Promise<{ text: string }> => {
  const args = (raw && typeof raw === "object" ? raw : {}) as ToolArgs;
  const action = text(args, "action", 32);
  const snapshot = await ctx.host.snapshot();
  const zone = zoneOf(ctx, snapshot);
  if (action === "rules") return { text: ruleAction(ctx, args) };
  if (action === "search") return { text: await searchText(ctx, zone, args) };
  if (action === "read") return { text: await readThreadText(ctx, zone, args) };
  if (action === "draft" || action === "send") return { text: await reply(ctx, args, action) };
  if (action === "archive") return { text: await archive(ctx, args) };
  if (!enabled(ctx.db)) {
    throw new RpcError(
      "CONFLICT",
      "Email isn't on. The user turns it on from the Email tab (it needs Gmail connected through Stella); search, read, draft and send work without it.",
    );
  }
  if (action === "inbox") {
    // Mail Gmail hasn't pushed yet would otherwise wait for the next read.
    await runSync(ctx, {}).catch((error: unknown) => log("sync_failed", { owner: ctx.ownerId.slice(0, 12), message: errorText(error) }));
    return { text: inbox(ctx, zone) };
  }
  if (action === "page") return { text: await updatePage(ctx, args) };
  if (action === "off") {
    await setEnabled(ctx, { enabled: false });
    return { text: "Email is off: Stella no longer reads the mail on her own, and the page is cleared." };
  }
  throw new RpcError("BAD_REQUEST", "action must be inbox, read, search, draft, send, archive, page, rules or off.");
};

// Turning Email on and off --------------------------------------------------------------

const setEnabled = async (ctx: OwnerContext, args: { enabled: boolean }): Promise<EmailPageState> => {
  ensureState(ctx);
  const snapshot = await ctx.host.snapshot();
  ctx.db.run("UPDATE email_state SET plan = ? WHERE id = 1", snapshot.plan);
  if (!args.enabled) {
    const accounts = await liveAccounts(ctx).catch(() => []);
    for (const account of accounts) {
      await indexWatch(ctx, account.email, false).catch(() => undefined);
      if (!(await watchedElsewhere(ctx, account.email))) await gmailStopWatch(await account.get()).catch(() => undefined);
    }
    for (const job of [TICK_JOB, READ_JOB, WAKE_JOB, ...RETIRED_JOBS]) ctx.jobs.cancel(job);
    ctx.db.run("UPDATE email_state SET enabled = 0, next_read_at = NULL, updated_at = ? WHERE id = 1", ctx.now);
    for (const table of ["email_mail", "email_page", "email_accounts", "email_people", "email_items", "email_matters", "email_log"]) {
      ctx.db.run(`DELETE FROM ${table}`);
    }
    return pageState(ctx);
  }
  const live = await liveAccounts(ctx);
  if (live.length === 0) throw new RpcError("CONFLICT", "Connect Gmail through Stella first.");
  ctx.db.run("UPDATE email_state SET enabled = 1, updated_at = ? WHERE id = 1", ctx.now);
  scheduleTick(ctx, 0);
  return pageState(ctx);
};

const changed = async (ctx: OwnerContext, payload: unknown): Promise<{ ok: true }> => {
  if (!enabled(ctx.db)) return { ok: true };
  const account = payload && typeof payload === "object" ? String((payload as Record<string, unknown>).account ?? "").toLowerCase() : "";
  if (!account || !ctx.db.one("SELECT 1 AS present FROM email_accounts WHERE email = ?", account)) return { ok: true };
  ctx.jobs.schedule(SYNC_JOB, ctx.now, { account }, { id: `${SYNC_JOB}:${account}` });
  return { ok: true };
};

const connectedAccounts = (db: OwnerDbReader): string[] =>
  enabled(db) ? db.all<{ email: string }>("SELECT email FROM email_accounts ORDER BY created_at").map((row) => row.email) : [];

const runningEmailDomain = {
  name: "email",
  migrations: [
    EMAIL_MIGRATION,
    EMAIL_DIGESTS_MIGRATION,
    EMAIL_BRIEF_MIGRATION,
    EMAIL_BRIEFINGS_MIGRATION,
    EMAIL_TODAY_MIGRATION,
    EMAIL_OWN_KEY_MIGRATION,
    EMAIL_STELLA_MIGRATION,
    FAKE_GMAIL_MIGRATION,
  ],
  calls: {
    "email.setEnabled": {
      scope: "owner",
      parse: object({ enabled: boolean() }),
      handler: setEnabled,
    },
    /** The `email` tool, from Stella running on a computer. */
    "email.tool": {
      scope: "owner",
      parse: (value: unknown, path?: string) => {
        const parsed = json({ maxBytes: 64 * 1024 })(value, path);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new RpcError("BAD_REQUEST", "Email tool arguments must be an object.");
        return parsed as Record<string, unknown>;
      },
      handler: emailTool,
    },
  },
  views: {
    "email.page": {
      parse: empty(),
      read: (ctx) => pageState(ctx),
    },
    "email.accounts": {
      parse: empty(),
      read: (ctx) => ({ accounts: connectedAccounts(ctx.db) }),
    },
  },
  internal: {
    "email.changed": changed,
    "email.tool": emailTool,
    /** Whether Stella's email instructions apply to this owner: Email on, with the inboxes she reads. */
    "email.connected": (ctx: OwnerContext) => ({ accounts: connectedAccounts(ctx.db) }),
    /**
     * Test accounts only (admin email probe): puts a raw RFC 822 email into a
     * fake inbox, as if it had just arrived (Gmail's push included). Never a
     * real inbox: a test must not reach a real person's mail.
     */
    "email.testImport": async (ctx: OwnerContext, raw: unknown) => {
      const args = (raw && typeof raw === "object" ? raw : {}) as ToolArgs;
      const message = typeof args.raw === "string" ? args.raw : "";
      if (!message) throw new RpcError("BAD_REQUEST", "testImport needs raw.");
      const fake = fakeGmailInboxes(ctx);
      const wanted = text(args, "account", 320).toLowerCase() || (fake.length === 1 ? fake[0]! : "");
      if (!fake.includes(wanted)) {
        throw new RpcError("CONFLICT", `Test mail goes only into a fake inbox (fakeInbox first); fake inboxes: ${fake.join(", ") || "none"}.`);
      }
      const bytes = new TextEncoder().encode(message.replace(/\r?\n/gu, "\r\n"));
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      const encoded = btoa(binary).replace(/\+/gu, "-").replace(/\//gu, "_").replace(/=+$/u, "");
      const result = (await fakeGmailFetcher(ctx.db, wanted, () => ctx.now)(
        "https://gmail.googleapis.com/gmail/v1/users/me/messages/import",
        { method: "POST", body: { raw: encoded, labelIds: ["INBOX", "UNREAD"] } },
      )) as { id?: string; threadId?: string };
      if (enabled(ctx.db)) ctx.jobs.schedule(SYNC_JOB, ctx.now, { account: wanted }, { id: `${SYNC_JOB}:${wanted}` });
      return { id: result.id ?? null, threadId: result.threadId ?? null, account: wanted };
    },
    /**
     * Test accounts only (admin email probe): adds (or with `remove`, deletes)
     * a fake inbox `<name>@fake-gmail.test`. `forgetGoogle` drops this test
     * account's real Google connections without revoking them at Google: dev
     * and production can share one Google app, and revoking ends that
     * person's grant everywhere, production included.
     */
    "email.testFakeInbox": (ctx: OwnerContext, raw: unknown) => {
      if (!fakeGmailEnabled(ctx.env)) throw new RpcError("FORBIDDEN", "Fake inboxes exist only where test accounts are on.");
      const args = (raw && typeof raw === "object" ? raw : {}) as ToolArgs;
      const email = text(args, "email", 120).toLowerCase();
      if (!new RegExp(`^[a-z0-9._-]+@${FAKE_GMAIL_DOMAIN.replace(/\./gu, "\\.")}$`, "u").test(email)) {
        throw new RpcError("BAD_REQUEST", `A fake inbox is <name>@${FAKE_GMAIL_DOMAIN}.`);
      }
      if (args.forgetGoogle === true) forgetStellaGoogleAccountsForTest(ctx.db);
      if (args.remove === true) removeFakeGmailInbox(ctx.db, email);
      else addFakeGmailInbox(ctx.db, email, ctx.now);
      if (enabled(ctx.db)) scheduleTick(ctx, 0);
      return { inboxes: fakeGmailInboxes(ctx), googleAccounts: stellaGoogleAccounts(ctx.db, "gmail").length };
    },
    /** Test accounts only: what a fake inbox holds (to check what Stella sent, drafted or archived). */
    "email.testFakeList": (ctx: OwnerContext, raw: unknown) => {
      const args = (raw && typeof raw === "object" ? raw : {}) as ToolArgs;
      const email = text(args, "email", 120).toLowerCase();
      if (!fakeGmailInboxes(ctx).includes(email)) throw new RpcError("NOT_FOUND", `${email} isn't a fake inbox here.`);
      return { messages: fakeGmailList(ctx.db, email) };
    },
    "email.readNow": async (ctx: OwnerContext) => {
      if (!enabled(ctx.db)) return { started: false };
      ctx.jobs.schedule(READ_JOB, ctx.now, {}, { id: READ_JOB });
      return { started: true };
    },
  },
  jobs: {
    [SYNC_JOB]: { run: (ctx, payload) => runSync(ctx, payload), maxAttempts: 3 },
    [TICK_JOB]: { run: (ctx) => runTick(ctx), maxAttempts: 2 },
    [READ_JOB]: { run: (ctx) => runRead(ctx), maxAttempts: 2 },
    [WAKE_JOB]: { run: (ctx) => runWake(ctx), maxAttempts: 2 },
  },
  purge: async (ctx) => {
    for (const job of [TICK_JOB, READ_JOB, WAKE_JOB, ...RETIRED_JOBS]) ctx.jobs.cancel(job);
    const addresses = ctx.db.all<{ email: string }>("SELECT email FROM email_accounts");
    for (const { email } of addresses) await indexWatch(ctx, email, false).catch(() => undefined);
    for (const table of [
      "email_mail",
      "email_page",
      "email_matters",
      "email_log",
      "email_briefings",
      "email_items",
      "email_accounts",
      "email_people",
      "email_rules",
      "email_senders",
      "email_corrections",
      "email_state",
      "email_fake_messages",
      "email_fake_inboxes",
    ]) {
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
  const on = (value: unknown): boolean => emailFeatureOnFor(value);
  const calls: Record<string, LooseCall> = {};
  for (const [name, def] of Object.entries(domain.calls as unknown as Record<string, LooseCall>)) {
    calls[name] = { ...def, handler: (ctx, args) => (on(ctx.env) ? def.handler(ctx, args) : unavailable()) };
  }
  const views: Record<string, LooseView> = {
    "email.available": { parse: empty(), read: (ctx) => ({ available: on(ctx.env) }) },
    "email.accounts": { parse: empty(), read: (ctx) => (on(ctx.env) ? domain.views["email.accounts"].read(ctx) : { accounts: [] }) },
  };
  for (const [name, def] of Object.entries(domain.views as unknown as Record<string, LooseView>)) {
    if (views[name]) continue;
    views[name] = { ...def, read: (ctx, args) => (on(ctx.env) ? def.read(ctx, args) : unavailable()) };
  }
  const internal: Record<string, InternalDef> = {};
  for (const [name, run] of Object.entries(domain.internal as Record<string, InternalDef>)) {
    internal[name] = (ctx, args) =>
      on(ctx.env) ? run(ctx, args) : name === "email.changed" ? { ok: true } : name === "email.connected" ? { accounts: [] } : unavailable();
  }
  const jobs: Record<string, JobDef> = {};
  for (const [name, def] of Object.entries(domain.jobs as Record<string, JobDef>)) {
    jobs[name] = { ...def, run: (ctx, payload) => (on(ctx.env) ? def.run(ctx, payload) : undefined) };
  }
  return { ...domain, calls, views, internal, jobs } as unknown as OwnerDomain;
};

export const emailDomain = gateEmailDomain(runningEmailDomain);

export type { EmailCalls };
