#!/usr/bin/env node
// Fetches the native assets a source install needs beyond `bun install`:
// the native helpers (computer use, capture), the stella-browser service and
// the office preview binary. The native launchers run this after `bun install`
// on install, after a relaunch request and after a rollback; each step skips
// work that is already done.
//
// Every asset is an optional feature, so a failed step is reported and the
// rest still run. Exits 1 when any step failed, so the launcher tries again
// on the next launch.
//
// Once every step succeeds for a commit, the commit is noted in the
// checkout's git dir and later runs for it return at once, so Stella can run this
// before an update relaunches it and the launcher's run on the way back up
// costs nothing. `--force` runs the steps regardless.
//
// Usage: bun packages/desktop/scripts/prepare-install.mjs [--force]

import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

const gitOutput = (args) => {
  const result = spawnSync("git", args, { cwd: repoRoot, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
};
const head = gitOutput(["rev-parse", "HEAD"]);
// The checkout's own git dir: the assets are in its working tree, so a
// worktree sharing the repository is not prepared by this one.
const gitDir = gitOutput(["rev-parse", "--absolute-git-dir"]);
const stampPath = gitDir ? path.join(gitDir, "stella-prepared-head") : "";
const readStamp = () => {
  try {
    return readFileSync(stampPath, "utf8").trim();
  } catch {
    return "";
  }
};
if (head && stampPath && !process.argv.includes("--force") && readStamp() === head) {
  console.log(`[prepare-install] already prepared for ${head.slice(0, 12)}`);
  process.exit(0);
}

const steps = [
  ["native helpers", "packages/desktop/scripts/download-native-helpers.mjs"],
  [
    "stella-browser",
    "packages/desktop/scripts/ensure-stella-browser.mjs",
    "--best-effort",
  ],
  [
    "office previews",
    "packages/stella-office/scripts/ensure-native.js",
    "--best-effort",
  ],
];

// The launcher's `bun install` skips the postinstall downloads with these;
// this script is where they happen.
const env = { ...process.env };
delete env.STELLA_SKIP_BROWSER_HYDRATE;
delete env.STELLA_SKIP_OFFICE_HYDRATE;

// The steps write to separate places and mostly wait on the network, so
// they run side by side; each one's output is printed whole when it ends.
const runStep = ([name, script, ...args]) =>
  new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, [script, ...args], {
      cwd: repoRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const out = [];
    const err = [];
    child.stdout.on("data", (chunk) => out.push(chunk));
    child.stderr.on("data", (chunk) => err.push(chunk));
    let ended = false;
    const done = (error, status) => {
      if (ended) return;
      ended = true;
      process.stdout.write(Buffer.concat(out));
      process.stderr.write(Buffer.concat(err));
      const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
      if (error || status !== 0) {
        console.error(
          `[prepare-install] ${name} failed after ${seconds}s: ${error?.message ?? `exit ${status}`}`,
        );
        resolve(name);
      } else {
        console.log(`[prepare-install] ${name} ready (${seconds}s)`);
        resolve(null);
      }
    };
    child.once("error", (error) => done(error, null));
    child.once("close", (status) => done(null, status));
  });

const failed = (await Promise.all(steps.map(runStep))).filter(Boolean);

if (failed.length > 0) {
  console.error(`[prepare-install] incomplete: ${failed.join(", ")}`);
  process.exit(1);
}
if (head && stampPath) {
  try {
    writeFileSync(stampPath, `${head}\n`);
  } catch {
    // Unnoted, the next run just checks again.
  }
}
