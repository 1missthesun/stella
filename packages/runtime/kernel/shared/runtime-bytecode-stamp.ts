import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const STAMP_ROOTS = [
  "packages/runtime",
  "packages/agent",
  "packages/contracts",
  "packages/node-shared",
];

const STAMP_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "tests",
  "scripts",
  "dist",
  "dist-worker",
  ".exec-worker-cache",
]);

const STAMP_SUFFIXES = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs", ".json"]);

const toPosix = (p: string): string => p.split(path.sep).join("/");

/**
 * Fast stat-based fingerprint of all TypeScript/JavaScript/JSON sources that
 * feed into the Bun runtime worker bytecode snapshot. Used both by the builder
 * and at launch time so a stale snapshot falls back to source automatically.
 */
export const computeRuntimeBytecodeSourceStamp = (repoRoot: string): string => {
  const hash = createHash("sha256");
  hash.update(`platform:${process.platform}\0arch:${process.arch}\0`);
  const entries: string[] = [];
  const walk = (dir: string): void => {
    let list;
    try {
      list = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of list) {
      if (entry.isDirectory()) {
        if (STAMP_SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(dir, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      if (entry.name.includes(".test.")) continue;
      if (!STAMP_SUFFIXES.has(path.extname(entry.name).toLowerCase())) continue;
      entries.push(path.join(dir, entry.name));
    }
  };
  for (const rel of STAMP_ROOTS) {
    walk(path.join(repoRoot, rel));
  }
  for (const extra of [
    "bun.lock",
    "packages/runtime/scripts/build-worker-bytecode.mjs",
  ]) {
    const abs = path.join(repoRoot, extra);
    if (existsSync(abs)) entries.push(abs);
  }
  entries.sort();
  for (const abs of entries) {
    let stat;
    try {
      stat = lstatSync(abs);
    } catch {
      continue;
    }
    hash.update(toPosix(path.relative(repoRoot, abs)));
    hash.update("\0");
    hash.update(String(stat.size));
    hash.update("\0");
    hash.update(String(Math.round(stat.mtimeMs)));
    hash.update("\0");
  }
  return hash.digest("hex");
};

export type RuntimeBytecodeFingerprint = {
  readonly version: number;
  readonly bunVersion: string;
  readonly bunBinPath?: string;
  readonly bunBinSize?: number;
  readonly bunBinMtimeMs?: number;
  readonly platform: string;
  readonly arch: string;
  readonly stamp: string;
  readonly builtAt: string;
  readonly units: number;
};

export const readRuntimeBytecodeFingerprint = (
  workerDir: string,
): RuntimeBytecodeFingerprint | null => {
  try {
    const raw = readFileSync(
      path.join(workerDir, ".bytecode-fingerprint.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as Partial<RuntimeBytecodeFingerprint>;
    if (
      parsed &&
      parsed.version === 1 &&
      typeof parsed.stamp === "string" &&
      typeof parsed.bunVersion === "string" &&
      typeof parsed.platform === "string" &&
      typeof parsed.arch === "string"
    ) {
      return parsed as RuntimeBytecodeFingerprint;
    }
  } catch {
    // Missing or unreadable fingerprint.
  }
  return null;
};

export const isRuntimeBytecodeSnapshotFresh = (
  repoRoot: string,
  entryPath: string,
): boolean => {
  if (!existsSync(entryPath) || !existsSync(`${entryPath}.jsc`)) {
    return false;
  }
  const fp = readRuntimeBytecodeFingerprint(path.dirname(entryPath));
  if (!fp) return false;
  if (fp.platform !== process.platform || fp.arch !== process.arch) {
    return false;
  }
  const bunVersion = (process.versions as Record<string, string | undefined>)
    .bun;
  if (bunVersion && fp.bunVersion !== bunVersion) {
    return false;
  }
  // When checked from Node/Electron main (`process.versions.bun` is undefined),
  // validate the Bun binary itself so a Bun runtime upgrade invalidates stale
  // `.jsc` snapshots without spawning a subprocess.
  const configuredBun = process.env.STELLA_BUN_PATH?.trim();
  if (fp.bunBinPath) {
    const activeBun = configuredBun || fp.bunBinPath;
    if (configuredBun && path.resolve(configuredBun) !== path.resolve(fp.bunBinPath)) {
      return false;
    }
    try {
      const stat = statSync(activeBun);
      if (
        (typeof fp.bunBinSize === "number" && stat.size !== fp.bunBinSize) ||
        (typeof fp.bunBinMtimeMs === "number" && Math.round(stat.mtimeMs) !== fp.bunBinMtimeMs)
      ) {
        return false;
      }
    } catch {
      return false;
    }
  }
  return fp.stamp === computeRuntimeBytecodeSourceStamp(repoRoot);
};
