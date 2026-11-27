#!/usr/bin/env bun
/**
 * Build the runtime worker's bytecode bundle (see
 * packages/runtime/kernel/shared/runtime-bytecode.ts for the design).
 *
 *   bun packages/runtime/scripts/build-worker-bytecode.mjs [--force] [--check]
 *
 * Run by the host in the background when a spawn found no build matching
 * the source tree; safe to run by hand. Never touches the build a running
 * worker loaded: a new build is published by moving `current.json`.
 */
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import path from "node:path";
import { appRootBanner, atAppRoot, MODULE_PATHS, relocateModulePaths } from "../../../scripts/lib/module-paths.mjs";
import {
  checkRuntimeBytecode,
  computeRuntimeSourceStamp,
  readRuntimeBytecodeBuild,
  RUNTIME_BYTECODE_FORMAT,
  runtimeBytecodeDir,
} from "../kernel/shared/runtime-bytecode.ts";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const outDir = runtimeBytecodeDir(repoRoot);
const lockPath = path.join(outDir, ".build.lock");
const LOCK_STALE_MS = 10 * 60_000;
const KEEP_PREVIOUS = 1;

// Native addons and modules resolved at runtime stay outside the bundle.
const EXTERNALS = [
  "electron",
  "undici",
  "esbuild",
  "@silvia-odwyer/photon-node",
  "mac-screen-capture-permissions",
  "uiohook-napi",
];

const LOADER = `"use strict";
// Fixed entry for the runtime worker's bytecode build: runs the build that
// current.json names. Written by packages/runtime/scripts/build-worker-bytecode.mjs.
const fs = require("node:fs");
const path = require("node:path");
const current = JSON.parse(fs.readFileSync(path.join(__dirname, "current.json"), "utf8"));
if (!/^entry-[0-9a-f]+\\.js$/.test(current.file)) throw new Error("runtime bytecode: bad current.json");
globalThis.__stellaRuntimeBytecode = { stamp: current.stamp, file: current.file };
require(path.join(__dirname, current.file));
`;

const writeAtomic = (file, contents) => {
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, contents);
  renameSync(temp, file);
};

const moveInto = (from, to) => {
  try {
    renameSync(from, to);
  } catch (error) {
    if (!existsSync(to)) throw error;
  }
};

const pidAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
};

const takeLock = () => {
  mkdirSync(outDir, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = openSync(lockPath, "wx");
      writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }));
      closeSync(fd);
      return true;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      let holder = null;
      try {
        holder = JSON.parse(readFileSync(lockPath, "utf8"));
      } catch {
        // Half-written or unreadable: judge it by age.
      }
      const age = Date.now() - (holder?.at ?? statSync(lockPath).mtimeMs);
      if (holder?.pid && pidAlive(holder.pid) && age < LOCK_STALE_MS) return false;
      rmSync(lockPath, { force: true });
    }
  }
  return false;
};

const releaseLock = () => {
  try {
    const holder = JSON.parse(readFileSync(lockPath, "utf8"));
    if (holder?.pid === process.pid) unlinkSync(lockPath);
  } catch {
    // Already gone.
  }
};

