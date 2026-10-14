import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  captureProcessIdentity,
  pidCommandLine,
  processIdentityIsLive,
  terminateOwnedProcess,
  type ProcessIdentity,
} from "./process-identity.js";

/**
 * Detached helpers a Stella instance spawns, recorded in one per-user
 * directory that every app version, dev worktree and verify run shares, so
 * any instance can reap what a dead one left behind. A record names both the
 * helper and its owner by pid + start time; a helper is reaped only when its
 * owner is gone and the helper is still the very process (and executable)
 * that was recorded, so a live instance's helper is never touched.
 */

export type OwnedProcessKind = "stella-browser-daemon";

type OwnedProcessRecord = Readonly<{
  version: 1;
  kind: OwnedProcessKind;
  pid: number;
  startedAtMs: number | null;
  executable: string;
  commandFragments: readonly string[];
  owner: ProcessIdentity;
  ownerAppDir: string | null;
  recordedAtMs: number;
}>;

const realHomeDir = () => {
  try {
    return os.userInfo().homedir || os.homedir();
  } catch {
    return os.homedir();
  }
};

const uid = () => (typeof process.getuid === "function" ? process.getuid() : 0);

export const ownedProcessRegistryDir = (): string => {
  const override = process.env.STELLA_OWNED_PROCESS_DIR?.trim();
  if (override) return override;
  if (process.platform === "linux") {
    // Runtime dirs are cleared at logout and boot, like the processes.
    const runtimeDir = process.env.XDG_RUNTIME_DIR?.trim();
    return runtimeDir && path.isAbsolute(runtimeDir)
      ? path.join(runtimeDir, "stella", "owned-processes")
      : path.join("/tmp", `stella-owned-processes-${uid()}`);
  }
  if (process.platform === "darwin") {
    return path.join(
      realHomeDir(),
      "Library",
      "Caches",
      "Stella",
      "owned-processes",
    );
  }
  return path.join(
    process.env.LOCALAPPDATA?.trim() || path.join(realHomeDir(), "AppData", "Local"),
    "Stella",
    "owned-processes",
  );
};

const recordPath = (pid: number) =>
  path.join(ownedProcessRegistryDir(), `${pid}.json`);

let ownIdentity: ProcessIdentity | undefined;
const ownerIdentity = () =>
  (ownIdentity ??= captureProcessIdentity(process.pid));

