#!/usr/bin/env node
// Install only the dependencies a kind of work needs:
//
//   bun run deps <kind> [<kind>...] [-- <extra bun install args>]
//
//   runtime  packages/runtime + agent + contracts: runtime/agent typecheck,
//            check:boundary, runtime headless. No Electron binary.
//   backend  every workers/* + executor-cloud + model-catalog (+ runtime):
//            worker typechecks, build:dry-run, wrangler, Previews.
//   desktop  root + desktop + desktop-ui (+ runtime): electron:typecheck,
//            desktop-ui tsc, verify-stella desktop runs.
//   mobile   packages/mobile (+ contracts, theme): mobile:typecheck/lint,
//            Metro, expo export.
//   website  website + desktop (its build compiles the desktop renderer).
//   full     everything: CI-equivalent, lint:promises, releases, OTA.
//
// Kinds combine (`bun run deps desktop backend`) and installs are additive:
// a later kind keeps what an earlier one installed. Packages are hardlinked
// from bun's global cache, so a worktree costs little disk either way; the
// filter mainly saves time, inodes and postinstall work.
import { spawnSync } from "node:child_process";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

const desktop = ["./", "@stella/desktop", "@stella/desktop-ui"];
const KINDS = {
  runtime: { filters: ["@stella/runtime", "@stella/agent"], omitPeer: true },
  backend: {
    filters: ["./workers/*", "@stella/executor-cloud", "@stella/model-catalog"],
    omitPeer: true,
  },
  desktop: { filters: desktop, omitPeer: true, electron: true },
  mobile: { filters: ["stella-mobile"], omitPeer: false },
  website: { filters: [...desktop, "stella-website"], omitPeer: true, electron: true },
  full: { filters: null, omitPeer: false, electron: true },
};

const argv = process.argv.slice(2);
const dash = argv.indexOf("--");
const kinds = dash === -1 ? argv : argv.slice(0, dash);
const extra = dash === -1 ? [] : argv.slice(dash + 1);

const unknown = kinds.filter((kind) => !KINDS[kind]);
if (kinds.length === 0 || unknown.length > 0) {
  if (unknown.length) console.error(`Unknown kind: ${unknown.join(", ")}`);
  console.error(`Usage: bun run deps <${Object.keys(KINDS).join("|")}>... [-- <bun install args>]`);
  process.exit(2);
}

const chosen = kinds.map((kind) => KINDS[kind]);
const full = chosen.some((kind) => kind.filters === null);
const args = ["install", "--frozen-lockfile"];
if (!full && chosen.every((kind) => kind.omitPeer)) args.push("--omit", "peer");
if (!full) {
  for (const filter of new Set(chosen.flatMap((kind) => kind.filters))) {
    args.push("--filter", filter);
  }
}
args.push(...extra);

const env = { ...process.env };
if (!chosen.some((kind) => kind.electron)) env.ELECTRON_SKIP_BINARY_DOWNLOAD = "1";

console.log(`[deps] bun ${args.join(" ")}`);
const result = spawnSync("bun", args, { cwd: repoRoot, env, stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) {
  console.error(
    "[deps] Install failed. If your branch changed a package.json, refresh the lock first: `bun install --lockfile-only`, then rerun.",
  );
}
process.exit(result.status ?? 1);
