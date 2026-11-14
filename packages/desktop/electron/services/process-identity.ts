import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  logProcessSignal,
  readProcessCommand,
  readProcessIdentity,
  type SignalOutcome,
} from "@stella/runtime/kernel/shared/process-identity";

export type ProcessIdentity = Readonly<{
  pid: number;
  startedAtMs: number | null;
}>;

/** /proc reports start times in USER_HZ, which Linux fixes at 100. */
const LINUX_USER_HZ = 100;
/** `ps -o lstart` has one-second resolution. */
const START_TIME_TOLERANCE_MS = 1_500;

let linuxBootTimeMs: number | null | undefined;

const readLinuxBootTimeMs = (): number | null => {
  if (linuxBootTimeMs !== undefined) return linuxBootTimeMs;
  try {
    const line = readFileSync("/proc/stat", "utf8")
      .split("\n")
      .find((entry) => entry.startsWith("btime "));
    const seconds = Number(line?.slice("btime ".length).trim());
    linuxBootTimeMs = Number.isFinite(seconds) ? seconds * 1000 : null;
  } catch {
    linuxBootTimeMs = null;
  }
  return linuxBootTimeMs;
};

const validPid = (pid: number | null | undefined): pid is number =>
  typeof pid === "number" && Number.isInteger(pid) && pid > 0;

export const pidIsAlive = (pid: number | null | undefined): boolean => {
  if (!validPid(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
};

export const processStartedAtMs = (pid: number): number | null => {
  if (!validPid(pid)) return null;
  try {
    if (process.platform === "linux") {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      const ticks = Number(fields[19]);
      const bootMs = readLinuxBootTimeMs();
      return Number.isFinite(ticks) && bootMs !== null
        ? bootMs + (ticks * 1000) / LINUX_USER_HZ
        : null;
    }
    if (process.platform === "darwin") {
      const output = execFileSync("ps", ["-p", String(pid), "-o", "lstart="], {
        encoding: "utf8",
        env: { ...process.env, LC_ALL: "C" },
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 2_000,
      }).trim();
      const parsed = Date.parse(output);
      return Number.isFinite(parsed) ? parsed : null;
    }
  } catch {
    return null;
  }
  return null;
};

export const captureProcessIdentity = (pid: number): ProcessIdentity => ({
  pid,
  startedAtMs: processStartedAtMs(pid),
});

export const processIdentityIsLive = (
  identity: ProcessIdentity | null | undefined,
): boolean => {
  if (!identity || !pidIsAlive(identity.pid)) return false;
  if (identity.startedAtMs === null) return true;
  const current = processStartedAtMs(identity.pid);
  if (current === null) return process.platform === "win32";
  return Math.abs(current - identity.startedAtMs) <= START_TIME_TOLERANCE_MS;
};

export const pidCommandLine = (pid: number): string | null => {
  if (!validPid(pid) || process.platform === "win32") return null;
  try {
    return (
      execFileSync("ps", ["-p", String(pid), "-o", "command="], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 2_000,
      }).trim() || null
    );
  } catch {
    return null;
  }
};

/** Windows compares only the image name: its command line needs a WMI query costing hundreds of ms. */
export const pidRunsExecutable = (
  pid: number,
  executablePath: string,
  commandFragments: readonly string[] = [],
): boolean => {
  if (!validPid(pid) || !executablePath) return false;
  const baseName = path.basename(executablePath);
  if (!baseName) return false;
  if (process.platform === "win32") {
    try {
      const output = execFileSync(
        "tasklist.exe",
        ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"],
        { encoding: "utf8", windowsHide: true, timeout: 2_000 },
      );
      const row = output.split(/\r?\n/).find((line) => line.startsWith('"'));
      const imageName = row ? /^"([^"]*)"/.exec(row)?.[1] : undefined;
      const stem = (name: string) => name.replace(/\.[^.]+$/, "").toLowerCase();
      return Boolean(imageName && stem(imageName) === stem(baseName));
    } catch {
      return false;
    }
  }
  const command = pidCommandLine(pid);
  return Boolean(
    command?.includes(executablePath) &&
      commandFragments.every((fragment) => command.includes(fragment)),
  );
};

const delay = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Stops a process this app recorded, re-checking `stillOwned` before each
 * signal and the start time before the SIGKILL so a PID reused during the
 * grace period is left alone. Every signal is logged to the kill log.
 */
export const terminateOwnedProcess = async (
  pid: number,
  stillOwned: () => boolean,
  graceMs: number,
  reason: string,
): Promise<boolean> => {
  if (!pidIsAlive(pid)) return true;
  const identity = readProcessIdentity(pid);
  const command = readProcessCommand(pid);
  const log = (signal: NodeJS.Signals, outcome: SignalOutcome, detail?: string) =>
    logProcessSignal({ pid, signal, reason, outcome, command, identity, detail });
  if (!stillOwned()) {
    log("SIGTERM", "mismatch", "ownership check failed");
    return false;
  }
  try {
    process.kill(pid, "SIGTERM");
    log("SIGTERM", "sent");
  } catch (error) {
    log("SIGTERM", pidIsAlive(pid) ? "failed" : "gone", String(error));
    return !pidIsAlive(pid);
  }
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!pidIsAlive(pid)) return true;
    await delay(25);
  }
  if (!pidIsAlive(pid)) return true;
  if (identity !== null && readProcessIdentity(pid) !== identity) return true;
  if (!stillOwned()) {
    log("SIGKILL", "mismatch", "ownership check failed after SIGTERM");
    return false;
  }
  try {
    process.kill(pid, "SIGKILL");
    log("SIGKILL", "sent");
  } catch (error) {
    log("SIGKILL", pidIsAlive(pid) ? "failed" : "gone", String(error));
  }
  return !pidIsAlive(pid);
};
