import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { setPriority } from "node:os";
import path from "node:path";
import { getFileLogger } from "@stella/node-shared/observability/file-logger.js";
import {
  checkRuntimeBytecode,
  computeRuntimeSourceStamp,
  runtimeBytecodeDir,
} from "../kernel/shared/runtime-bytecode.js";
import { forkDelayed } from "./effect-runtime.js";
import { BASH, CLOSE_INHERITED_THEN_EXEC, onPath } from "./lifecycle/spawn.js";

/** After a spawn that ran source: let startup finish before building. */
const BUILD_DELAY_MS = 45_000;
const BUILD_TIMEOUT_MS = 10 * 60_000;

let pending: { stellaRoot: string } | null = null;
let running = false;
const failedStamps = new Set<string>();

const builderScript = (stellaRoot: string) =>
  path.join(stellaRoot, "packages", "runtime", "scripts", "build-worker-bytecode.mjs");

/** `STELLA_RUNTIME_BYTECODE=0` turns building off (spawns then run source). */
const enabled = (): boolean => process.env.STELLA_RUNTIME_BYTECODE?.trim() !== "0";

const runBuild = (stellaRoot: string, bunBinaryPath: string): void => {
  const verdict = checkRuntimeBytecode(stellaRoot, bunBinaryPath);
  if (verdict.usable || verdict.reason === "disabled") return;
  const script = builderScript(stellaRoot);
  if (!existsSync(script)) return;
  const dir = runtimeBytecodeDir(stellaRoot);
  mkdirSync(dir, { recursive: true });
  const logFd = openSync(path.join(dir, "build.log"), "w");
  const startedAt = Date.now();
  running = true;
  let child;
  try {
    // Through the same fd-closing trampoline as the worker: a child of
    // Electron otherwise keeps Chromium's profile files and sockets open.
    const found = process.platform !== "win32" && existsSync(BASH) ? onPath(bunBinaryPath) : null;
    const [command, args] = found
      ? [BASH, ["-c", CLOSE_INHERITED_THEN_EXEC, "stella-runtime-bytecode", found, script]]
      : [bunBinaryPath, [script]];
    child = spawn(command, args, {
      cwd: stellaRoot,
      detached: process.platform !== "win32",
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env, STELLA_BUN_PATH: bunBinaryPath },
      windowsHide: true,
    });
  } catch (error) {
    running = false;
    getFileLogger()?.process("runtime-bytecode.build-failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  } finally {
    closeSync(logFd);
  }
  child.unref();
  if (child.pid) {
    try {
      setPriority(child.pid, 10);
    } catch {
      // Best effort: build at normal priority.
    }
  }
  const timeout = forkDelayed(BUILD_TIMEOUT_MS, () => {
    child.kill();
  });
  const sourceStamp = computeRuntimeSourceStamp(stellaRoot);
  child.once("exit", (code, signal) => {
    timeout.cancel();
    running = false;
    const after = checkRuntimeBytecode(stellaRoot, bunBinaryPath);
    // A tree this Bun cannot build is not retried until it changes.
    if (code !== 0) failedStamps.add(sourceStamp);
    getFileLogger()?.process(code === 0 ? "runtime-bytecode.built" : "runtime-bytecode.build-failed", {
      code,
      signal,
      ms: Date.now() - startedAt,
      usable: after.usable,
      ...(after.usable ? {} : { reason: after.reason }),
    });
  });
  child.once("error", () => {
    timeout.cancel();
    running = false;
  });
};

/**
 * Ask for a bytecode build of this checkout's worker after a spawn that had
 * to run the source (none yet, or the tree or Bun changed since). Runs once
 * at a time, in the background at low priority; the next spawn uses it.
 */
export const requestRuntimeBytecodeBuild = (args: {
  stellaRoot: string;
  bunBinaryPath: string;
  reason: string;
}): void => {
  if (!enabled() || args.reason === "disabled") return;
  if (pending || running) return;
  pending = { stellaRoot: args.stellaRoot };
  getFileLogger()?.process("runtime-bytecode.build-requested", { reason: args.reason });
  forkDelayed(BUILD_DELAY_MS, () => {
    const request = pending;
    pending = null;
    if (!request || running) return;
    if (failedStamps.has(computeRuntimeSourceStamp(request.stellaRoot))) return;
    runBuild(request.stellaRoot, args.bunBinaryPath);
  });
};
