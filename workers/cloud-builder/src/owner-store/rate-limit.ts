import { RpcError } from "./errors.js";
import type { OwnerDb } from "./registry.js";

export const RATE_LIMIT_MIGRATION = {
  id: "platform.2-rate-limits",
  statements: [
    `CREATE TABLE owner_rate_limits (
       scope TEXT PRIMARY KEY,
       window_start INTEGER NOT NULL,
       count INTEGER NOT NULL
     )`,
  ],
};

type RateWindow = { windowStart: number; count: number };

/**
 * A fixed-window limit on one owner action. Throws `RATE_LIMITED` with the
 * wait until the window resets.
 *
 * The count is kept in memory (`OwnerDb.memory`) and written only when a
 * window opens and when it fills: a row write per request was about a tenth
 * of the owner object's writes. A filled window survives an eviction; a
 * partly used one restarts from its stored count, which only ever allows
 * more, never blocks early.
 */
export const enforceOwnerRateLimit = (
  db: OwnerDb,
  now: number,
  scope: string,
  limit: { count: number; windowMs: number },
  message: string,
): void => {
  const key = `rate-limit:${scope}`;
  let window = db.memory?.get(key) as RateWindow | undefined;
  if (!window || now - window.windowStart >= limit.windowMs) {
    const row = db.one<{ window_start: number; count: number }>(
      "SELECT window_start, count FROM owner_rate_limits WHERE scope = ?",
      scope,
    );
    window =
      row && now - row.window_start < limit.windowMs
        ? { windowStart: row.window_start, count: row.count }
        : undefined;
  }
  if (window) {
    if (window.count >= limit.count) {
      throw new RpcError("RATE_LIMITED", message, {
        retryAfterMs: window.windowStart + limit.windowMs - now,
      });
    }
    window.count += 1;
    if (!db.memory || window.count >= limit.count) {
      db.run(
        "UPDATE owner_rate_limits SET count = ? WHERE scope = ? AND window_start = ?",
        window.count,
        scope,
        window.windowStart,
      );
    }
    db.memory?.set(key, window);
    return;
  }
  db.run(
    `INSERT INTO owner_rate_limits (scope, window_start, count) VALUES (?, ?, 1)
     ON CONFLICT (scope) DO UPDATE SET window_start = excluded.window_start, count = 1`,
    scope,
    now,
  );
  db.memory?.set(key, { windowStart: now, count: 1 } satisfies RateWindow);
};
