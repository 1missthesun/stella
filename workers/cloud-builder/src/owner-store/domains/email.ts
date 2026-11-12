import {
  EMAIL_BUCKETS,
  EMAIL_PUSH_KIND,
  type EmailAccountStatus,
  type EmailBucket,
  type EmailCalls,
  type EmailDigest,
  type EmailDigests,
  type EmailFeed,
  type EmailItem,
  type EmailItemState,
  type EmailPushData,
  type EmailReason,
  type EmailRule,
  type EmailStatus,
  type EmailUsage,
} from "@stella/contracts/backend/email";
import {
  EMAIL_CARD_MAX_ITEMS,
  EMAIL_CARD_TYPE,
  EMAIL_REASON_WORDS,
  emailCardNoteText,
  emailFocusNoteText,
  type EmailCard,
  type EmailCardItem,
} from "@stella/contracts/email-card";
import type { OwnerSnapshot } from "@stella/contracts/turn-plane/owner-snapshot";
import { GoogleApiError, gmailFetcher, runGoogleAction, type Fetcher } from "../../integrations/google.js";
import {
  addressesIn,
  parseAddress,
  gmailAttachmentBase64,
  gmailHistorySince,
  gmailLabelsOf,
  gmailProfile,
  gmailReadMail,
  gmailSentPeople,
  gmailSetInbox,
  gmailStopWatch,
  gmailWatch,
  type GmailMail,
} from "../../integrations/gmail-mail.js";
import {
  DECISION_INPUT_USD_PER_M,
  DEFAULT_NOTE,
  DecisionRefused,
  NOTE_MAX_CHARS,
  rewriteNote,
  sortEmail,
  writeLines,
  type SorterAccess,
  type SortVerdict,
} from "../../integrations/email-sorter.js";
import { array, boolean, empty, literal, object, optional, string } from "../args.js";
import { RpcError } from "../errors.js";
import { enforceOwnerRateLimit } from "../rate-limit.js";
import type { OwnerContext, OwnerDbReader, OwnerDomain } from "../registry.js";
import { readMainConversationId } from "./conversations.js";
import { livePushTokens, sendPushMessages } from "./devices.js";
import { stellaGmailTokens, stellaGoogleAccounts, stellaGoogleAvailable } from "./google-accounts.js";
import { ownerZone } from "./schedules.js";

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
const EXCERPT_CHARS = 600;

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
const CAPS = {
  free: { perDay: 150, usdPerMonth: 0.4 },
  paid: { perDay: 600, usdPerMonth: 2 },
} as const;

