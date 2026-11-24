import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/**
 * The runtime worker's bytecode build: the worker entry and everything it
 * imports, compiled by Bun into ONE CommonJS bundle with a `.jsc` bytecode
 * cache beside it, so a spawn skips parsing and compiling ~1,000 modules.
 *
 * One bundle on purpose: Bun only emits bytecode for CommonJS without code
 * splitting, and bundling pieces separately gives every module they share
 * its own copy (two registries, two caches, two `instanceof` classes).
 *
 * The build is a cache of the source tree, never a second source of truth:
 *   - `computeRuntimeSourceStamp` fingerprints every input (the four
 *     packages the worker graph is drawn from, the lockfile, the root
 *     package.json and its dependency patches, and the builder itself).
 *   - A spawn uses the bytecode only when `current.json` names a build of
 *     exactly that stamp, for this OS and CPU; otherwise it runs the source
 *     as before, and the host asks for a rebuild in the background.
 *   - Builds land as `entry-<stamp>.js`, and `current.json` moves to a new
 *     one atomically, so a worker that is running keeps the file it loaded.
 *
 * Workers are always started through the fixed loader `entry.js` in the
 * same folder, which reads `current.json`, so a worker's command line is
 * the same from one build to the next.
 */

export const RUNTIME_BYTECODE_DIR_PARTS = [
  "packages",
  "desktop",
  "dist-electron",
  "runtime-bytecode",
] as const;

export const RUNTIME_BYTECODE_FORMAT = 1;

const STAMP_ROOTS = [
  "packages/runtime",
  "packages/agent",
  "packages/contracts",
  "packages/node-shared",
];

const STAMP_EXTRA_FILES = [
  "bun.lock",
  "package.json",
  "packages/runtime/scripts/build-worker-bytecode.mjs",
];

const STAMP_EXTRA_DIRS = ["patches"];

const SKIPPED_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "tests",
  "scripts",
  "dist",
  "dist-electron",
  "browser-data",
  "bun-transpiler-cache",
]);

const STAMPED_SUFFIXES = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
]);

export const runtimeBytecodeDir = (stellaRoot: string): string =>
  path.join(stellaRoot, ...RUNTIME_BYTECODE_DIR_PARTS);

export const runtimeBytecodeLoaderPath = (stellaRoot: string): string =>
  path.join(runtimeBytecodeDir(stellaRoot), "entry.js");

export const runtimeSourceEntryPath = (stellaRoot: string): string =>
  path.join(stellaRoot, "packages", "runtime", "worker", "entry.ts");

/** Both command lines a worker of this Stella root can have. */
export const runtimeWorkerEntryVariants = (workerEntryPath: string): string[] => {
  const root = stellaRootOfWorkerEntry(workerEntryPath);
  if (!root) return [workerEntryPath];
  const variants = [
    workerEntryPath,
    runtimeSourceEntryPath(root),
    runtimeBytecodeLoaderPath(root),
  ];
  return variants.filter((entry, index) => variants.indexOf(entry) === index);
};

/** The checkout a worker entry belongs to, when it is the source or the loader. */
export const stellaRootOfWorkerEntry = (workerEntryPath: string): string | null => {
  const resolved = path.resolve(workerEntryPath);
  const sourceRoot = path.resolve(resolved, "..", "..", "..", "..");
  if (resolved === runtimeSourceEntryPath(sourceRoot)) return sourceRoot;
  const loaderRoot = path.resolve(resolved, "..", "..", "..", "..", "..");
  if (resolved === runtimeBytecodeLoaderPath(loaderRoot)) return loaderRoot;
  return null;
};

const toPosix = (value: string): string => value.split(path.sep).join("/");

const isStampedFile = (name: string): boolean =>
  STAMPED_SUFFIXES.has(path.extname(name).toLowerCase()) &&
  !name.includes(".test.");

/**
 * Fingerprint of everything the worker bundle is built from: relative path,
 * size and mtime of each file (no contents read, a few ms). Shared by the
 * builder, the spawn check and the stale-worker handshake, so a worker
 * running source and one running bytecode of the same tree agree.
 */
