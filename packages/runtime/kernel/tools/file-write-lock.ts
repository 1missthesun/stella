/**
 * Per-path serialization for file-mutating tools.
 *
 * When an agent batch issues multiple Edit/Write/apply_patch calls against
 * the same file in parallel, unserialized read-modify-write cycles race:
 * last-write-wins clobbering, lost hunks, and (observed in the wild)
 * NUL-padded tail corruption from interleaved writes. Every tool-level
 * mutation of a file must run its ENTIRE read → apply → write cycle inside
 * `withFileWriteLock` so concurrent edits of the same resolved path execute
 * sequentially. Edits to different paths still run in parallel.
 */

import { promises as fs } from "fs";
import path from "path";

const queues = new Map<string, Promise<void>>();

const normalizeLockKey = (resolved: string): string =>
  process.platform === "linux" ? resolved : resolved.toLowerCase();

const lockKeyForPath = (filePath: string): string => {
  const resolved = path.resolve(filePath);
  // File systems on macOS/Windows are typically case-insensitive; normalize
  // so `/Foo.ts` and `/foo.ts` serialize against each other.
  return normalizeLockKey(resolved);
};

/**
 * Run `fn` with an exclusive async lock on `filePath`. Calls targeting the
 * same resolved path are chained FIFO; other paths are unaffected. The
 * caller's read-modify-write cycle must live entirely inside `fn` — no
 * reading current content before acquiring the lock.
 */
export const withFileWriteLock = async <T>(
  filePath: string,
  fn: () => Promise<T>,
): Promise<T> => {
  const key = lockKeyForPath(filePath);
  const prev = queues.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  queues.set(key, tail);
  void tail.then(() => {
    if (queues.get(key) === tail) {
      queues.delete(key);
    }
  });
  return run;
};

export const withFileWriteLocks = async <T>(
  filePaths: string[],
  fn: () => Promise<T>,
): Promise<T> => {
  const keys = [...new Set(filePaths.map(lockKeyForPath))].sort();
  const run = keys.reduceRight<() => Promise<T>>(
    (inner, key) => () => withFileWriteLock(key, inner),
    fn,
  );
  return run();
};

const containsUnexpectedNul = (written: string, intended: string): boolean =>
  written.includes("\u0000") && !intended.includes("\u0000");

const utf8OnDiskIntent = (content: string): string =>
  Buffer.from(content, "utf8").toString("utf8");

/**
 * Write `content` to `filePath` and verify the bytes on disk don't contain
 * NUL bytes that weren't in the intended content (the corruption signature
 * seen when parallel edits raced). Should be unreachable once writes are
 * serialized — retries once and fails loudly if it ever fires.
 */
export const writeFileWithNulGuard = async (
  filePath: string,
  content: string,
  options?: { flag?: string },
): Promise<void> => {
  const maxAttempts = 2;
  const intended = utf8OnDiskIntent(content);
  let lastWritten = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await fs.writeFile(filePath, content, {
      encoding: "utf-8",
      ...(options?.flag && attempt === 1 ? { flag: options.flag } : {}),
    });
    lastWritten = await fs.readFile(filePath, "utf-8");
    if (lastWritten === intended) {
      return;
    }
    const kind = containsUnexpectedNul(lastWritten, intended)
      ? "NUL-byte corruption"
      : "read-back mismatch";
    console.error(
      `[file-write-lock] ${kind} detected after writing ` +
        `${filePath} (attempt ${attempt}/${maxAttempts}) — this should be ` +
        `impossible with per-path serialization; investigate concurrent ` +
        `writers outside the tool layer.`,
    );
  }
  throw new Error(
    containsUnexpectedNul(lastWritten, intended)
      ? `Write verification failed for ${filePath}: file contains NUL bytes ` +
          `that were not part of the intended content, even after a retry. ` +
          `The file may be corrupted by a concurrent writer.`
      : `Write verification failed for ${filePath}: the bytes on disk do ` +
          `not match the intended content, even after a retry.`,
  );
};

