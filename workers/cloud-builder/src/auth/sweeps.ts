import { ownerGateStub } from "../rpc-release.js";
import { ownerModeEnabled } from "../selfhost/owner-mode.js";

const DAY_MS = 24 * 60 * 60_000;
const ANONYMOUS_PER_RUN = 200;

type SweepEnv = Pick<Cloudflare.Env, "DB" | "OWNER_GATES">;

const db = (env: SweepEnv): D1Database => {
  if (!env.DB) throw new Error("D1 is not bound.");
  return env.DB;
};

export const sweepAuthTables = async (env: SweepEnv, now = Date.now()): Promise<void> => {
  const nowIso = new Date(now).toISOString();
  await db(env).batch([
    db(env).prepare('DELETE FROM "verification" WHERE "expiresAt" < ?').bind(nowIso),
    db(env).prepare('DELETE FROM "session" WHERE "expiresAt" < ?').bind(nowIso),
    db(env).prepare('DELETE FROM "rateLimit" WHERE "lastRequest" < ?').bind(now - DAY_MS),
    db(env).prepare("DELETE FROM auth_link_requests WHERE expires_at < ?").bind(now),
    db(env).prepare("DELETE FROM auth_browser_handoffs WHERE expires_at < ?").bind(now),
    db(env).prepare("DELETE FROM integrity_nonces WHERE expires_at < ?").bind(now),
  ]);
};

export const sweepAnonymousUsers = async (env: SweepEnv): Promise<void> => {
  const keepOwner = ownerModeEnabled(env)
    ? ` AND u."id" NOT IN (SELECT owner_user_id FROM selfhost_server)`
    : "";
  const { results } = await db(env)
    .prepare(
      `SELECT u."id" AS id FROM "user" u
        WHERE u."isAnonymous" = 1${keepOwner}
        LIMIT ?`,
    )
    .bind(ANONYMOUS_PER_RUN)
    .all<{ id: string }>();
  let closed = 0;
  for (const { id } of results) {
    try {
      await ownerGateStub(env.OWNER_GATES, id).closeOwner();
      await db(env).prepare('DELETE FROM "user" WHERE "id" = ?').bind(id).run();
      closed += 1;
    } catch (error) {
      console.error(
        JSON.stringify({
          event: "anonymous_user_close_failed",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  }
  if (results.length > 0) {
    console.log(JSON.stringify({ event: "anonymous_users_closed", closed, batch: results.length }));
  }
};