export const registerOwnedProcess = (
  input: Readonly<{
    kind: OwnedProcessKind;
    pid: number | undefined;
    executable: string;
    commandFragments: readonly string[];
    ownerAppDir?: string;
  }>,
): void => {
  if (!input.pid || process.platform === "win32") return;
  const record: OwnedProcessRecord = {
    version: 1,
    kind: input.kind,
    pid: input.pid,
    startedAtMs: captureProcessIdentity(input.pid).startedAtMs,
    executable: input.executable,
    commandFragments: input.commandFragments,
    owner: ownerIdentity(),
    ownerAppDir: input.ownerAppDir ?? null,
    recordedAtMs: Date.now(),
  };
  try {
    mkdirSync(ownedProcessRegistryDir(), { recursive: true, mode: 0o700 });
    const target = recordPath(input.pid);
    const temp = `${target}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify(record), { mode: 0o600 });
    renameSync(temp, target);
  } catch (error) {
    console.warn(
      "[owned-processes] Could not record helper:",
      error instanceof Error ? error.message : error,
    );
  }
};

/** Drops the record when it still names this instance's helper. */
export const forgetOwnedProcess = (pid: number | undefined): void => {
  if (!pid) return;
  const record = readRecord(recordPath(pid));
  if (
    record &&
    record.owner.pid === ownerIdentity().pid &&
    record.owner.startedAtMs === ownerIdentity().startedAtMs
  ) {
    rmSync(recordPath(pid), { force: true });
  }
};

const readRecord = (file: string): OwnedProcessRecord | null => {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as OwnedProcessRecord;
    return parsed?.version === 1 &&
      Number.isInteger(parsed.pid) &&
      parsed.owner &&
      Number.isInteger(parsed.owner.pid) &&
      typeof parsed.executable === "string" &&
      Array.isArray(parsed.commandFragments)
      ? parsed
      : null;
  } catch {
    return null;
  }
};

const stillTheRecordedProcess = (record: OwnedProcessRecord) => {
  if (!processIdentityIsLive({ pid: record.pid, startedAtMs: record.startedAtMs })) {
    return false;
  }
  // A record without a start time can't rule out pid reuse.
  if (record.startedAtMs === null) return false;
  const command = pidCommandLine(record.pid);
  return Boolean(
    command?.includes(record.executable) &&
      record.commandFragments.every((fragment) => command.includes(fragment)),
  );
};

export type OwnedProcessReapResult = Readonly<{
  reaped: number[];
  keptLive: number[];
  dropped: number[];
}>;

/** Stops helpers whose owning instance is gone, across versions and worktrees. */
export const reapOrphanedOwnedProcesses = async (
  graceMs = 2_000,
): Promise<OwnedProcessReapResult> => {
  const reaped: number[] = [];
  const keptLive: number[] = [];
  const dropped: number[] = [];
  if (process.platform === "win32") return { reaped, keptLive, dropped };
  let entries: string[];
  try {
    entries = readdirSync(ownedProcessRegistryDir());
  } catch {
    return { reaped, keptLive, dropped };
  }
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const file = path.join(ownedProcessRegistryDir(), entry);
    const record = readRecord(file);
    if (!record) {
      rmSync(file, { force: true });
      continue;
    }
    if (!stillTheRecordedProcess(record)) {
      rmSync(file, { force: true });
      dropped.push(record.pid);
      continue;
    }
    if (processIdentityIsLive(record.owner)) {
      keptLive.push(record.pid);
      continue;
    }
    const stopped = await terminateOwnedProcess(
      record.pid,
      () => stillTheRecordedProcess(record),
      graceMs,
    );
    if (stopped) {
      reaped.push(record.pid);
      rmSync(file, { force: true });
      console.warn(
        `[owned-processes] Stopped orphaned ${record.kind} ${record.pid} (owner ${record.owner.pid} is gone; app ${record.ownerAppDir ?? "unknown"}).`,
      );
    }
  }
  return { reaped, keptLive, dropped };
};

/** Registered helpers are judged by their record, never by the legacy scan. */
const registeredPids = (): Set<number> => {
  try {
    return new Set(
      readdirSync(ownedProcessRegistryDir())
        .filter((entry) => entry.endsWith(".json"))
        .map((entry) => Number.parseInt(entry, 10))
        .filter((pid) => Number.isInteger(pid) && pid > 0),
    );
  } catch {
    return new Set();
  }
};

/**
 * Browser daemons from builds older than the registry: Electron spawns the
 * bridge and agent sessions directly, so one whose parent is no longer an
 * Electron process lost its owner. Matches any version's binary path.
 */
const LEGACY_DAEMON_PATTERN =
  /(?:^|\s)(\S*\/stella-browser(?:-[a-z0-9-]+)?)\s+service\s+run\s+--session\s+(stella-app-bridge|agent-[0-9a-f]{32})(?:\s|$)/;

export const findLegacyOrphanedBrowserDaemons = (): Array<
  Readonly<{ pid: number; executable: string; session: string }>
> => {
  if (process.platform === "win32") return [];
  let output: string;
  try {
    output = execFileSync("ps", ["-axo", "pid=,ppid=,command="], {
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 3_000,
    });
  } catch {
    return [];
  }
  const rows = output
    .split("\n")
    .map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      command: match[3]!,
    }));
  const commandByPid = new Map(rows.map((row) => [row.pid, row.command]));
  const registered = registeredPids();
  const found: Array<{ pid: number; executable: string; session: string }> = [];
  for (const row of rows) {
    if (row.pid === process.pid || registered.has(row.pid)) continue;
    const match = LEGACY_DAEMON_PATTERN.exec(row.command);
    if (!match) continue;
    const parentCommand = row.ppid > 1 ? commandByPid.get(row.ppid) : undefined;
    if (parentCommand && /electron/i.test(parentCommand)) continue;
    found.push({ pid: row.pid, executable: match[1]!, session: match[2]! });
  }
  return found;
};

export const reapLegacyOrphanedBrowserDaemons = async (
  graceMs = 2_000,
): Promise<number[]> => {
  const reaped: number[] = [];
  for (const daemon of findLegacyOrphanedBrowserDaemons()) {
    const identity = captureProcessIdentity(daemon.pid);
    const stillOrphaned = () =>
      processIdentityIsLive(identity) &&
      findLegacyOrphanedBrowserDaemons().some(
        (candidate) => candidate.pid === daemon.pid,
      );
    if (await terminateOwnedProcess(daemon.pid, stillOrphaned, graceMs)) {
      reaped.push(daemon.pid);
      console.warn(
        `[owned-processes] Stopped orphaned browser daemon ${daemon.pid} (${daemon.session}, ${daemon.executable}).`,
      );
    }
  }
  return reaped;
};
