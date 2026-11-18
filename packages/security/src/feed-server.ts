/**
 * The shared daily news read, run on Stella's server rather than on every computer: one model
 * reads the day's security stories once for everyone, and each computer downloads the result and
 * matches it locally (nothing about the person is sent to build or fetch it).
 *
 * Safe to run on Cloudflare Workers: no files, no processes.
 */
import type { Threat } from "./engine/judge.ts";
import { openRouterClient, type ModelClient, type ModelUsage } from "./engine/model.ts";
import { ZERO_USAGE, buildFeed, gatherStories, mergeThreats, type Feed } from "./engine/news/feed.ts";

export { openRouterClient, type ModelClient };

/** The model that reads the news for everyone (it found every incident in the measurement). */
export const FEED_MODEL = "google/gemini-4-hydrogen";
/** How long an incident stays in the feed after it was first reported. */
export const KEEP_DAYS = 3;
/** Rebuild when the feed is older than this; each rebuild reads only stories it hasn't read. */
export const REFRESH_MS = 6 * 3_600_000;

export type SharedThreat = Threat & { firstSeen: string };
export type SharedFeed = Omit<Feed, "threats"> & {
  version: 1;
  threats: SharedThreat[];
  /** When the sources were last read (builtAt moves only when there was something new). */
  checkedAt: string;
  /** Stories already read, so the next build only pays for new ones. */
  read: { url: string; at: string }[];
  /** Model spend for the latest build only. */
  usage: ModelUsage;
};

/** What a computer downloads: the threats and when they were built, nothing else. */
export const publicFeed = (f: SharedFeed) => ({ builtAt: f.builtAt, checkedAt: f.checkedAt, storyCount: f.storyCount, model: f.model, threats: f.threats });

export const isStale = (f: SharedFeed | undefined, now = Date.now()) => !f || now - Date.parse(f.checkedAt) >= REFRESH_MS;

export const refreshFeed = async (model: ModelClient, previous: SharedFeed | undefined, now = Date.now()): Promise<SharedFeed> => {
  const keepFrom = now - KEEP_DAYS * 86_400_000;
  const stamp = new Date(now).toISOString();
  const read = (previous?.read ?? []).filter((r) => Date.parse(r.at) >= keepFrom);
  const seen = new Set(read.map((r) => r.url));
  const { stories, errors } = await gatherStories(30);
  const fresh = stories.filter((s) => !seen.has(s.url));
  const kept = (previous?.threats ?? []).filter((t) => Date.parse(t.firstSeen) >= keepFrom);
  if (!fresh.length) {
    return { ...(previous ?? { version: 1, builtAt: stamp, storyCount: 0, model: model.model }), version: 1, threats: kept, checkedAt: stamp, read, usage: ZERO_USAGE, errors };
  }
  const built = await buildFeed(model, { stories: fresh });
  const added: SharedThreat[] = built.threats.map((t) => ({ ...t, firstSeen: stamp }));
  // An older incident keeps its first-seen date when a new story repeats it.
  const threats = mergeThreats([...kept, ...added]);
  return {
    version: 1,
    builtAt: stamp,
    checkedAt: stamp,
    storyCount: fresh.length,
    model: model.model,
    threats,
    read: [...read, ...fresh.map((s) => ({ url: s.url, at: stamp }))],
    usage: built.usage,
    errors: [...errors, ...built.errors],
  };
};
