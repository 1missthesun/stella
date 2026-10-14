/**
 * The cloud agents spending cap (`cloudAgentCaps`): containers running at
 * once and container-hours a calendar month (UTC), across the deployment.
 * On by default in owner mode, where the deployment has one owner; off on
 * hosted Stella unless its vars are set.
 *
 * Each running container has a row in D1 (`cloud_container_runs`), touched
 * while it is used; a row not touched for longer than a container's idle
 * timeout is a container the platform stopped, and is settled into the
 * month's total as if it ran until then.
 */

import { cloudAgentCaps } from "./selfhost/owner-mode.js";

const DEFAULT_IDLE_MS = 10 * 60_000;
const TOUCH_EVERY_MS = 60_000;

export class CloudAgentCapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CloudAgentCapError";
  }
}

type CapEnv = { DB?: D1Database; SANDBOX_IDLE_TIMEOUT_MS?: string };

const monthOf = (ms: number): string => new Date(ms).toISOString().slice(0, 7);

const idleMs = (env: CapEnv): number => {
  const value = Number(env.SANDBOX_IDLE_TIMEOUT_MS);
  return Number.isSafeInteger(value) && value > 0 ? value : DEFAULT_IDLE_MS;
};

const capsOf = (env: CapEnv) => {
  const caps = cloudAgentCaps(env);
  return caps.monthlyHours > 0 || caps.maxConcurrent > 0 ? caps : null;
};

const settleStale = async (db: D1Database, env: CapEnv, now: number): Promise<void> => {
  const cutoff = now - idleMs(env) - TOUCH_EVERY_MS;
  const { results } = await db
    .prepare("SELECT sandbox, started_at, last_seen FROM cloud_container_runs WHERE last_seen < ?")
    .bind(cutoff)
    .all<{ sandbox: string; started_at: number; last_seen: number }>();
  for (const row of results) {
    await settleRow(db, row.sandbox, row.started_at, row.last_seen + idleMs(env));
  }
};

const settleRow = async (db: D1Database, sandbox: string, startedAt: number, endedAt: number): Promise<void> => {
  const seconds = Math.max(0, Math.round((endedAt - startedAt) / 1000));
  await db.batch([
    db
      .prepare(
        `INSERT INTO cloud_container_months (month, seconds) VALUES (?, ?)
         ON CONFLICT(month) DO UPDATE SET seconds = seconds + excluded.seconds`,
      )
      .bind(monthOf(endedAt), seconds),
    db.prepare("DELETE FROM cloud_container_runs WHERE sandbox = ? AND started_at = ?").bind(sandbox, startedAt),
  ]);
};

/** Before a container starts: refuses past either cap, else records the run. */
export const admitContainerStart = async (env: CapEnv, sandbox: string, now = Date.now()): Promise<void> => {
  if (!(await checkContainerCaps(env, sandbox, now))) return;
  await env.DB!
    .prepare(
      `INSERT INTO cloud_container_runs (sandbox, started_at, last_seen) VALUES (?, ?, ?)
       ON CONFLICT(sandbox) DO UPDATE SET last_seen = excluded.last_seen`,
    )
    .bind(sandbox, now, now)
    .run();
};

/**
 * Throws CloudAgentCapError when another container may not start now; false
 * when no cap is configured.
 */
export const checkContainerCaps = async (env: CapEnv, sandbox = "", now = Date.now()): Promise<boolean> => {
  const caps = capsOf(env);
  if (!caps || !env.DB) return false;
  const db = env.DB;
  await settleStale(db, env, now);
  const { results: running } = await db
    .prepare("SELECT sandbox, started_at FROM cloud_container_runs WHERE sandbox != ?")
    .bind(sandbox)
    .all<{ sandbox: string; started_at: number }>();
  if (caps.maxConcurrent > 0 && running.length >= caps.maxConcurrent) {
    throw new CloudAgentCapError(
      `This Stella server runs at most ${caps.maxConcurrent} cloud containers at once, and that many are busy. Wait for one to finish, or run the agent on one of your computers. (The owner can raise STELLA_CLOUD_AGENT_MAX_CONCURRENT.)`,
    );
  }
  if (caps.monthlyHours > 0) {
    const month = await db
      .prepare("SELECT seconds FROM cloud_container_months WHERE month = ?")
      .bind(monthOf(now))
      .first<{ seconds: number }>();
    const usedSeconds =
      (month?.seconds ?? 0) + running.reduce((sum, row) => sum + Math.max(0, (now - row.started_at) / 1000), 0);
    if (usedSeconds >= caps.monthlyHours * 3600) {
      throw new CloudAgentCapError(
        `This Stella server's cloud agents have used their ${caps.monthlyHours} container-hours for this month, so cloud agents are paused until the 1st. Run agents on one of your computers meanwhile. (The owner can raise STELLA_CLOUD_AGENT_MONTHLY_HOURS.)`,
      );
    }
  }
  return true;
};

const lastTouch = new Map<string, number>();

/** While a container is in use; cheap, at most one write a minute per container. */
export const touchContainer = async (env: CapEnv, sandbox: string, now = Date.now()): Promise<void> => {
  if (!capsOf(env) || !env.DB) return;
  if (now - (lastTouch.get(sandbox) ?? 0) < TOUCH_EVERY_MS) return;
  lastTouch.set(sandbox, now);
  await env.DB.prepare("UPDATE cloud_container_runs SET last_seen = ? WHERE sandbox = ?").bind(now, sandbox).run();
};

/** After a container stopped: its time goes into the month's total. */
export const settleContainer = async (env: CapEnv, sandbox: string, now = Date.now()): Promise<void> => {
  if (!capsOf(env) || !env.DB) return;
  lastTouch.delete(sandbox);
  const row = await env.DB.prepare("SELECT started_at FROM cloud_container_runs WHERE sandbox = ?")
    .bind(sandbox)
    .first<{ started_at: number }>();
  if (row) await settleRow(env.DB, sandbox, row.started_at, now);
};
