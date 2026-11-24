type UnifiedLike = {
  parse: (file?: unknown) => unknown;
  runSync: (tree: unknown, file?: unknown) => unknown;
};

export const MAX_CACHED_MARKDOWN_CHARS = 150_000;
const MAX_CACHED_ENTRY_CHARS = MAX_CACHED_MARKDOWN_CHARS / 4;

type CacheEntry = { tree: object; chars: number };

const entries = new Map<string, CacheEntry>();
let cachedChars = 0;

const pendingHits = new WeakMap<object, object>();

const cacheKey = (scope: string, text: string) => `${scope}\u0001${text}`;

const readEntry = (key: string): object | undefined => {
  const entry = entries.get(key);
  if (!entry) return undefined;
  entries.delete(key);
  entries.set(key, entry);
  return entry.tree;
};

const writeEntry = (key: string, tree: object, chars: number) => {
  if (chars > MAX_CACHED_ENTRY_CHARS) return;
  const existing = entries.get(key);
  if (existing) {
    entries.delete(key);
    cachedChars -= existing.chars;
  }
  entries.set(key, { tree, chars });
  cachedChars += chars;
  for (const [oldestKey, oldest] of entries) {
    if (cachedChars <= MAX_CACHED_MARKDOWN_CHARS) break;
    entries.delete(oldestKey);
    cachedChars -= oldest.chars;
  }
};

export function remarkMarkdownRenderCache(this: unknown, scope = ""): void {
  const processor = this as UnifiedLike;
  const base = Object.getPrototypeOf(processor) as Partial<UnifiedLike>;
  const baseParse = base.parse;
  const baseRunSync = base.runSync;
  if (typeof baseParse !== "function" || typeof baseRunSync !== "function") {
    return;
  }

  processor.parse = function parseWithCache(this: unknown, file?: unknown) {
    if (typeof file === "string") {
      const tree = readEntry(cacheKey(scope, file));
      if (tree) {
        const placeholder = { type: "root", children: [] };
        pendingHits.set(placeholder, tree);
        return placeholder;
      }
    }
    return baseParse.call(this, file);
  };

  processor.runSync = function runSyncWithCache(
    this: unknown,
    tree: unknown,
    file?: unknown,
  ) {
    if (tree && typeof tree === "object") {
      const cached = pendingHits.get(tree);
      if (cached) {
        pendingHits.delete(tree);
        return cached;
      }
    }
    const result = baseRunSync.call(this, tree, file);
    if (typeof file === "string" && result && typeof result === "object") {
      writeEntry(cacheKey(scope, file), result, file.length);
    }
    return result;
  };
}

