import { createAuth, sendAccountEmail, testAccountsEnabled } from "./auth.js";
import { buildAccountDeletionEmail, type AccountDeletionEmailKind } from "./email-templates.js";
import { ownerGateStub } from "../rpc-release.js";
import { ownerModeEnabled } from "../selfhost/owner-mode.js";

export const ACCOUNT_DELETION_GRACE_MS = 7 * 24 * 60 * 60_000;
const TEST_ACCOUNT_SUFFIX = "@test.stella.local";
const ROWS_PER_RUN = 50;
const COMPLETION_EMAIL_ATTEMPTS = 48;
const STUCK_AFTER_MS = 3 * 24 * 60 * 60_000;

type DeletionRow = {
  user_id: string;
  email: string | null;
  status: "pending" | "deleting" | "done";
  requested_at: number;
  due_at: number;
  confirmation_sent_at: number | null;
  started_at: number | null;
  owner_closed_at: number | null;
  attempts: number;
};

const log = (level: "info" | "error", event: string, fields: Record<string, unknown> = {}) =>
  (level === "error" ? console.error : console.log)(JSON.stringify({ event, ...fields }));

const messageOf = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error)).slice(0, 300);

const d1 = (env: Cloudflare.Env): D1Database => {
  if (!env.DB) throw new Error("D1 is not bound.");
  return env.DB;
};

const dueLabel = (dueAt: number): string =>
  new Date(dueAt).toUTCString().replace(/:\d\d GMT$/, " UTC");

const sendDeletionEmail = (
  env: Cloudflare.Env,
  email: string,
  kind: AccountDeletionEmailKind,
  dueAt: number,
): Promise<void> =>
  sendAccountEmail(
    env,
    email,
    (logo) => buildAccountDeletionEmail(kind, logo, dueLabel(dueAt)),
    `account_deletion_email_${kind}`,
  );

const isSelfHostOwner = async (env: Cloudflare.Env, userId: string): Promise<boolean> => {
  if (!ownerModeEnabled(env)) return false;
  const row = await d1(env)
    .prepare("SELECT 1 AS owner FROM selfhost_server WHERE owner_user_id = ?")
    .bind(userId)
    .first<{ owner: number }>();
  return row !== null;
};

const revokeTokensIssuedBefore = async (env: Cloudflare.Env, userId: string, minIatMs: number) => {
  const gate = ownerGateStub(env.OWNER_GATES, userId);
  const { ownerGeneration } = await gate.snapshot();
  const result = await gate.ownerInternal({ name: "account.sessionsRevoked", args: { minIatMs }, ownerGeneration });
  if (!result.ok) throw new Error(`Token revocation failed: ${result.error.message}`);
  await gate
    .ownerInternal({ name: "devices.pushSessionsRevoked", args: {}, ownerGeneration })
    .catch((error: unknown) => log("error", "account_deletion_push_revoke_failed", { message: messageOf(error) }));
};

const reply = (status: number, body: Record<string, unknown>) => Response.json(body, { status });

/**
 * POST /api/auth/delete-user. Records the request, disables the account and
 * signs out every device; the hourly cron deletes it after the grace period.
 * Any failure before the request is fully recorded is reported and undone,
 * so the caller stays signed in.
 */
