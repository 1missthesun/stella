import {
  FEEDBACK_CONTACT_MAX_CHARS,
  FEEDBACK_MAX_CHARS,
  type PreferenceCalls,
} from "@stella/contracts/backend/preferences";
import { sendEmail } from "../../auth/auth.js";
import { rateKeyForIp } from "../../http/client-ip.js";
import { object, optional, string } from "../args.js";
import { RpcError } from "../errors.js";
import type { OwnerDomain, PublicContext } from "../registry.js";

const META_MAX_CHARS = 64;
const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;
const SIGNED_IN_PER_HOUR = 10;
const SIGNED_OUT_PER_HOUR = 5;
const SIGNED_OUT_PER_DAY = 20;
const SIGNED_OUT_ALL_PER_DAY = 300;
const NOTIFY_MAX_ATTEMPTS = 8;
const NOTIFY_RETRY_BATCH = 20;
const EMAIL_SHAPE = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

type FeedbackArgs = PreferenceCalls["feedback.submit"]["args"];

type FeedbackRow = {
  id: string;
  message: string;
  app_version: string | null;
  platform: string | null;
  created_at: number;
  owner_id: string | null;
  account_email: string | null;
  contact: string | null;
  notify_attempts: number;
};

type Sender = { name: string | null; email: string | null };

const NO_SENDER: Sender = { name: null, email: null };

const db = (env: Cloudflare.Env): D1Database => {
  if (!env.DB) throw new RpcError("UNAVAILABLE", "Feedback isn't available right now.");
  return env.DB;
};

const meta = (value: string | undefined): string | null =>
  value?.replace(/\s+/g, " ").trim().slice(0, META_MAX_CHARS) || null;

const feedbackInbox = (env: Cloudflare.Env): string | null => {
  const value = (env as unknown as Record<string, unknown>).STELLA_FEEDBACK_TO;
  return typeof value === "string" && EMAIL_SHAPE.test(value.trim()) ? value.trim() : null;
};

