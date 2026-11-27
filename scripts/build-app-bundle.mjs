#!/usr/bin/env bun
// Builds the app bundle a first install opens Stella from before anything else is installed
// (the launcher's first stage; see packages/node-shared/integrations/app-hydration.ts): the
// published tree's files plus what Stella's first start would otherwise build or install first.
// That is the Rune host and UI boot bundles (packages/desktop-rune/.cache, HOST.md "Boot
// bundles"), the runtime worker's bytecode build (packages/desktop/dist-electron/runtime-bytecode)
// and the few packages the host loads before its bundle (React). It has no .git and no other
// node_modules: the launcher checks the same commit out in place and installs the packages behind
// the open window.
//
//   bun scripts/build-app-bundle.mjs --tree <app-source tree> --out <dir> --backend <url>
//       [--commit <sha>] [--base-url <url>] [--unpinned]
//
// Writes <out>/<commit>/app-<platform>.tar.gz and <out>/<commit>/app-bundle.json:
//
//   { format, commit, platforms: { <platform>: { file, url?, sha256, bytes, files, backend,
//     engine: { version, url, sha256, member? } } } }
//
// Every boot bundle is keyed to the platform, the exact Bun build and the backend the UI talks
// to, so build each platform's bundle on that platform, with the Bun the launcher installs
// (packages/desktop/launcher.json), for the backend its launchers use.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const option = (name, fallback = "") => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const log = (message) => console.log(`[app-bundle] ${message}`);
const fail = (message) => {
  console.error(`[app-bundle] ${message}`);
  process.exit(1);
};

const tree = path.resolve(option("tree") || fail("Pass --tree <app-source tree>."));
const outRoot = path.resolve(option("out") || fail("Pass --out <dir>."));
const backend = option("backend").replace(/\/+$/, "") || fail("Pass --backend <url> (the backend its launchers use).");
const baseUrl = option("base-url").replace(/\/+$/, "");
const platform = `${{ darwin: "darwin", linux: "linux", win32: "win" }[process.platform]}-${process.arch}`;

const sha256File = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const toPosix = (value) => value.replace(/\\/g, "/");
const seconds = (since) => ((performance.now() - since) / 1000).toFixed(1);

const commit =
  option("commit") ||
  spawnSync("git", ["rev-parse", "HEAD"], { cwd: tree, encoding: "utf8" }).stdout?.trim() ||
  fail("Pass --commit <sha>: the tree has no git HEAD.");

const launcher = readJson(path.join(tree, "packages", "desktop", "launcher.json"));
if (launcher.bun.version !== Bun.version) {
  fail(`Run this with Bun ${launcher.bun.version} (the launcher's), not ${Bun.version}.`);
}
if (!fs.existsSync(path.join(tree, "packages", "desktop-rune", "host", "main.tsx"))) {
  fail("This tree has no Rune host (packages/desktop-rune/host/main.tsx).");
}
// A launcher opens a bundle on Rune only where launcher.json pins a stella-engine build for the
// platform (engine_available in the launchers); elsewhere it starts Electron, which needs the
// packages first, so a bundle would not open faster. --unpinned is for local checks with
// --engine-bin.
const engineAsset = launcher.stellaEngine?.assets?.[platform];
if (!(launcher.stellaEngine?.version && engineAsset?.url && engineAsset?.sha256) && !args.includes("--unpinned")) {
  fail(`launcher.json pins no stella-engine build for ${platform}, so launchers start Electron there.`);
}

// The environment Stella runs with under a launcher: production UI, the launcher's backend, and
// none of this shell's VITE_ values (the UI boot bundle's key holds them).
const appEnv = () => ({
  ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("VITE_"))),
  STELLA_LAUNCHER: "1",
  STELLA_LAUNCHER_ENGINE: "rune",
  VITE_STELLA_BACKEND_URL: backend,
});
const run = (command, commandArgs, cwd, env = {}) => {
  const started = performance.now();
  const result = spawnSync(command, commandArgs, { cwd, stdio: "inherit", env: { ...appEnv(), ...env } });
  if (result.status !== 0) fail(`${path.basename(command)} ${commandArgs.join(" ")} exited ${result.status}`);
  return seconds(started);
};

