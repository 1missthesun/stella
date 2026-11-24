import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * The renderer's source cache (transformed modules, dependency bundles,
 * module graphs) gains entries with every version and every draft preview
 * and never needed old ones again. Entries are touched when used
 * (`touchCacheEntry`), so whatever nothing used for a while is removed.
 */
export const RENDERER_CACHE_MAX_AGE_MS = 21 * 24 * 60 * 60 * 1000;

/** Marks a cache entry as used now; failures don't matter. */
export const touchCacheEntry = (entry: string) => {
  const now = new Date();
  void fs.utimes(entry, now, now).catch(() => undefined);
};

// The bulk; graphs, routes and Tailwind results are a few small files per checkout.
const SECTIONS = ["modules", "deps", "bundles"];

export const pruneRendererCache = async (
  cacheDir: string,
  maxAgeMs = RENDERER_CACHE_MAX_AGE_MS,
): Promise<{ removed: number; bytes: number }> => {
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  let bytes = 0;
  const sizeOf = async (entry: string): Promise<number> => {
    const stat = await fs.lstat(entry).catch(() => null);
    if (!stat) return 0;
    if (!stat.isDirectory()) return stat.size;
    let total = 0;
    for (const name of await fs.readdir(entry).catch(() => [])) total += await sizeOf(path.join(entry, name));
    return total;
  };
  for (const section of SECTIONS) {
    const dir = path.join(cacheDir, section);
    const names = await fs.readdir(dir).catch(() => [] as string[]);
    for (const name of names) {
      const entry = path.join(dir, name);
      const stat = await fs.lstat(entry).catch(() => null);
      if (!stat || stat.mtimeMs >= cutoff) continue;
      // A dependency bundle's folder keeps its mtime; its manifest is what a use touches.
      if (stat.isDirectory()) {
        const manifest = await fs.stat(path.join(entry, "manifest.json")).catch(() => null);
        if (manifest && manifest.mtimeMs >= cutoff) continue;
      }
      const size = await sizeOf(entry);
      try {
        await fs.rm(entry, { recursive: true, force: true });
        removed += 1;
        bytes += size;
      } catch {
        // In use: next time.
      }
    }
  }
  return { removed, bytes };
};