const ipHash = async (env: Cloudflare.Env, ip: string): Promise<string> => {
  const secret = (env as unknown as Record<string, unknown>).BETTER_AUTH_SECRET;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(typeof secret === "string" && secret ? secret : "stella-feedback"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`feedback-ip:${rateKeyForIp(ip)}`));
  return Array.from(new Uint8Array(mac).slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const countSince = async (env: Cloudflare.Env, where: string, bind: unknown[], since: number): Promise<number> => {
  const row = await db(env)
    .prepare(`SELECT COUNT(*) AS n FROM feedback WHERE ${where} AND created_at > ?`)
    .bind(...bind, since)
    .first<{ n: number }>();
  return row?.n ?? 0;
};

const limited = (message: string): RpcError =>
  new RpcError("RATE_LIMITED", message, { retryable: false });

/** Null for a guest (anonymous) session, whose placeholder email reaches nobody. */
const readAccount = async (env: Cloudflare.Env, ownerId: string): Promise<Sender | null> => {
  const row = await db(env)
    .prepare('SELECT "name", "email", "isAnonymous" FROM "user" WHERE "id" = ?')
    .bind(ownerId)
    .first<{ name: string | null; email: string | null; isAnonymous: number | null }>();
  if (!row || row.isAnonymous) return null;
  return { name: row.name?.trim() || null, email: row.email?.trim() || null };
};

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const isProduction = (env: Cloudflare.Env): boolean =>
  (env as unknown as Record<string, unknown>).TELEMETRY_ENVIRONMENT === "production";

const buildEmail = (env: Cloudflare.Env, row: FeedbackRow, sender: Sender) => {
  const replyTo = row.account_email ?? (row.contact && EMAIL_SHAPE.test(row.contact) ? row.contact : null);
  const signedIn = Boolean(row.owner_id && row.account_email);
  const who = signedIn
    ? sender.name
      ? `${sender.name} <${row.account_email}>`
      : row.account_email!
    : row.contact
      ? `${row.contact} (not signed in)`
      : "someone not signed in";
  const firstLine = row.message.split("\n").find((line) => line.trim())?.trim() ?? "";
  const preview = firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine;
  const subject = `${isProduction(env) ? "" : "[dev] "}Stella feedback from ${
    signedIn ? (sender.name ?? row.account_email) : (row.contact ?? "someone signed out")
  }: ${preview}`;
  const facts: Array<[string, string]> = [
    ["From", who],
    ["Signed in", signedIn ? `yes (account ${row.owner_id})` : row.owner_id ? "no (guest session)" : "no"],
    ...(signedIn && row.contact ? ([["Contact left", row.contact]] as Array<[string, string]>) : []),
    ["Platform", row.platform ?? "not sent"],
    ["App version", row.app_version ?? "not sent"],
    ["Sent", new Date(row.created_at).toUTCString()],
    ["Feedback id", row.id],
  ];
  const replyLine = replyTo
    ? "Reply to this email to answer them."
    : "They left no email address, so this can't be answered.";
  const text = [
    row.message,
    "",
    "—",
    ...facts.map(([label, value]) => `${label}: ${value}`),
    "",
    replyLine,
  ].join("\n");
  const html = `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.5;color:#111">
<div style="white-space:pre-wrap">${escapeHtml(row.message)}</div>
<hr style="border:none;border-top:1px solid #ddd;margin:20px 0">
<table style="font-size:13px;color:#555;border-collapse:collapse">${facts
    .map(
      ([label, value]) =>
        `<tr><td style="padding:2px 12px 2px 0;vertical-align:top">${escapeHtml(label)}</td><td style="padding:2px 0">${escapeHtml(value)}</td></tr>`,
    )
    .join("")}</table>
<p style="font-size:13px;color:#555">${escapeHtml(replyLine)}</p>
</div>`;
  return { subject, text, html, ...(replyTo ? { replyTo } : {}) };
};

const notify = async (env: Cloudflare.Env, row: FeedbackRow, sender?: Sender): Promise<boolean> => {
  const to = feedbackInbox(env);
  if (!to) return false;
  const now = Date.now();
  try {
    const resolved = sender ?? (row.owner_id ? ((await readAccount(env, row.owner_id)) ?? NO_SENDER) : NO_SENDER);
    const provider = await sendEmail(env, { to, ...buildEmail(env, row, resolved) });
    await db(env)
      .prepare("UPDATE feedback SET notified_at = ?, notify_attempts = notify_attempts + 1, notify_error = NULL WHERE id = ?")
      .bind(now, row.id)
      .run();
    console.log(JSON.stringify({ event: "feedback_emailed", id: row.id, provider }));
    return true;
  } catch (error) {
    const detail = (error instanceof Error ? error.message : String(error)).slice(0, 300);
    await db(env)
      .prepare("UPDATE feedback SET notify_attempts = notify_attempts + 1, notify_error = ? WHERE id = ?")
      .bind(detail, row.id)
      .run()
      .catch(() => undefined);
    console.error(JSON.stringify({ event: "feedback_email_failed", id: row.id, detail }));
    return false;
  }
};

const submitFeedback = async (ctx: PublicContext, args: FeedbackArgs): Promise<null> => {
  const message = args.message.trim();
  if (!message) throw new RpcError("BAD_REQUEST", "Feedback can't be empty.");
  if (message.length > FEEDBACK_MAX_CHARS) {
    throw new RpcError("BAD_REQUEST", `Feedback is limited to ${FEEDBACK_MAX_CHARS} characters.`);
  }
  const contact = args.contact?.replace(/\s+/g, " ").trim() || null;
  if (contact && contact.length > FEEDBACK_CONTACT_MAX_CHARS) {
    throw new RpcError("BAD_REQUEST", `Contact details are limited to ${FEEDBACK_CONTACT_MAX_CHARS} characters.`);
  }
  const ownerId = ctx.caller?.ownerId ?? null;
  const account = ownerId ? await readAccount(ctx.env, ownerId) : null;
  let hashedIp: string | null = null;
  if (ownerId && account) {
    if ((await countSince(ctx.env, "owner_id = ?", [ownerId], ctx.now - HOUR_MS)) >= SIGNED_IN_PER_HOUR) {
      throw limited("You've sent a lot of feedback in the last hour. Try again later.");
    }
  } else {
    hashedIp = await ipHash(ctx.env, ctx.clientIp);
    const [lastHour, lastDay, everyone] = await Promise.all([
      countSince(ctx.env, "ip_hash = ?", [hashedIp], ctx.now - HOUR_MS),
      countSince(ctx.env, "ip_hash = ?", [hashedIp], ctx.now - DAY_MS),
      countSince(ctx.env, "owner_id IS NULL AND ip_hash IS NOT NULL", [], ctx.now - DAY_MS),
    ]);
    if (lastHour >= SIGNED_OUT_PER_HOUR || lastDay >= SIGNED_OUT_PER_DAY) {
      throw limited("You've sent a lot of feedback from here recently. Try again later, or sign in to send more.");
    }
    if (everyone >= SIGNED_OUT_ALL_PER_DAY) {
      throw limited("Feedback without an account is paused for today. Sign in to send it, or try again tomorrow.");
    }
  }
  const sender = account ?? NO_SENDER;
  const row: FeedbackRow = {
    id: crypto.randomUUID(),
    message,
    app_version: meta(args.appVersion),
    platform: meta(args.platform),
    created_at: ctx.now,
    owner_id: ownerId,
    account_email: sender.email,
    contact,
    notify_attempts: 0,
  };
  await db(ctx.env)
    .prepare(
      `INSERT INTO feedback (id, message, app_version, platform, created_at, owner_id, account_email, contact, ip_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id,
      row.message,
      row.app_version,
      row.platform,
      row.created_at,
      row.owner_id,
      row.account_email,
      row.contact,
      hashedIp,
    )
    .run();
  await notify(ctx.env, row, sender);
  return null;
};

/** Emails feedback whose first send failed; run from the hourly cron. */
export const retryFeedbackEmails = async (env: Cloudflare.Env): Promise<void> => {
  if (!env.DB || !feedbackInbox(env)) return;
  const now = Date.now();
  const { results } = await env.DB.prepare(
    `SELECT id, message, app_version, platform, created_at, owner_id, account_email, contact, notify_attempts
       FROM feedback
      WHERE notified_at IS NULL AND notify_attempts < ? AND created_at BETWEEN ? AND ?
      ORDER BY created_at LIMIT ?`,
  )
    .bind(NOTIFY_MAX_ATTEMPTS, now - 7 * DAY_MS, now - 5 * 60_000, NOTIFY_RETRY_BATCH)
    .all<FeedbackRow>();
  for (const row of results) await notify(env, row);
};

/** Account deletion: keeps the message, drops who sent it. */
export const forgetFeedbackSender = (database: D1Database, ownerId: string): D1PreparedStatement =>
  database
    .prepare("UPDATE feedback SET owner_id = NULL, account_email = NULL, contact = NULL WHERE owner_id = ?")
    .bind(ownerId);

export const feedbackDomain = {
  name: "feedback",
  calls: {
    "feedback.submit": {
      scope: "public",
      parse: object({
        message: string({ max: FEEDBACK_MAX_CHARS * 2 }),
        contact: optional(string({ max: FEEDBACK_CONTACT_MAX_CHARS * 2 })),
        appVersion: optional(string({ max: 1_000 })),
        platform: optional(string({ max: 1_000 })),
      }),
      handler: (ctx: PublicContext, args: FeedbackArgs) => submitFeedback(ctx, args),
    },
  },
} satisfies OwnerDomain;
