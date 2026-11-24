import crypto from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  computeRuntimeSourceStamp,
  runningRuntimeBytecodeStamp,
  stellaRootOfWorkerEntry,
} from "../kernel/shared/runtime-bytecode.js";

/**
 * Runtime code-identity stamp used by the staleness handshake between the
 * Electron host and the detached runtime worker.
 *
 * The detached worker deliberately outlives the Electron host (grace window
 * so in-flight agent runs survive a desktop restart). The cost: a host that
 * reconnects after a desktop update can silently adopt a worker running old
 * runtime code. This stamp makes that detectable:
 *
 *   - The worker computes the stamp of the runtime tree it loaded at boot
 *     and writes it to Electron `userData/runtime/<rootHash>/build-stamp.txt`
 *     (see `WorkerLifecycleServer.start`).
 *   - The host, when it attaches to an existing worker, recomputes the stamp
 *     from the on-disk tree and compares. Mismatch (or a missing worker
 *     stamp, i.e. a pre-stamp worker) means "stale worker" — the host then
 *     restarts it immediately when idle, or defers until quiescence.
 *
 * The stamp is stat-based (relative path + size + mtimeMs) over the files
 * in the runtime tree. No file contents are read, so computing it is a cheap
 * directory walk. A
 * real code change virtually always changes size or mtime; mtime-preserving
 * copies with identical sizes are the only blind spot and don't occur in
 * the desktop-update path.
 *
 * A Stella checkout, whether its worker runs the TypeScript or the bytecode
 * build of it (`kernel/shared/runtime-bytecode.ts`), stamps every input of
 * the worker graph with `computeRuntimeSourceStamp`, so both kinds of worker
 * of one tree agree and either goes stale when any input changes. Any other
 * layout (a packaged bundle) stamps the bundle's own folder.
 */

export const RUNTIME_BUILD_STAMP_UNAVAILABLE = "unavailable";

const STAMPED_FILE_SUFFIXES = [".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"];

const SKIPPED_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "browser-data",
  "bun-transpiler-cache",
  "tests",
  "scripts",
]);

const hasStampedSuffix = (name: string): boolean => {
  const lower = name.toLowerCase();
  return (
    STAMPED_FILE_SUFFIXES.some((suffix) => lower.endsWith(suffix)) &&
    !lower.includes(".test.")
  );
};

export const resolveRuntimeBundleRoot = (workerEntryPath: string): string =>
  path.resolve(path.dirname(workerEntryPath), "..");

export const resolveRuntimeCodeRoots = (workerEntryPath: string): string[] => {
  const runtimeRoot = resolveRuntimeBundleRoot(workerEntryPath);
  return workerEntryPath.endsWith(".ts")
    ? [runtimeRoot, path.join(runtimeRoot, "..", "contracts")]
    : [runtimeRoot];
};

const collectStampLines = (
  rootDir: string,
  currentDir: string,
  lines: string[],
): void => {
  const entries = readdirSync(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const name = entry.name;
    if (entry.isDirectory()) {
      if (SKIPPED_DIR_NAMES.has(name)) continue;
      collectStampLines(rootDir, path.join(currentDir, name), lines);
      continue;
    }
    if (!entry.isFile() || !hasStampedSuffix(name)) continue;
    const absPath = path.join(currentDir, name);
    const relPath = path
      .relative(path.dirname(rootDir), absPath)
      .replace(/\\/g, "/");
    let size = 0;
    let mtimeMs = 0;
    try {
      const stats = statSync(absPath);
      size = stats.size;
      mtimeMs = Math.round(stats.mtimeMs);
    } catch {
      // File vanished mid-walk (concurrent rebuild); record presence only.
    }
    lines.push(`${relPath}\n${size}\n${mtimeMs}`);
  }
};

/** Stamp of the runtime code on disk now, for the worker at this entry. */
export const computeRuntimeBuildStamp = (workerEntryPath: string): string => {
  const trimmedEntry = workerEntryPath?.trim();
  if (!trimmedEntry) return RUNTIME_BUILD_STAMP_UNAVAILABLE;
  try {
    const stellaRoot = stellaRootOfWorkerEntry(trimmedEntry);
    if (stellaRoot) return computeRuntimeSourceStamp(stellaRoot).slice(0, 32);
    const lines: string[] = [];
    for (const rootDir of resolveRuntimeCodeRoots(trimmedEntry)) {
      collectStampLines(rootDir, rootDir, lines);
    }
    if (lines.length === 0) return RUNTIME_BUILD_STAMP_UNAVAILABLE;
    lines.sort();
    return crypto
      .createHash("sha256")
      .update(lines.join("\0"))
      .digest("hex")
      .slice(0, 32);
  } catch {
    return RUNTIME_BUILD_STAMP_UNAVAILABLE;
  }
};

/**
 * Stamp of the code this worker process loaded: a bytecode worker reports
 * the build it runs (the tree may have moved on since it was built); a
 * source worker stamps the tree as it boots.
 */
export const computeLoadedRuntimeBuildStamp = (workerEntryPath: string): string =>
  runningRuntimeBytecodeStamp()?.slice(0, 32) ?? computeRuntimeBuildStamp(workerEntryPath);