export const requestAccountDeletion = async (request: Request, env: Cloudflare.Env): Promise<Response> => {
  const session = await createAuth(env)
    .api.getSession({ headers: request.headers })
    .catch(() => null);
  const user = session?.user;
  if (!user?.id) return reply(401, { code: "UNAUTHORIZED", message: "Sign in to delete your account." });
  if (await isSelfHostOwner(env, user.id).catch(() => false)) {
    return reply(403, {
      code: "owner_account",
      message:
        "This is the account that owns this Stella server, so it can't be deleted here. To remove everything, take the server down with the self-host CLI (selfhost.mjs destroy).",
    });
  }

  const now = Date.now();
  const email = typeof user.email === "string" ? user.email : "";
  let grace = ACCOUNT_DELETION_GRACE_MS;
  const testAccount = testAccountsEnabled(env) && email.endsWith(TEST_ACCOUNT_SUFFIX);
  if (testAccount) {
    const body = (await request.clone().json().catch(() => null)) as { graceMs?: unknown } | null;
    if (typeof body?.graceMs === "number" && body.graceMs >= 0) grace = Math.min(body.graceMs, grace);
  }

  const gate = ownerGateStub(env.OWNER_GATES, user.id);
  let inserted = false;
  let row: DeletionRow | null = null;
  try {
    const result = await d1(env)
      .prepare(
        `INSERT INTO account_deletions (user_id, email, status, requested_at, due_at)
         VALUES (?, ?, 'pending', ?, ?) ON CONFLICT (user_id) DO NOTHING`,
      )
      .bind(user.id, email || null, now, now + grace)
      .run();
    inserted = (result.meta.changes ?? 0) > 0;
    row = await d1(env)
      .prepare("SELECT * FROM account_deletions WHERE user_id = ?")
      .bind(user.id)
      .first<DeletionRow>();
    if (!row || row.status !== "pending") throw new Error(`Deletion request is ${row?.status ?? "missing"}.`);
    await gate.setDeletionHold(true);
    if (testAccount && email.includes("+deletefail")) throw new Error("Simulated failure for a +deletefail test account.");
    await revokeTokensIssuedBefore(env, user.id, now);
    await d1(env).prepare('DELETE FROM "session" WHERE "userId" = ?').bind(user.id).run();
  } catch (error) {
    log("error", "account_deletion_request_failed", { message: messageOf(error) });
    if (inserted) {
      await gate.setDeletionHold(false).catch(() => undefined);
      await d1(env)
        .prepare("DELETE FROM account_deletions WHERE user_id = ? AND requested_at = ?")
        .bind(user.id, now)
        .run()
        .catch(() => undefined);
    }
    return reply(503, {
      code: "DELETION_NOT_RECORDED",
      message: "Stella couldn't record your deletion request. Your account was not changed. Try again.",
    });
  }

  log("info", "account_deletion_requested", { dueAt: row.due_at, repeat: !inserted });
  await gate.stopRenewal().catch((error: unknown) =>
    log("error", "account_deletion_stop_renewal_failed", { message: messageOf(error) }),
  );
  if (email && row.confirmation_sent_at === null) {
    try {
      await sendDeletionEmail(env, email, "requested", row.due_at);
      await d1(env)
        .prepare("UPDATE account_deletions SET confirmation_sent_at = ? WHERE user_id = ?")
        .bind(Date.now(), user.id)
        .run();
    } catch (error) {
      log("error", "account_deletion_confirmation_failed", { message: messageOf(error) });
    }
  }
  return reply(200, {
    success: true,
    message: "Deletion scheduled",
    deleteAfter: new Date(row.due_at).toISOString(),
  });
};

/** A sign-in during the grace period keeps the account. */
export const cancelAccountDeletion = async (env: Cloudflare.Env, userId: string): Promise<boolean> => {
  const row = await d1(env)
    .prepare("SELECT * FROM account_deletions WHERE user_id = ? AND status = 'pending'")
    .bind(userId)
    .first<DeletionRow>();
  if (!row) return false;
  await ownerGateStub(env.OWNER_GATES, userId).setDeletionHold(false);
  const removed = await d1(env)
    .prepare("DELETE FROM account_deletions WHERE user_id = ? AND status = 'pending'")
    .bind(userId)
    .run();
  if ((removed.meta.changes ?? 0) === 0) return false;
  log("info", "account_deletion_canceled", {});
  if (row.email) {
    await sendDeletionEmail(env, row.email, "canceled", row.due_at).catch((error: unknown) =>
      log("error", "account_deletion_cancel_email_failed", { message: messageOf(error) }),
    );
  }
  return true;
};

const signedInSince = async (env: Cloudflare.Env, row: DeletionRow): Promise<boolean> => {
  const found = await d1(env)
    .prepare('SELECT 1 AS found FROM "session" WHERE "userId" = ? AND "createdAt" > ? LIMIT 1')
    .bind(row.user_id, new Date(row.requested_at).toISOString())
    .first<{ found: number }>();
  return found !== null;
};

const recordFailure = (env: Cloudflare.Env, row: DeletionRow, error: unknown) =>
  d1(env)
    .prepare("UPDATE account_deletions SET attempts = attempts + 1, last_error = ? WHERE user_id = ?")
    .bind(messageOf(error), row.user_id)
    .run();