/** Remove builds other than the current one and the newest previous one. */
const prune = (currentFile) => {
  let names = [];
  try {
    names = readdirSync(outDir);
  } catch {
    return;
  }
  const builds = names
    .filter((name) => /^entry-[0-9a-f]+\.js$/.test(name) && name !== currentFile)
    .map((name) => ({ name, mtimeMs: statSync(path.join(outDir, name)).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(KEEP_PREVIOUS);
  for (const { name } of builds) {
    for (const file of [name, `${name}.jsc`]) {
      try {
        rmSync(path.join(outDir, file), { force: true });
      } catch {
        // In use on Windows: the next build tries again.
      }
    }
  }
  for (const name of names) {
    if (name.startsWith(".build-") && !name.includes(`-${process.pid}`)) {
      rmSync(path.join(outDir, name), { recursive: true, force: true });
    }
  }
};

// The bundle's own paths (a module's import.meta.url, dir, __dirname) are expressions on the app
// folder it runs from, which the banner finds from the bundle's real location: an app bundle's
// build was made in another folder (scripts/build-app-bundle.mjs, scripts/lib/module-paths.mjs).
const AT_APP = atAppRoot(repoRoot);
const APP_ROOT_BANNER = appRootBanner(outDir, repoRoot);
const SOURCE_FILE = /\.([cm]?[jt]sx?)$/;
const LOADERS = { ".ts": "ts", ".mts": "ts", ".cts": "ts", ".tsx": "tsx", ".jsx": "jsx" };

const bundle = async (stagingDir) => {
  const result = await Bun.build({
    entrypoints: [path.join(repoRoot, "packages", "runtime", "worker", "entry.ts")],
    outdir: stagingDir,
    naming: { entry: "entry.js" },
    target: "bun",
    format: "cjs",
    bytecode: true,
    sourcemap: "none",
    external: EXTERNALS,
    banner: APP_ROOT_BANNER,
    throw: false,
    plugins: [
      {
        name: "stella-runtime-bytecode",
        setup(build) {
          // effect's ConfigProvider reads `import.meta?.env`, which is not
          // valid in a CommonJS bundle and makes Bun skip the bytecode. The
          // runtime reads configuration from process.env, never import.meta.
          build.onLoad({ filter: /effect[/\\]dist[/\\]ConfigProvider\.js$/ }, (args) => ({
            contents: readFileSync(args.path, "utf8").replaceAll("import.meta?.env", "undefined"),
            loader: "js",
          }));
          build.onLoad({ filter: SOURCE_FILE }, (args) => {
            const source = readFileSync(args.path, "utf8");
            if (!MODULE_PATHS.test(source)) return undefined;
            return {
              contents: relocateModulePaths(source, args.path, repoRoot, AT_APP),
              loader: LOADERS[path.extname(args.path)] ?? "js",
            };
          });
        },
      },
    ],
  });
  if (!result.success) {
    throw new Error(
      `Bun.build failed:\n${result.logs.map((log) => log.message ?? String(log)).join("\n")}`,
    );
  }
  const js = path.join(stagingDir, "entry.js");
  if (!existsSync(js) || !existsSync(`${js}.jsc`)) {
    throw new Error("Bun.build wrote no bytecode for the worker bundle.");
  }
};

export const buildRuntimeWorkerBytecode = async ({ force = false, log = () => {} } = {}) => {
  const startedAt = Date.now();
  const bun = process.execPath;
  if (!force && checkRuntimeBytecode(repoRoot, bun).usable) {
    return { built: false, reason: "fresh" };
  }
  if (!takeLock()) return { built: false, reason: "busy" };
  const stagingDir = path.join(outDir, `.build-${process.pid}`);
  try {
    const stamp = computeRuntimeSourceStamp(repoRoot);
    rmSync(stagingDir, { recursive: true, force: true });
    await bundle(stagingDir);
    // Sources that moved while building make this build a mix: drop it.
    if (computeRuntimeSourceStamp(repoRoot) !== stamp) {
      return { built: false, reason: "source-changed-during-build" };
    }
    const file = `entry-${stamp.slice(0, 16)}.js`;
    // Bytecode first, then the bundle: a bundle never sits beside a
    // missing or older .jsc. A same-stamp build already in place is kept
    // (Windows refuses to replace a file a worker has open).
    moveInto(path.join(stagingDir, "entry.js.jsc"), path.join(outDir, `${file}.jsc`));
    moveInto(path.join(stagingDir, "entry.js"), path.join(outDir, file));
    const packageJson = path.join(outDir, "package.json");
    if (!existsSync(packageJson)) writeAtomic(packageJson, '{ "type": "commonjs" }\n');
    const loader = path.join(outDir, "entry.js");
    if (!existsSync(loader) || readFileSync(loader, "utf8") !== LOADER) {
      writeAtomic(loader, LOADER);
    }
    const bunStat = statSync(bun);
    writeAtomic(
      path.join(outDir, "current.json"),
      `${JSON.stringify(
        {
          format: RUNTIME_BYTECODE_FORMAT,
          stamp,
          file,
          platform: process.platform,
          arch: process.arch,
          bunVersion: Bun.version,
          bunPath: bun,
          bunSize: bunStat.size,
          bunMtimeMs: Math.round(bunStat.mtimeMs),
          builtAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
    );
    prune(file);
    const ms = Date.now() - startedAt;
    log(`built ${file} in ${ms}ms`);
    return { built: true, file, ms };
  } finally {
    rmSync(stagingDir, { recursive: true, force: true });
    releaseLock();
  }
};

if (import.meta.main) {
  if (process.argv.includes("--check")) {
    const verdict = checkRuntimeBytecode(repoRoot, process.execPath);
    console.log(
      verdict.usable
        ? `[runtime-bytecode] fresh (${readRuntimeBytecodeBuild(repoRoot)?.file})`
        : `[runtime-bytecode] not usable: ${verdict.reason}`,
    );
    process.exit(verdict.usable ? 0 : 1);
  }
  try {
    const result = await buildRuntimeWorkerBytecode({
      force: process.argv.includes("--force"),
      log: (message) => console.log(`[runtime-bytecode] ${message}`),
    });
    if (!result.built) console.log(`[runtime-bytecode] not built: ${result.reason}`);
  } catch (error) {
    console.error("[runtime-bytecode] build failed:", error);
    process.exit(1);
  }
}
