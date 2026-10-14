#!/usr/bin/env bun
import { spawn } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { resolveLogDir } from "@stella/runtime/worker/runtime-paths";

const logDir = resolveLogDir(process.cwd());

console.log(logDir);

if (!existsSync(logDir)) {
  console.log("(no logs yet — directory will be created on next run)");
  process.exit(0);
}

const files = readdirSync(logDir)
  .filter((name) => /\.(txt|log)$/.test(name))
  .sort();
for (const name of files) {
  const { size } = statSync(path.join(logDir, name));
  console.log(`  ${name}  ${(size / 1024).toFixed(1)} KB`);
}

if (process.argv.includes("--print")) process.exit(0);

const opener =
  process.platform === "darwin"
    ? "open"
    : process.platform === "win32"
      ? "explorer"
      : "xdg-open";
spawn(opener, [logDir], { stdio: "ignore", detached: true }).unref();