const advancePending = async (env: Cloudflare.Env, row: DeletionRow, now: number): Promise<void> => {
  if (await signedInSince(env, row)) {
    await cancelAccountDeletion(env, row.user_id);
    return;
  }
  if (row.email && row.confirmation_sent_at === null && row.due_at > now) {
    try {
      await sendDeletionEmail(env, row.email, "requested", row.due_at);
      await d1(env)
        .prepare("UPDATE account_deletions SET confirmation_sent_at = ? WHERE user_id = ?")
        .bind(now, row.user_id)
        .run();
    } catch (error) {
      log("error", "account_deletion_confirmation_failed", { message: messageOf(error) });
    }
  }
  if (row.due_at > now) {
    await ownerGateStub(env.OWNER_GATES, row.user_id).stopRenewal();
    return;
  }
  const started = await d1(env)
    .prepare("UPDATE account_deletions SET status = 'deleting', started_at = ? WHERE user_id = ? AND status = 'pending'")
    .bind(now, row.user_id)
    .run();
  if ((started.meta.changes ?? 0) === 0) return;
  log("info", "account_deletion_started", { requestedAt: row.requested_at });
  await advanceDeleting(env, { ...row, status: "deleting", started_at: now }, now);
};

const advanceDeleting = async (env: Cloudflare.Env, row: DeletionRow, now: number): Promise<void> => {
  const gate = ownerGateStub(env.OWNER_GATES, row.user_id);
  if (row.owner_closed_at === null) {
    await d1(env).batch([
      d1(env).prepare('DELETE FROM "session" WHERE "userId" = ?').bind(row.user_id),
      d1(env).prepare('DELETE FROM "user" WHERE "id" = ?').bind(row.user_id),
    ]);
    await gate.closeOwner();
    await d1(env).batch([
      d1(env).prepare("DELETE FROM github_installations WHERE owner_id = ?").bind(row.user_id),
      d1(env).prepare("DELETE FROM slack_github_connects WHERE owner_id = ?").bind(row.user_id),
      d1(env).prepare("DELETE FROM device_pairings WHERE owner_user_id = ?").bind(row.user_id),
      d1(env)
        .prepare("UPDATE account_deletions SET owner_closed_at = ? WHERE user_id = ?")
        .bind(now, row.user_id),
    ]);
  }
  const status = await gate.deletionStatus();
  if (!status.closed || status.purging) {
    if (row.started_at !== null && now - row.started_at > STUCK_AFTER_MS) {
      log("error", "account_deletion_stuck", { startedAt: row.started_at, closed: status.closed });
    }
    return;
  }
  if (row.email) {
    try {
      await sendDeletionEmail(env, row.email, "completed", row.due_at);
    } catch (error) {
      if (row.attempts + 1 < COMPLETION_EMAIL_ATTEMPTS) throw error;
      log("error", "account_deletion_completion_email_abandoned", { message: messageOf(error) });
    }
  }
  await d1(env)
    .prepare(
      "UPDATE account_deletions SET status = 'done', completed_at = ?, email = NULL, last_error = NULL WHERE user_id = ?",
    )
    .bind(Date.now(), row.user_id)
    .run();
  log("info", "account_deletion_completed", { requestedAt: row.requested_at, startedAt: row.started_at });
};

/** Hourly: cancel on sign-in, retry confirmations and renewal-off, delete due accounts, finish purges. */
export const runAccountDeletions = async (env: Cloudflare.Env, now = Date.now()): Promise<void> => {
  const { results } = await d1(env)
    .prepare(
      `SELECT * FROM account_deletions WHERE status IN ('pending', 'deleting')
        ORDER BY due_at LIMIT ?`,
    )
    .bind(ROWS_PER_RUN)
    .all<DeletionRow>();
  for (const row of results) {
    try {
      if (row.status === "pending") await advancePending(env, row, now);
      else await advanceDeleting(env, row, now);
    } catch (error) {
      log("error", "account_deletion_step_failed", { status: row.status, message: messageOf(error) });
      await recordFailure(env, row, error).catch(() => undefined);
    }
  }
};
