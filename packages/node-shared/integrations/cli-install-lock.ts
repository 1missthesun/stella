import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExternalCli } from "./external-cli-resolution.js";

/**
 * A first install has the launcher install Claude Code and Google Antigravity
 * in the background (packages/desktop/scripts/install-agent-clis.mjs) while
 * Stella opens. It holds this lock while it installs; Stella's own installers
 * wait on it rather than download the same CLI again beside it.
 */

const LOCK_MAX_AGE_MS = 30 * 60_000;
const POLL_MS = 500;

export const cliInstallLockPath = (cli: ExternalCli): string =>
  path.join(os.tmpdir(), "stella-cli-install", `${cli}.lock`);

export const holdCliInstallLock = (cli: ExternalCli): (() => void) => {
  const file = cliInstallLockPath(cli);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify({ pid: process.pid, startedAt: Date.now() }),
  );
  return () => {
    try {
      const held = JSON.parse(fs.readFileSync(file, "utf8")) as {
        pid?: unknown;
      };
      if (held.pid === process.pid) fs.rmSync(file, { force: true });
    } catch {}
  };
};

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

export const cliInstallInProgress = (cli: ExternalCli): boolean => {
  try {
    const held = JSON.parse(
      fs.readFileSync(cliInstallLockPath(cli), "utf8"),
    ) as {
      pid?: unknown;
      startedAt?: unknown;
    };
    return (
      typeof held.pid === "number" &&
      typeof held.startedAt === "number" &&
      Date.now() - held.startedAt < LOCK_MAX_AGE_MS &&
      alive(held.pid)
    );
  } catch {
    return false;
  }
};

/** Resolves once no launcher install of `cli` is running; true if it waited. */
export const waitForCliInstall = async (
  cli: ExternalCli,
  signal?: AbortSignal,
): Promise<boolean> => {
  if (!cliInstallInProgress(cli)) return false;
  while (cliInstallInProgress(cli) && !signal?.aborted) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  return true;
};