// The published files, without git, packages or build outputs.
const SKIPPED = new Set([".git", "node_modules", ".cache"]);
const OUTPUT_DIRS = ["packages/desktop/dist-electron"];
const treeFiles = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const relative = toPosix(path.relative(tree, full));
    if (OUTPUT_DIRS.some((output) => relative === output || relative.startsWith(`${output}/`))) continue;
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile() || entry.isSymbolicLink()) treeFiles.push(relative);
  }
};
walk(tree);
treeFiles.sort();

// Packages the host requires before its bundle (host/services/ui-mode.ts pinReactBuild) and the
// bundles keep external; shipped as plain folders, which the install later replaces.
const EARLY_PACKAGES = ["react", "react-reconciler", "scheduler"];

const work = fs.mkdtempSync(path.join(os.tmpdir(), "stella-app-bundle-"));
const app = path.join(work, "app");
try {
  log(`commit ${commit.slice(0, 12)}, ${treeFiles.length} files, ${platform}, backend ${backend}`);
  for (const relative of treeFiles) {
    const to = path.join(app, relative);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.cpSync(path.join(tree, relative), to, { verbatimSymlinks: true });
  }
  log(`installed packages in ${run(process.execPath, ["install", "--frozen-lockfile", "--ignore-scripts"], app, { STELLA_SKIP_DESKTOP_POSTINSTALL: "1" })}s`);
  // Output folders made before any build.
  for (const dir of ["host", "ui"]) fs.mkdirSync(path.join(app, "packages", "desktop-rune", ".cache", dir), { recursive: true });
  fs.mkdirSync(path.join(app, "packages", "desktop", "dist-electron", "runtime-bytecode"), { recursive: true });

  // Whole seconds on every file: a tar keeps them, and the boot bundles and the runtime
  // bytecode are checked against them.
  const mtime = new Date(Math.floor(Date.now() / 1000) * 1000 - 1000);
  for (const relative of treeFiles) {
    const file = path.join(app, relative);
    if (!fs.lstatSync(file).isSymbolicLink()) fs.utimesSync(file, mtime, mtime);
  }

  log(
    `built the runtime bytecode in ${run(process.execPath, ["packages/runtime/scripts/build-worker-bytecode.mjs", "--force"], app, { STELLA_BUN_PATH: process.execPath })}s`,
  );
  log(`built the Rune boot bundles in ${run(process.execPath, ["packages/desktop-rune/scripts/build-boot-bundles.ts"], app)}s`);

  // The bytecode is good for this Bun binary wherever it is installed.
  const bytecodeDir = path.join(app, "packages", "desktop", "dist-electron", "runtime-bytecode");
  const currentFile = path.join(bytecodeDir, "current.json");
  const current = readJson(currentFile);
  const { computeRuntimeSourceStamp } = await import(
    path.join(app, "packages", "runtime", "kernel", "shared", "runtime-bytecode.ts")
  );
  if (current.stamp !== computeRuntimeSourceStamp(app)) fail("The runtime bytecode does not match the tree it was built from.");
  current.portable = { bunSha256: sha256File(process.execPath) };
  fs.writeFileSync(currentFile, `${JSON.stringify(current, null, 2)}\n`);

  const outputs = [];
  const collect = (relative) => {
    const full = path.join(app, relative);
    if (!fs.existsSync(full)) return;
    if (fs.statSync(full).isDirectory()) {
      for (const name of fs.readdirSync(full)) collect(`${relative}/${name}`);
    } else if (!path.basename(relative).startsWith(".held-")) {
      outputs.push(relative);
    }
  };
  collect("packages/desktop-rune/.cache");
  for (const name of fs.readdirSync(bytecodeDir)) {
    if (name === "entry.js" || name === "current.json" || name === current.file || name === `${current.file}.jsc`) {
      outputs.push(`packages/desktop/dist-electron/runtime-bytecode/${name}`);
    }
  }

  // The early packages as plain folders in the Rune package's node_modules, where the host and
  // its bundles resolve them from, out of a staging copy.
  const staging = path.join(work, "early");
  const early = [];
  const runeHost = path.join(app, "packages", "desktop-rune", "host");
  const resolved = new Map();
  for (const name of EARLY_PACKAGES) {
    // scheduler is react-reconciler's dependency, not the host's.
    const from = [runeHost, ...resolved.values()].find((dir) => {
      try {
        return Bun.resolveSync(`${name}/package.json`, dir);
      } catch {
        return false;
      }
    });
    if (!from) fail(`${name} does not resolve from the Rune host.`);
    const real = path.dirname(fs.realpathSync(Bun.resolveSync(`${name}/package.json`, from)));
    resolved.set(name, real);
    const to = path.join(staging, "packages", "desktop-rune", "node_modules", name);
    fs.cpSync(real, to, { recursive: true, dereference: true });
    for (const file of fs.readdirSync(to, { recursive: true })) {
      if (fs.statSync(path.join(to, file)).isFile()) early.push(toPosix(path.join("packages", "desktop-rune", "node_modules", name, file)));
    }
  }

  const outDir = path.join(outRoot, commit);
  fs.mkdirSync(outDir, { recursive: true });
  const listFile = path.join(work, "files.txt");
  const earlyList = path.join(work, "early.txt");
  fs.writeFileSync(listFile, `${[...treeFiles, ...outputs.sort()].join("\n")}\n`);
  fs.writeFileSync(earlyList, `${early.sort().join("\n")}\n`);
  const file = `app-${platform}.tar.gz`;
  const archive = path.join(outDir, file);
  const started = performance.now();
  // One list per tar call: bsdtar (macOS, Windows) reads only the last -T of a command line, so
  // the early packages are appended to an uncompressed tar and the whole is gzipped after.
  // COPYFILE_DISABLE keeps macOS's tar from adding AppleDouble (._*) files.
  const plain = path.join(work, "app.tar");
  const tarEnv = { ...process.env, COPYFILE_DISABLE: "1" };
  // Windows packs with its own bsdtar: the GNU tar Git Bash puts first on PATH reads "C:\…" as a
  // remote host.
  const tarBin = process.platform === "win32" ? path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tar.exe") : "tar";
  for (const [mode, dir, list] of [
    ["-cf", app, listFile],
    ["-rf", staging, earlyList],
  ]) {
    const tar = spawnSync(tarBin, [mode, plain, "-C", dir, "-T", list], { stdio: "inherit", env: tarEnv });
    if (tar.status !== 0) fail(`tar ${mode} exited ${tar.status}`);
  }
  const { pipeline } = await import("node:stream/promises");
  const zlib = await import("node:zlib");
  await pipeline(fs.createReadStream(plain), zlib.createGzip({ level: 6 }), fs.createWriteStream(archive));
  const bytes = fs.statSync(archive).size;
  const count = treeFiles.length + outputs.length + early.length;
  const manifestFile = path.join(outDir, "app-bundle.json");
  const manifest = fs.existsSync(manifestFile) ? readJson(manifestFile) : { format: 1, commit, platforms: {} };
  manifest.platforms[platform] = {
    file,
    ...(baseUrl ? { url: `${baseUrl}/${commit}/${file}` } : {}),
    sha256: sha256File(archive),
    bytes,
    files: count,
    backend,
    // The launcher fetches this alongside the bundle (the same build the bundle's launcher.json pins).
    ...(engineAsset?.url ? { engine: { version: launcher.stellaEngine.version, ...engineAsset } } : {}),
  };
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  log(`${file}: ${(bytes / 1e6).toFixed(1)} MB, ${count} files, packed in ${seconds(started)}s`);
  log(`wrote ${manifestFile}`);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}
