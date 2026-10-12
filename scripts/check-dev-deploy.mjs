#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

if (process.env.STELLA_DEV_DEPLOY_FORCE === "1") {
  console.warn("[dev-deploy] STELLA_DEV_DEPLOY_FORCE=1: skipping the master check.");
  process.exit(0);
}

const refuse = (message) => {
  console.error(`[dev-deploy] Refusing to deploy dev: ${message}`);
  console.error("[dev-deploy] Dev is shared. To test an unmerged change, run your own Preview: `bun run preview -- up` in workers/cloud-builder (DEPLOY.md, \"Previews\").");
  console.error("[dev-deploy] Set STELLA_DEV_DEPLOY_FORCE=1 only to restore dev deliberately.");
  process.exit(1);
};

const dirty = git("status", "--porcelain", "--untracked-files=no");
if (dirty) refuse(`the tree has uncommitted changes:\n${dirty.split("\n").slice(0, 10).join("\n")}`);

try {
  git("fetch", "--quiet", "origin", "master");
} catch (error) {
  refuse(`could not fetch origin/master (${String(error.stderr ?? error.message).trim().split("\n")[0]}).`);
}

const behind = Number(git("rev-list", "--count", "HEAD..origin/master"));
if (behind > 0) {
  refuse(`HEAD is missing ${behind} commit${behind === 1 ? "" : "s"} that origin/master has, so this deploy would roll back other agents' work. Rebase onto origin/master first.`);
}

const ahead = Number(git("rev-list", "--count", "origin/master..HEAD"));
const head = git("rev-parse", "--short", "HEAD");
const branch = git("rev-parse", "--abbrev-ref", "HEAD");
console.log(`[dev-deploy] ${branch} @ ${head}: contains origin/master${ahead ? `, plus ${ahead} unmerged commit${ahead === 1 ? "" : "s"} (push them, or the next deploy from master removes them)` : ""}.`);
