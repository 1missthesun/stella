#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const force = args.includes("--force");
const bestEffort = args.includes("--best-effort");
const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..", "..", "..");

// Re-exec under Bun when invoked via Node (e.g. `node prepare-install.mjs`),
// since the source modules are TypeScript and installed launchers already run Bun.
if (typeof globalThis.Bun === "undefined") {
  const bunBin = process.env.STELLA_BUN_PATH?.trim() || "bun";
  const result = spawnSync(bunBin, [scriptPath, ...args], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ROLLDOWN_WORKER_THREADS: process.env.ROLLDOWN_WORKER_THREADS || "4",
      RAYON_NUM_THREADS: process.env.RAYON_NUM_THREADS || "4",
      MIMALLOC_PURGE_DELAY: "0",
    },
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) {
    console.error(`[prebuild-renderer] ${bunBin} unavailable: ${result.error.message}`);
    process.exit(bestEffort ? 0 : 1);
  }
  process.exit(bestEffort ? 0 : (result.status ?? 1));
}

try {
  const { prebuildDesktopRenderer } = await import("../electron/source/prebuild-renderer.ts");
  await prebuildDesktopRenderer({ repoRoot, force });
  process.exit(0);
} catch (error) {
  console.error(
    `[prebuild-renderer] failed: ${error instanceof Error ? error.stack ?? error.message : String(error)}`,
  );
  process.exit(bestEffort ? 0 : 1);
}
