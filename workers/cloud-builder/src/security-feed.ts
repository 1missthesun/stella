/**
 * Stella Security's shared news read. Every few hours one model reads the day's security stories
 * for everyone (only stories it hasn't read before), and each computer downloads the same result
 * and matches it locally. Nothing about anyone is sent to build it or to fetch it.
 *
 *   GET  /api/security/feed                  the current feed (public news, no account needed)
 *   POST /api/admin/security/feed/refresh    rebuild now (admin secret)
 * The hourly cron rebuilds it when it is older than REFRESH_MS.
 */
import { FEED_MODEL, isStale, openRouterClient, publicFeed, refreshFeed, type SharedFeed } from "@stella/security/feed";
import { bearerCredential } from "../../shared/bearer.js";
import { fail, json } from "./http/response.js";
import { fixedWorkSha256SecretEqual } from "./service-bearer.js";

type FeedEnv = { DB?: D1Database; OPENROUTER_API_KEY?: string; STELLA_ADMIN_API_SECRET?: string };

const database = (env: FeedEnv): D1Database => {
  if (!env.DB) throw new Error("No database bound");
  return env.DB;
};

const ROW = "current";
const LEASE_MS = 15 * 60_000;

const load = async (env: FeedEnv): Promise<SharedFeed | undefined> => {
  const row = await database(env).prepare("SELECT body FROM security_feed WHERE id = ?").bind(ROW).first<{ body: string }>();
  const feed = row ? (JSON.parse(row.body) as Partial<SharedFeed>) : undefined;
  return feed?.version ? (feed as SharedFeed) : undefined;
};

/** Rebuild the feed if it's due (or forced). Only one build runs at a time. */
export const refreshSecurityFeed = async (env: FeedEnv, opts: { force?: boolean } = {}) => {
  const key = env.OPENROUTER_API_KEY?.trim();
  if (!key) throw new Error("OPENROUTER_API_KEY is not set");
  const previous = await load(env);
  if (!opts.force && !isStale(previous)) return { built: false as const, reason: "fresh", feed: previous };
  const now = Date.now();
  await database(env).prepare("INSERT OR IGNORE INTO security_feed (id, body, checked_at, lease_until) VALUES (?, '{}', 0, NULL)").bind(ROW).run();
  const lease = await database(env).prepare("UPDATE security_feed SET lease_until = ? WHERE id = ? AND (lease_until IS NULL OR lease_until < ?)")
    .bind(now + LEASE_MS, ROW, now)
    .run();
  if (!lease.meta.changes) return { built: false as const, reason: "already building", feed: previous };
  try {
    const feed = await refreshFeed(openRouterClient(FEED_MODEL, key), previous, now);
    await database(env).prepare("UPDATE security_feed SET body = ?, checked_at = ?, lease_until = NULL WHERE id = ?")
      .bind(JSON.stringify(feed), Date.parse(feed.checkedAt), ROW)
      .run();
    console.log(`[security-feed] read ${feed.storyCount} new stories, ${feed.threats.length} threats, $${feed.usage.costUsd.toFixed(4)}`);
    return { built: true as const, feed };
  } catch (error) {
    await database(env).prepare("UPDATE security_feed SET lease_until = NULL WHERE id = ?").bind(ROW).run();
    throw error;
  }
};

export const handleSecurityFeedRoute = async (request: Request, env: FeedEnv): Promise<Response | null> => {
  const url = new URL(request.url);
  if (url.pathname === "/api/security/feed") {
    if (request.method !== "GET") return fail(405, "Method not allowed.");
    const feed = await load(env);
    if (!feed) return fail(503, "The feed hasn't been built yet.");
    return Response.json(publicFeed(feed), { headers: { "cache-control": "public, max-age=600" } });
  }
  if (url.pathname === "/api/admin/security/feed/refresh") {
    if (request.method !== "POST") return fail(405, "Method not allowed.");
    const expected = env.STELLA_ADMIN_API_SECRET?.trim() ?? "";
    if (!expected) return fail(503, "Admin API disabled.");
    const provided = bearerCredential(request.headers.get("authorization")) ?? "";
    if (!(await fixedWorkSha256SecretEqual(provided, expected))) return fail(401, "Invalid admin credentials.");
    try {
      const r = await refreshSecurityFeed(env, { force: url.searchParams.get("force") === "1" });
      const f = r.feed;
      return json({
        built: r.built,
        ...(r.built ? {} : { reason: r.reason }),
        ...(f ? { builtAt: f.builtAt, checkedAt: f.checkedAt, storyCount: f.storyCount, threats: f.threats.length, costUsd: f.usage.costUsd, errors: f.errors } : {}),
      });
    } catch (error) {
      return fail(500, error instanceof Error ? error.message : String(error));
    }
  }
  return null;
};