export const EMAIL_MIGRATION = {
  id: "email.1-init",
  statements: [
    "DROP TABLE IF EXISTS email_digest_state",
    "DROP TABLE IF EXISTS email_digests",
    "DROP TABLE IF EXISTS email_digest_seen",
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

/** One row per email row posted in the chat, so the opened Email view can show it and every earlier one. */
export const EMAIL_DIGESTS_MIGRATION = {
  id: "email.2-digests",
  statements: [
    `CREATE TABLE email_digests (
       digest_id TEXT PRIMARY KEY,
       kind TEXT NOT NULL,
       created_at INTEGER NOT NULL,
       rule_text TEXT,
       item_ids TEXT
     )`,
    "CREATE INDEX email_digests_by_time ON email_digests (created_at)",
    "ALTER TABLE email_items ADD COLUMN archived INTEGER NOT NULL DEFAULT 0",
    "CREATE INDEX email_items_by_card ON email_items (card_id)",
    `INSERT OR IGNORE INTO email_digests (digest_id, kind, created_at)
     SELECT card_id,
            CASE WHEN COUNT(*) > 1 OR SUM(state = 'summarized') > 0 THEN 'summary'
                 WHEN MAX(rule_id) IS NOT NULL THEN 'rule'
                 ELSE 'urgent' END,
            MAX(sorted_at)
       FROM email_items WHERE card_id IS NOT NULL GROUP BY card_id`,
  ],
};

type DigestRow = {
  digest_id: string;
  kind: string;
  created_at: number;
  rule_text: string | null;
  item_ids: string | null;
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
            month, month_sorted, month_tokens, month_line_usd, sort_day, sorted_today, plan
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

const usageOf = (now: number, state: StateRow | null, plan: string, zone: string): EmailUsage & { today: number } => {
  const { month, day } = localParts(now, zone);
  const sameMonth = state?.month === month;
  const tokens = sameMonth ? state.month_tokens : 0;
  const lineUsd = sameMonth ? state.month_line_usd : 0;
  const costUsd = (tokens / 1_000_000) * DECISION_INPUT_USD_PER_M + lineUsd;
  const caps = plan === "free" ? CAPS.free : CAPS.paid;
  const today = state?.sort_day === day ? state.sorted_today : 0;
  return {
    month,
    sorted: sameMonth ? state.month_sorted : 0,
    inputTokens: tokens,
    costUsd: Math.round(costUsd * 10_000) / 10_000,
    capped: costUsd >= caps.usdPerMonth || today >= caps.perDay,
    today,
  };
};

const recordSort = (ctx: OwnerContext, zone: string, tokens: number): void => {
  const { month, day } = localParts(ctx.now, zone);
  ctx.db.run(
    `UPDATE email_state SET
       month_sorted = CASE WHEN month = ? THEN month_sorted + 1 ELSE 1 END,
       month_tokens = CASE WHEN month = ? THEN month_tokens + ? ELSE ? END,
       month_line_usd = CASE WHEN month = ? THEN month_line_usd ELSE 0 END,
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
    day,
    day,
    ctx.now,
  );
};

const recordLineCost = (ctx: OwnerContext, zone: string, usd: number): void => {
  if (!(usd > 0)) return;
  const { month } = localParts(ctx.now, zone);
  ctx.db.run(
    `UPDATE email_state SET month_line_usd = CASE WHEN month = ? THEN month_line_usd + ? ELSE ? END,
       month_tokens = CASE WHEN month = ? THEN month_tokens ELSE 0 END,
       month_sorted = CASE WHEN month = ? THEN month_sorted ELSE 0 END,
       month = ?, updated_at = ? WHERE id = 1`,
    month,
    usd,
    usd,
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
  const usage = usageOf(ctx.now, state, snapshot.plan, zone);
  if (sortingSwitchedOff(ctx) || usage.capped) {
    if (usage.capped) log("capped", { owner: ctx.ownerId.slice(0, 12), today: usage.today, costUsd: usage.costUsd });
    return { verdict: fallbackVerdict(mail, wrote), sortedBy: "fallback" };
  }
  const access: SorterAccess = {
    env: ctx.env,
    ownerId: ctx.ownerId,
    ownerGeneration: snapshot.ownerGeneration,
    execution: snapshot.execution,
    audience: snapshot.allowance.audience,
    budgetMicroCents: snapshot.allowance.budgetMicroCents,
  };
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

const postCard = async (ctx: OwnerContext, snapshot: OwnerSnapshot, card: EmailCard): Promise<string | null> => {
  const conversationId = readMainConversationId(ctx.db);
  if (!conversationId || !snapshot.writable) return null;
  const posted = await ctx.host.postConversationCard({
    conversationId,
    ownerGeneration: snapshot.ownerGeneration,
    sourceTurnId: `email:${card.cardId}`,
    card,
  });
  if (!posted) throw new Error("The email card could not be posted yet.");
  ctx.db.run(
    "INSERT OR IGNORE INTO email_digests (digest_id, kind, created_at, rule_text, item_ids) VALUES (?, ?, ?, ?, ?)",
    card.cardId,
    card.kind,
    ctx.now,
    card.ruleText ?? null,
    JSON.stringify(card.items.map((item) => item.itemId)),
  );
  await ctx.host
    .appendConversationNote({
      conversationId,
      ownerGeneration: snapshot.ownerGeneration,
      noteId: `email-note-${card.cardId}`,
      text: emailCardNoteText(card),
    })
    .catch((error: unknown) => log("note_failed", { message: errorText(error) }));
  return conversationId;
};

const pushUrgent = async (
  ctx: OwnerContext,
  row: ItemRow,
  conversationId: string | null,
  title: string,
): Promise<void> => {
  const tokens = livePushTokens(ctx);
  if (tokens.length === 0) return;
  const data: EmailPushData = {
    kind: EMAIL_PUSH_KIND,
    itemId: row.item_id,
    ...(conversationId ? { conversationId } : {}),
  };
  const collapse = `email:${row.item_id}`.slice(0, 64);
  const body = `${row.from_name}: ${row.subject}`.slice(0, 300);
  await sendPushMessages(
    ctx,
    tokens,
    tokens.map((token) => ({
      to: token.token,
      title,
      body,
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

const surfaceNow = async (
  ctx: OwnerContext,
  snapshot: OwnerSnapshot,
  zone: string,
  row: ItemRow,
  rule: RuleRow | null,
): Promise<void> => {
  const access: SorterAccess = {
    env: ctx.env,
    ownerId: ctx.ownerId,
    ownerGeneration: snapshot.ownerGeneration,
    execution: snapshot.execution,
    audience: snapshot.allowance.audience,
    budgetMicroCents: snapshot.allowance.budgetMicroCents,
  };
  const line = await writeLines(access, [
    { n: 1, from: `${row.from_name} <${row.from_address}>`, subject: row.subject, excerpt: row.excerpt ?? "" },
  ])
    .then(({ lines, usd }) => {
      recordLineCost(ctx, zone, usd);
      return lines.get(1) ?? "";
    })
    .catch(() => "");
  if (line) ctx.db.run("UPDATE email_items SET line = ? WHERE item_id = ?", line, row.item_id);
  const fresh = readItem(ctx.db, row.item_id) ?? row;
  const cardId = `ec-${crypto.randomUUID()}`;
  const card: EmailCard = {
    type: EMAIL_CARD_TYPE,
    cardId,
    kind: rule ? "rule" : "urgent",
    items: [cardItem(fresh, 1)],
    ...(rule ? { ruleText: rule.text } : {}),
  };
  const conversationId = await postCard(ctx, snapshot, card);
  ctx.db.run(
    "UPDATE email_items SET state = 'surfaced', card_id = ?, excerpt = NULL WHERE item_id = ?",
    cardId,
    row.item_id,
  );
  const title = rule ? "Email you asked about" : `Urgent email · ${EMAIL_REASON_WORDS[fresh.reason as EmailReason]}`;
  await pushUrgent(ctx, fresh, conversationId, title).catch((error: unknown) =>
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
       first_bucket, urgent_p, reason, rule_id, sorted_by, tokens, received_at, sorted_at, state)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    await runSync(ctx, {});
  } finally {
    scheduleTick(ctx);
  }
};

// Summaries -------------------------------------------------------------------

const scheduleSummaryCheck = (ctx: OwnerContext, at: number): void => {
  ctx.jobs.schedule(SUMMARY_JOB, at, {}, { id: SUMMARY_JOB });
};

type Waiting = { needsYou: ItemRow[]; worth: ItemRow[] };

const waitingItems = (db: OwnerDbReader): Waiting => {
  const rows = db.all<ItemRow>(
    "SELECT * FROM email_items WHERE state = 'waiting' AND bucket IN ('urgent', 'needs_you', 'worth_knowing') ORDER BY received_at DESC LIMIT 100",
  );
  return {
    needsYou: rows.filter((row) => row.bucket !== "worth_knowing"),
    worth: rows.filter((row) => row.bucket === "worth_knowing"),
  };
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

const postSummary = async (ctx: OwnerContext, snapshot: OwnerSnapshot, zone: string, force: boolean): Promise<boolean> => {
  const state = stateOf(ctx.db);
  const { day, hour } = localParts(ctx.now, zone);
  const waiting = waitingItems(ctx.db);
  const summariesToday = state?.summary_day === day ? state.summaries_today : 0;
  const due =
    force ||
    summaryDue({
      now: ctx.now,
      hour,
      lastSummaryAt: state?.last_summary_at ?? null,
      summariesToday,
      needsYou: waiting.needsYou.map((row) => row.sorted_at),
      worth: waiting.worth.map((row) => row.sorted_at),
      firstOfDay: summariesToday === 0 && (state?.last_summary_at ?? 0) < ctx.now - 6 * HOUR,
    });
  if (!due) return false;
  const chosen = await dropHandled(ctx, [...waiting.needsYou, ...waiting.worth].slice(0, EMAIL_CARD_MAX_ITEMS));
  if (chosen.length === 0) return false;
  const since = state?.last_summary_at ?? 0;
  const noiseCount =
    ctx.db.one<{ count: number }>("SELECT COUNT(*) AS count FROM email_items WHERE bucket = 'noise' AND sorted_at > ?", since)
      ?.count ?? 0;
  const access: SorterAccess = {
    env: ctx.env,
    ownerId: ctx.ownerId,
    ownerGeneration: snapshot.ownerGeneration,
    execution: snapshot.execution,
    audience: snapshot.allowance.audience,
    budgetMicroCents: snapshot.allowance.budgetMicroCents,
  };
  const missing = chosen.filter((row) => !row.line);
  if (missing.length > 0) {
    const lines = await writeLines(
      access,
      missing.map((row, index) => ({
        n: index + 1,
        from: `${row.from_name} <${row.from_address}>`,
        subject: row.subject,
        excerpt: row.excerpt ?? "",
      })),
    )
      .then(({ lines, usd }) => {
        recordLineCost(ctx, zone, usd);
        return lines;
      })
      .catch((error: unknown) => {
        log("lines_failed", { message: errorText(error) });
        return new Map<number, string>();
      });
    missing.forEach((row, index) => {
      const line = lines.get(index + 1);
      if (line) {
        row.line = line;
        ctx.db.run("UPDATE email_items SET line = ? WHERE item_id = ?", line, row.item_id);
      }
    });
  }
  const cardId = `ec-${crypto.randomUUID()}`;
  const card: EmailCard = {
    type: EMAIL_CARD_TYPE,
    cardId,
    kind: "summary",
    items: chosen.map((row, index) => cardItem(row, index + 1)),
    ...(noiseCount > 0 ? { noiseCount } : {}),
  };
  if (!(await postCard(ctx, snapshot, card))) return false;
  for (const row of chosen) {
    ctx.db.run(
      "UPDATE email_items SET state = 'summarized', card_id = ?, excerpt = NULL WHERE item_id = ?",
      cardId,
      row.item_id,
    );
  }
  ctx.db.run(
    "UPDATE email_state SET last_summary_at = ?, summaries_today = ?, summary_day = ?, updated_at = ? WHERE id = 1",
    ctx.now,
    summariesToday + 1,
    day,
    ctx.now,
  );
  log("summary", { owner: ctx.ownerId.slice(0, 12), items: chosen.length, noise: noiseCount });
  return true;
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
  const rewritten = await rewriteNote(
    {
      env: ctx.env,
      ownerId: ctx.ownerId,
      ownerGeneration: snapshot.ownerGeneration,
      execution: snapshot.execution,
      audience: snapshot.allowance.audience,
      budgetMicroCents: snapshot.allowance.budgetMicroCents,
    },
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

/** Each email row in the chat, opened: what it surfaced, and what was skipped as noise in its stretch. */
const readDigests = (ctx: { db: OwnerDbReader; now: number }): EmailDigests => {
  const rows = ctx.db.all<DigestRow>(
    "SELECT * FROM email_digests WHERE created_at > ? ORDER BY created_at DESC LIMIT ?",
    ctx.now - FEED_WINDOW_MS,
    DIGESTS_SHOWN,
  );
  const newestSummary = rows.find((row) => row.kind === "summary")?.digest_id;
  const digests = rows.map((row): EmailDigest => {
    const kind = row.kind === "urgent" || row.kind === "rule" ? row.kind : "summary";
    const previous =
      ctx.db.one<{ created_at: number }>(
        "SELECT created_at FROM email_digests WHERE kind = 'summary' AND created_at < ? ORDER BY created_at DESC LIMIT 1",
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
    };
  });
  return {
    digests,
    multipleAccounts: (ctx.db.one<{ count: number }>("SELECT COUNT(*) AS count FROM email_accounts")?.count ?? 0) > 1,
  };
};

const statusOf = (ctx: { db: OwnerDbReader; now: number }, plan: string, zone: string): EmailStatus => {
  const state = stateOf(ctx.db);
  const accounts: EmailAccountStatus[] = ctx.db
    .all<AccountRow>("SELECT * FROM email_accounts ORDER BY created_at")
    .map((row) => ({
      email: row.email,
      live: row.watch_expires_at !== null && row.watch_expires_at > ctx.now,
      ...(row.last_sync_at !== null ? { lastSyncAt: row.last_sync_at } : {}),
      ...(row.last_error ? { error: row.last_error } : {}),
    }));
  const { today: _today, ...usage } = usageOf(ctx.now, state, plan, zone);
  return {
    enabled: state?.enabled === 1,
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

const readFeed = (ctx: { db: OwnerDbReader; now: number }): EmailFeed => {
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
    status: statusOf(ctx, stateOf(ctx.db)?.plan ?? "free", zone),
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
    for (const job of [TICK_JOB, SUMMARY_JOB, SUMMARY_NOW_ID, NOTE_JOB]) ctx.jobs.cancel(job);
    ctx.db.run("UPDATE email_state SET enabled = 0, updated_at = ? WHERE id = 1", ctx.now);
    ctx.db.run("DELETE FROM email_items");
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

const ruleId = (): string => `r${crypto.randomUUID().replace(/-/gu, "").slice(0, 10)}`;

export const emailDomain = {
  name: "email",
  migrations: [EMAIL_MIGRATION, EMAIL_DIGESTS_MIGRATION],
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
      parse: object({ itemId: string({ max: 64 }), archived: boolean() }),
      handler: async (ctx, args) => {
        enforceOwnerRateLimit(ctx.db, ctx.now, "email.archive", { count: 120, windowMs: HOUR }, "Too many changes. Try again later.");
        const row = requireItem(ctx, args.itemId);
        const account = (await liveAccounts(ctx)).find((entry) => entry.email === row.account);
        if (!account) throw new RpcError("NOT_FOUND", `${row.account} isn't connected through Stella anymore.`);
        try {
          await gmailSetInbox(await account.get(), row.message_id, !args.archived);
        } catch (error) {
          if (error instanceof GoogleApiError) {
            throw new RpcError(error.status === 404 ? "NOT_FOUND" : "UNAVAILABLE", error.status === 404 ? "That email isn't in this account anymore." : error.message);
          }
          throw error;
        }
        ctx.db.run("UPDATE email_items SET archived = ? WHERE item_id = ?", args.archived ? 1 : 0, row.item_id);
        log(args.archived ? "archived" : "unarchived", { owner: ctx.ownerId.slice(0, 12) });
        return { ok: true as const };
      },
    },
    "email.focus": {
      scope: "owner",
      parse: object({ itemId: string({ max: 64 }), action: literal("reply", "handle", "tell") }),
      handler: async (ctx, args) => {
        enforceOwnerRateLimit(ctx.db, ctx.now, "email.focus", { count: 120, windowMs: HOUR }, "Too many requests. Try again later.");
        const row = requireItem(ctx, args.itemId);
        const conversationId = readMainConversationId(ctx.db);
        if (!conversationId) return { ok: true as const };
        const snapshot = await ctx.host.snapshot();
        await ctx.host.appendConversationNote({
          conversationId,
          ownerGeneration: snapshot.ownerGeneration,
          noteId: `email-focus-${row.item_id}-${ctx.now}`,
          text: emailFocusNoteText(
            {
              from: row.from_name,
              fromAddress: row.from_address,
              subject: row.subject,
              ...(row.line ? { line: row.line } : {}),
              account: row.account,
              messageId: row.message_id,
              threadId: row.thread_id,
            },
            args.action,
          ),
        });
        return { ok: true as const };
      },
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
          {
            env: ctx.env,
            ownerId: ctx.ownerId,
            ownerGeneration: snapshot.ownerGeneration,
            execution: snapshot.execution,
            audience: snapshot.allowance.audience,
            budgetMicroCents: snapshot.allowance.budgetMicroCents,
          },
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
  },
  purge: async (ctx) => {
    for (const job of [TICK_JOB, SUMMARY_JOB, SUMMARY_NOW_ID, NOTE_JOB]) ctx.jobs.cancel(job);
    const addresses = ctx.db.all<{ email: string }>("SELECT email FROM email_accounts");
    for (const { email } of addresses) await indexWatch(ctx, email, false).catch(() => undefined);
    for (const table of ["email_digests", "email_items", "email_accounts", "email_people", "email_rules", "email_senders", "email_corrections", "email_state"]) {
      ctx.db.run(`DELETE FROM ${table}`);
    }
    return { pending: false };
  },
} satisfies OwnerDomain;