export const computeRuntimeSourceStamp = (stellaRoot: string): string => {
  const files: string[] = [];
  const walk = (dir: string, all: boolean): void => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIR_NAMES.has(entry.name)) walk(full, all);
      } else if (entry.isFile() && (all || isStampedFile(entry.name))) {
        files.push(full);
      }
    }
  };
  for (const rel of STAMP_ROOTS) walk(path.join(stellaRoot, rel), false);
  for (const rel of STAMP_EXTRA_DIRS) walk(path.join(stellaRoot, rel), true);
  for (const rel of STAMP_EXTRA_FILES) files.push(path.join(stellaRoot, rel));
  const lines: string[] = [];
  for (const file of files) {
    let size = -1;
    let mtimeMs = -1;
    try {
      const stat = statSync(file);
      size = stat.size;
      mtimeMs = Math.round(stat.mtimeMs);
    } catch {
      // Missing (an optional extra) or removed mid-walk: presence only.
    }
    lines.push(`${toPosix(path.relative(stellaRoot, file))}\n${size}\n${mtimeMs}`);
  }
  lines.sort();
  return createHash("sha256")
    .update(`format:${RUNTIME_BYTECODE_FORMAT}\0`)
    .update(lines.join("\0"))
    .digest("hex");
};

export type RuntimeBytecodeBuild = {
  readonly format: number;
  readonly stamp: string;
  readonly file: string;
  readonly platform: string;
  readonly arch: string;
  readonly bunVersion: string;
  readonly bunPath: string;
  readonly bunSize: number;
  readonly bunMtimeMs: number;
  readonly builtAt: string;
};

export const readRuntimeBytecodeBuild = (
  stellaRoot: string,
): RuntimeBytecodeBuild | null => {
  try {
    const parsed = JSON.parse(
      readFileSync(path.join(runtimeBytecodeDir(stellaRoot), "current.json"), "utf8"),
    ) as Partial<RuntimeBytecodeBuild>;
    if (
      parsed?.format === RUNTIME_BYTECODE_FORMAT &&
      typeof parsed.stamp === "string" &&
      typeof parsed.file === "string" &&
      /^entry-[0-9a-f]+\.js$/.test(parsed.file) &&
      typeof parsed.platform === "string" &&
      typeof parsed.arch === "string" &&
      typeof parsed.bunPath === "string"
    ) {
      return parsed as RuntimeBytecodeBuild;
    }
  } catch {
    // None yet, or unreadable: the source runs.
  }
  return null;
};

export type RuntimeBytecodeVerdict =
  | { readonly usable: true; readonly loaderPath: string; readonly stamp: string }
  | { readonly usable: false; readonly reason: string; readonly stamp: string | null };

const sameFile = (a: string, b: string): boolean => {
  try {
    return path.resolve(a) === path.resolve(b);
  } catch {
    return false;
  }
};

/**
 * Whether a worker spawned now may run the bytecode build. `bunBinaryPath`
 * is the Bun that will run it: bytecode is only valid for the exact Bun
 * build that wrote it (Bun silently re-parses the bundle's source when it
 * is not, which is correct but slow, so a different Bun counts as stale).
 */
export const checkRuntimeBytecode = (
  stellaRoot: string,
  bunBinaryPath?: string,
): RuntimeBytecodeVerdict => {
  if (process.env.STELLA_RUNTIME_FROM_SOURCE === "1") {
    return { usable: false, reason: "disabled", stamp: null };
  }
  const build = readRuntimeBytecodeBuild(stellaRoot);
  if (!build) return { usable: false, reason: "missing", stamp: null };
  if (build.platform !== process.platform || build.arch !== process.arch) {
    return { usable: false, reason: "platform", stamp: build.stamp };
  }
  const dir = runtimeBytecodeDir(stellaRoot);
  const loaderPath = runtimeBytecodeLoaderPath(stellaRoot);
  if (
    !existsSync(loaderPath) ||
    !existsSync(path.join(dir, build.file)) ||
    !existsSync(path.join(dir, `${build.file}.jsc`))
  ) {
    return { usable: false, reason: "files", stamp: build.stamp };
  }
  const bun = bunBinaryPath?.trim();
  if (bun && bun !== "bun" && !sameFile(bun, build.bunPath)) {
    return { usable: false, reason: "bun-path", stamp: build.stamp };
  }
  try {
    const stat = statSync(build.bunPath);
    if (stat.size !== build.bunSize || Math.round(stat.mtimeMs) !== build.bunMtimeMs) {
      return { usable: false, reason: "bun-changed", stamp: build.stamp };
    }
  } catch {
    return { usable: false, reason: "bun-missing", stamp: build.stamp };
  }
  if (build.stamp !== computeRuntimeSourceStamp(stellaRoot)) {
    return { usable: false, reason: "source-changed", stamp: build.stamp };
  }
  return { usable: true, loaderPath, stamp: build.stamp };
};

/** Set by the loader inside a worker that runs a bytecode build. */
export const runningRuntimeBytecodeStamp = (): string | null => {
  const marker = (globalThis as { __stellaRuntimeBytecode?: { stamp?: unknown } })
    .__stellaRuntimeBytecode;
  return typeof marker?.stamp === "string" ? marker.stamp : null;
};
