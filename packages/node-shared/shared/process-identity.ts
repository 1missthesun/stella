import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const readProcessIdentity = (pid: number): string | null => {
  try {
    if (process.platform === "linux") {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      return fields[19] ?? null;
    }
    if (process.platform === "win32") return null;
    const started = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 2_000,
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, LC_ALL: "C" },
    }).trim();
    return started || null;
  } catch {
    return null;
  }
};

export const readProcessCommand = (pid: number): string | null => {
  try {
    if (process.platform === "linux") {
      const raw = readFileSync(`/proc/${pid}/cmdline`, "utf8");
      const command = raw.split("\0").filter(Boolean).join(" ");
      return command || null;
    }
    if (process.platform === "win32") return null;
    const command = execFileSync("ps", ["-ww", "-o", "command=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 2_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return command || null;
  } catch {
    return null;
  }
};

export const readProcessGroup = (pid: number): number | null => {
  try {
    if (process.platform === "linux") {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      const pgid = Number(fields[2]);
      return Number.isInteger(pgid) ? pgid : null;
    }
    if (process.platform === "win32") return null;
    const pgid = Number(
      execFileSync("ps", ["-o", "pgid=", "-p", String(pid)], {
        encoding: "utf8",
        timeout: 2_000,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim(),
    );
    return Number.isInteger(pgid) && pgid > 0 ? pgid : null;
  } catch {
    return null;
  }
};

export const readProcessParent = (pid: number): number | null => {
  try {
    if (process.platform === "linux") {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
      return Number.isInteger(ppid) ? ppid : null;
    }
    if (process.platform === "win32") return null;
    const ppid = Number(
      execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], {
        encoding: "utf8",
        timeout: 2_000,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim(),
    );
    return Number.isInteger(ppid) && ppid > 0 ? ppid : null;
  } catch {
    return null;
  }
};

export const isOwnUnreapedChild = (pid: number): boolean =>
  pidIsAlive(pid) && readProcessParent(pid) === process.pid;

export const processEnvironmentHas = (pid: number, entry: string): boolean => {
  if (process.platform !== "linux") return false;
  try {
    const environ = readFileSync(`/proc/${pid}/environ`);
    const needle = Buffer.from(`\0${entry}\0`);
    return environ.subarray(0, needle.length - 1).equals(needle.subarray(1)) || environ.includes(needle);
  } catch {
    return false;
  }
};

export const pidIsAlive = (pid: number): boolean => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === "EPERM";
  }
};

export const processIdentityIsLive = (
  pid: number,
  identity: string | null,
): boolean => {
  if (!pidIsAlive(pid)) return false;
  if (identity === null) return true;
  const current = readProcessIdentity(pid);
  return current === null || current === identity;
};

export type RecordedProcess = {
  pid: number;
  identity: string | null;
  commandIncludes?: readonly string[];
};

export type SignalOutcome = "sent" | "gone" | "mismatch" | "unverifiable" | "failed";

const KILL_LOG_ENV = "STELLA_PROCESS_KILL_LOG";
const KILL_LOG_MAX_BYTES = 4 * 1024 * 1024;
const COMMAND_LOG_CHARS = 400;

export const processKillLogPath = (): string =>
  process.env[KILL_LOG_ENV]?.trim() ||
  path.join(process.env.STELLA_DATA_DIR?.trim() || path.join(os.homedir(), ".stella"), "logs", "process-kills.log");

const clip = (text: string | null | undefined) =>
  text ? (text.length > COMMAND_LOG_CHARS ? `${text.slice(0, COMMAND_LOG_CHARS)}…` : text) : null;

const senderCommand = () => clip(process.argv.join(" "));

export const logProcessSignal = (entry: {
  pid: number;
  signal: NodeJS.Signals | number;
  group?: boolean;
  reason: string;
  outcome: SignalOutcome;
  command?: string | null;
  identity?: string | null;
  detail?: string;
}): void => {
  try {
    const file = processKillLogPath();
    mkdirSync(path.dirname(file), { recursive: true });
    try {
      if (statSync(file).size > KILL_LOG_MAX_BYTES) renameSync(file, `${file}.1`);
    } catch {}
    const line = {
      at: new Date().toISOString(),
      outcome: entry.outcome,
      signal: entry.signal,
      target: entry.group ? -entry.pid : entry.pid,
      command: clip(entry.command ?? null),
      identity: entry.identity ?? null,
      reason: entry.reason,
      ...(entry.detail ? { detail: entry.detail } : {}),
      sender: {
        pid: process.pid,
        command: senderCommand(),
        task: process.env.STELLA_TASK_PROCESS_OWNER || undefined,
      },
    };
    appendFileSync(file, `${JSON.stringify(line)}\n`, { mode: 0o600 });
  } catch {}
};

export const signalRecordedProcess = (
  recorded: RecordedProcess,
  signal: NodeJS.Signals,
  options: { reason: string; group?: boolean },
): SignalOutcome => {
  const { pid } = recorded;
  if (!Number.isInteger(pid) || pid <= 1 || pid === process.pid) return "failed";
  if (!pidIsAlive(pid)) return "gone";
  const group = Boolean(options.group) && process.platform !== "win32";
  const log = (outcome: SignalOutcome, command: string | null, identity: string | null, detail?: string) =>
    logProcessSignal({ pid, signal, group, reason: options.reason, outcome, command, identity, ...(detail ? { detail } : {}) });

  if (process.platform === "win32") {
    try {
      process.kill(pid, signal);
      log("sent", null, null);
      return "sent";
    } catch (error) {
      log("failed", null, null, (error as Error)?.message);
      return "failed";
    }
  }

  const identity = readProcessIdentity(pid);
  const command = readProcessCommand(pid);
  if (identity === null) {
    if (!pidIsAlive(pid)) return "gone";
    log("unverifiable", command, identity, "start time unreadable");
    return "unverifiable";
  }
  const tags = recorded.commandIncludes ?? [];
  if (recorded.identity === null && tags.length === 0) {
    log("unverifiable", command, identity, "recorded without a start time or a command tag");
    return "unverifiable";
  }
  if (recorded.identity !== null && identity !== recorded.identity) {
    log("mismatch", command, identity, `recorded start ${recorded.identity}`);
    return "mismatch";
  }
  const missing = tags.filter((part) => !command?.includes(part));
  if (missing.length > 0) {
    log("mismatch", command, identity, `command lacks ${missing.join(", ")}`);
    return "mismatch";
  }
  if (group && readProcessGroup(pid) !== pid) {
    log("mismatch", command, identity, "no longer leads its process group");
    return "mismatch";
  }
  try {
    process.kill(group ? -pid : pid, signal);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ESRCH") return "gone";
    log("failed", command, identity, code ?? (error as Error)?.message);
    return "failed";
  }
  if (!QUIET_SIGNALS.has(signal)) log("sent", command, identity);
  return "sent";
};

const QUIET_SIGNALS = new Set<NodeJS.Signals>(["SIGSTOP", "SIGCONT", "SIGWINCH"]);

export const recordedProcessIsLive = (recorded: RecordedProcess): boolean => {
  if (!pidIsAlive(recorded.pid)) return false;
  if (process.platform === "win32") return true;
  const tags = recorded.commandIncludes ?? [];
  if (recorded.identity === null && tags.length === 0) return false;
  if (recorded.identity !== null && readProcessIdentity(recorded.pid) !== recorded.identity) return false;
  if (tags.length === 0) return true;
  const command = readProcessCommand(recorded.pid);
  return Boolean(command) && tags.every((part) => command!.includes(part));
};

export const signalOwnChild = (
  pid: number | null | undefined,
  signal: NodeJS.Signals,
  options: { reason: string; group?: boolean },
): SignalOutcome => {
  if (!pid || !Number.isInteger(pid) || pid <= 1 || pid === process.pid) return "failed";
  if (!pidIsAlive(pid)) return "gone";
  const command = readProcessCommand(pid);
  if (process.platform !== "win32" && readProcessParent(pid) !== process.pid) {
    logProcessSignal({ pid, signal, reason: options.reason, outcome: "mismatch", command, detail: "no longer our child" });
    return "mismatch";
  }
  const group = Boolean(options.group) && process.platform !== "win32" && readProcessGroup(pid) === pid;
  try {
    process.kill(group ? -pid : pid, signal);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ESRCH") return "gone";
    logProcessSignal({ pid, signal, group, reason: options.reason, outcome: "failed", command, detail: code });
    return "failed";
  }
  if (!QUIET_SIGNALS.has(signal)) {
    logProcessSignal({ pid, signal, group, reason: options.reason, outcome: "sent", command });
  }
  return "sent";
};

export const recordProcess = (
  pid: number,
  commandIncludes?: readonly string[],
): RecordedProcess => ({
  pid,
  identity: readProcessIdentity(pid),
  ...(commandIncludes && commandIncludes.length > 0 ? { commandIncludes } : {}),
});
