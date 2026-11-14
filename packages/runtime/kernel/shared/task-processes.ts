/**
 * The processes a task (an agent thread) started, and ending them when it is
 * stopped.
 *
 * Ownership is recorded two ways, both inherited by everything a task's
 * shells and tools start:
 *
 * - `STELLA_TASK_PROCESS_OWNER` in the environment. Linux exposes every
 *   same-user process's environment in /proc; macOS exposes it except for
 *   Apple platform binaries (/bin/bash, /bin/sleep, …). Windows exposes none.
 * - A ledger of the process groups the task's shells and Claude Code lead,
 *   one `<pgid>` file per group (mtime: when it started) beside a
 *   `<pgid>.end` file (mtime: when its leader ended). Each shell writes its
 *   own entry through `BASH_ENV` / `CLAUDE_ENV_FILE`; Stella writes the CLI's.
 *   A child left behind by `nohup … &` stays in its shell's group after the
 *   shell exits, so the ledger finds it even when its environment is hidden.
 *
 * A group is only taken while it provably is the one recorded: its leader
 * is alive and started no later than the entry, or the leader is gone and a
 * member is older than the leader's end. A group id is reused only after the
 * group emptied, so either proves it never did.
 */

import { execFile } from "node:child_process";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { readProcessIdentity, type RecordedProcess, signalRecordedProcess } from "./process-identity.js";

export const TASK_PROCESS_OWNER_ENV = "STELLA_TASK_PROCESS_OWNER";
export const TASK_PROCESS_LEDGER_ENV = "STELLA_TASK_PROCESS_LEDGER";
const USER_BASH_ENV = "STELLA_USER_BASH_ENV";
const USER_CLAUDE_ENV_FILE = "STELLA_USER_CLAUDE_ENV_FILE";

const LEDGER_DIRECTORY = "task-processes";
const BASH_HOOK_FILE = "bash-env.sh";
const CLAUDE_HOOK_FILE = "claude-env.sh";
const END_SUFFIX = ".end";
const TIME_SLACK_MS = 1_000;
const GRACE_MS = 1_500;
const KILL_CONFIRM_MS = 1_000;
const POLL_MS = 50;
const LIST_TIMEOUT_MS = 4_000;
/** A stopped task resumes with the environment it had, so its empty ledger stays a while. */
const EMPTY_LEDGER_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

const ownerName = (owner: string) => owner.replace(/[^A-Za-z0-9_.-]/g, "_");

export const taskProcessLedgerDir = (stellaDataDir: string, owner: string) =>
  path.join(path.resolve(stellaDataDir), LEDGER_DIRECTORY, ownerName(owner));

// Redirections apply left to right, so `2>/dev/null` comes first to keep a
// failed write quiet. The folder is made again when a prune removed it.
const RECORD_GROUP = `if [ -n "$${TASK_PROCESS_LEDGER_ENV}" ]; then
  [ -d "$${TASK_PROCESS_LEDGER_ENV}" ] || mkdir -p "$${TASK_PROCESS_LEDGER_ENV}" 2>/dev/null
  if true 2>/dev/null >|"$${TASK_PROCESS_LEDGER_ENV}/$$"; then
    true 2>/dev/null >|"$${TASK_PROCESS_LEDGER_ENV}/$$${END_SUFFIX}"
    trap 'true 2>/dev/null >|"$${TASK_PROCESS_LEDGER_ENV}/'"$$"'${END_SUFFIX}"' EXIT
  fi
fi
`;

const BASH_HOOK = `if [ -n "$${USER_BASH_ENV}" ]; then BASH_ENV="$${USER_BASH_ENV}"; else unset BASH_ENV; fi
${RECORD_GROUP}if [ -n "$BASH_ENV" ] && [ -r "$BASH_ENV" ]; then . "$BASH_ENV"; fi
`;

const CLAUDE_HOOK = `${RECORD_GROUP}if [ -n "$${USER_CLAUDE_ENV_FILE}" ] && [ -r "$${USER_CLAUDE_ENV_FILE}" ]; then . "$${USER_CLAUDE_ENV_FILE}"; fi
`;

const writeHook = (stellaDataDir: string, name: string, contents: string) => {
  const file = path.join(path.resolve(stellaDataDir), LEDGER_DIRECTORY, name);
  let current: string | undefined;
  try {
    current = readFileSync(file, "utf8");
  } catch {
    current = undefined;
  }
  if (current !== contents) {
    mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    writeFileSync(temp, contents, { mode: 0o644 });
    renameSync(temp, file);
  }
  return file;
};

/**
 * The environment a task's shells and Claude Code run with: the owner
 * marker, its ledger, and the hooks bash (`BASH_ENV`) and Claude Code's Bash
 * tool (`CLAUDE_ENV_FILE`) run first in each shell. The user's own hooks of
 * those names still run, from the same shell.
 */
export const taskProcessEnvironment = (
  stellaDataDir: string,
  owner: string,
  inherited: NodeJS.ProcessEnv = process.env,
): Record<string, string> => {
  const name = ownerName(owner);
  const env: Record<string, string> = { [TASK_PROCESS_OWNER_ENV]: name };
  if (process.platform === "win32") return env;
  try {
    const ledger = taskProcessLedgerDir(stellaDataDir, owner);
    mkdirSync(ledger, { recursive: true });
    const bashHook = writeHook(stellaDataDir, BASH_HOOK_FILE, BASH_HOOK);
    const claudeHook = writeHook(stellaDataDir, CLAUDE_HOOK_FILE, CLAUDE_HOOK);
    env[TASK_PROCESS_LEDGER_ENV] = ledger;
    env.BASH_ENV = bashHook;
    env.CLAUDE_ENV_FILE = claudeHook;
    const userBashEnv = inherited[USER_BASH_ENV] ?? inherited.BASH_ENV;
    if (userBashEnv && userBashEnv !== bashHook) env[USER_BASH_ENV] = userBashEnv;
    const userClaudeEnv = inherited[USER_CLAUDE_ENV_FILE] ?? inherited.CLAUDE_ENV_FILE;
    if (userClaudeEnv && userClaudeEnv !== claudeHook) env[USER_CLAUDE_ENV_FILE] = userClaudeEnv;
  } catch {
    // Without a ledger the owner marker alone still applies.
  }
  return env;
};

/** For Stella's own long-lived helpers started from a task's shell: they are not the task's. */
export const withoutTaskProcessOwnership = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  if (env[TASK_PROCESS_OWNER_ENV] === undefined && env[TASK_PROCESS_LEDGER_ENV] === undefined) return env;
  const next: NodeJS.ProcessEnv = { ...env };
  delete next[TASK_PROCESS_OWNER_ENV];
  delete next[TASK_PROCESS_LEDGER_ENV];
  if (next[USER_BASH_ENV]) next.BASH_ENV = next[USER_BASH_ENV];
  else delete next.BASH_ENV;
  if (next[USER_CLAUDE_ENV_FILE]) next.CLAUDE_ENV_FILE = next[USER_CLAUDE_ENV_FILE];
  else delete next.CLAUDE_ENV_FILE;
  delete next[USER_BASH_ENV];
  delete next[USER_CLAUDE_ENV_FILE];
  return next;
};

/**
 * Record a process Stella spawned for a task (the leader of its own group
 * outside Windows) in the task's ledger. Call the returned function when it
 * exits.
 */
export const recordTaskProcess = (
  env: NodeJS.ProcessEnv,
  pid: number | undefined,
  stellaDataDir?: string,
): (() => void) => {
  const owner = env[TASK_PROCESS_OWNER_ENV];
  const ledger =
    env[TASK_PROCESS_LEDGER_ENV] ?? (owner && stellaDataDir ? taskProcessLedgerDir(stellaDataDir, owner) : undefined);
  if (!ledger || !pid || pid <= 0) return () => undefined;
  const touch = (name: string) => {
    try {
      writeFileSync(path.join(ledger, name), "");
    } catch {
      // A missing entry only narrows what a stop can find.
    }
  };
  try {
    mkdirSync(ledger, { recursive: true });
  } catch {
    return () => undefined;
  }
  touch(String(pid));
  touch(`${pid}${END_SUFFIX}`);
  return () => touch(`${pid}${END_SUFFIX}`);
};

type ProcessRow = { pid: number; ppid: number; pgid: number; startedMs: number };
type GroupEntry = { pgid: number; startedMs: number; endedMs: number };

const run = (file: string, args: string[]): Promise<string | null> =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      {
        timeout: LIST_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 256 * 1024 * 1024,
        env: { ...process.env, LC_ALL: "C", LANG: "C" },
      },
      (error, stdout) => resolve(error ? null : String(stdout ?? "")),
    );
  });

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `ps -o lstart` in the C locale: "Thu Nov 12 23:42:23 2026", local time. */
const parseLstart = (text: string): number => {
  const match = /^\w{3}\s+(\w{3})\s+(\d{1,2})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(\d{4})$/.exec(text.trim());
  if (!match) return Number.NaN;
  const month = MONTHS.indexOf(match[1]!);
  if (month < 0) return Number.NaN;
  return new Date(
    Number(match[6]),
    month,
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  ).getTime();
};

const listPosix = async (): Promise<ProcessRow[] | null> => {
  const stdout = await run("ps", ["-A", "-o", "pid=", "-o", "ppid=", "-o", "pgid=", "-o", "lstart="]);
  if (stdout === null) return null;
  const rows: ProcessRow[] = [];
  for (const line of stdout.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/.exec(line);
    if (!match) continue;
    rows.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      pgid: Number(match[3]),
      startedMs: parseLstart(match[4]!),
    });
  }
  return rows;
};

const listWindows = async (): Promise<ProcessRow[] | null> => {
  const stdout = await run("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId) $($_.ParentProcessId) $([DateTimeOffset]::new($_.CreationDate).ToUnixTimeMilliseconds())\" }",
  ]);
  if (stdout === null) return null;
  const rows: ProcessRow[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s*$/.exec(line);
    if (!match) continue;
    rows.push({ pid: Number(match[1]), ppid: Number(match[2]), pgid: 0, startedMs: Number(match[3]) });
  }
  return rows;
};

const markerToken = (owner: string) => `${TASK_PROCESS_OWNER_ENV}=${ownerName(owner)}`;

/** Pids whose environment names this owner. */
const markedPids = async (owner: string, rows: readonly ProcessRow[]): Promise<Set<number>> => {
  const token = markerToken(owner);
  const marked = new Set<number>();
  if (process.platform === "linux") {
    const needle = Buffer.from(`\0${token}\0`);
    for (const row of rows) {
      try {
        const environ = readFileSync(`/proc/${row.pid}/environ`);
        if (environ.subarray(0, needle.length - 1).equals(needle.subarray(1)) || environ.includes(needle)) {
          marked.add(row.pid);
        }
      } catch {
        // Gone, or not readable by this user.
      }
    }
    return marked;
  }
  if (process.platform !== "darwin") return marked;
  const [withEnv, plain] = await Promise.all([
    run("ps", ["-E", "-ww", "-A", "-o", "pid=", "-o", "command="]),
    run("ps", ["-ww", "-A", "-o", "pid=", "-o", "command="]),
  ]);
  if (withEnv === null || plain === null) return marked;
  const commands = new Map<number, string>();
  for (const line of plain.split("\n")) {
    const match = /^\s*(\d+) (.*)$/.exec(line);
    if (match) commands.set(Number(match[1]), match[2]!);
  }
  for (const line of withEnv.split("\n")) {
    const match = /^\s*(\d+) (.*)$/.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    const command = commands.get(pid);
    const full = match[2]!;
    if (command === undefined || !full.startsWith(command)) continue;
    const environment = ` ${full.slice(command.length)} `;
    if (environment.includes(` ${token} `)) marked.add(pid);
  }
  return marked;
};

const readLedger = (ledger: string): GroupEntry[] => {
  let names: string[];
  try {
    names = readdirSync(ledger);
  } catch {
    return [];
  }
  const entries: GroupEntry[] = [];
  for (const name of names) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const startedMs = statSync(path.join(ledger, name)).mtimeMs;
      let endedMs = startedMs;
      try {
        endedMs = Math.max(startedMs, statSync(path.join(ledger, `${name}${END_SUFFIX}`)).mtimeMs);
      } catch {
        // Never recorded an end: only its start bounds it.
      }
      entries.push({ pgid: Number(name), startedMs, endedMs });
    } catch {
      // Removed meanwhile.
    }
  }
  return entries;
};

const forgetEntry = (ledger: string, pgid: number) => {
  rmSync(path.join(ledger, String(pgid)), { force: true });
  rmSync(path.join(ledger, `${pgid}${END_SUFFIX}`), { force: true });
};

/** Whether the group now under this id is the one the entry recorded. */
const entryHolds = (entry: GroupEntry, rows: readonly ProcessRow[], groupKeyed: boolean): ProcessRow[] => {
  const leader = rows.find((row) => row.pid === entry.pgid);
  if (leader && Number.isFinite(leader.startedMs)) {
    return leader.startedMs <= entry.startedMs + TIME_SLACK_MS ? [leader] : [];
  }
  if (!groupKeyed) return [];
  const members = rows.filter((row) => row.pgid === entry.pgid);
  const continuous = members.some(
    (row) => Number.isFinite(row.startedMs) && row.startedMs <= entry.endedMs + TIME_SLACK_MS,
  );
  return continuous ? members : [];
};

const protectedPids = (rows: readonly ProcessRow[]) => {
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const kept = new Set<number>([0, 1, process.pid]);
  let current = byPid.get(process.pid);
  while (current && !kept.has(current.ppid)) {
    kept.add(current.ppid);
    current = byPid.get(current.ppid);
  }
  return kept;
};

const descendantsOf = (rows: readonly ProcessRow[], roots: Iterable<number>) => {
  const children = new Map<number, ProcessRow[]>();
  for (const row of rows) {
    if (row.pid === row.ppid) continue;
    const list = children.get(row.ppid);
    if (list) list.push(row);
    else children.set(row.ppid, [row]);
  }
  const byPid = new Map(rows.map((row) => [row.pid, row]));
  const found = new Set<number>();
  const queue = [...roots];
  while (queue.length > 0) {
    const parent = queue.shift()!;
    const parentStarted = byPid.get(parent)?.startedMs ?? Number.NaN;
    for (const child of children.get(parent) ?? []) {
      if (found.has(child.pid)) continue;
      if (Number.isFinite(parentStarted) && Number.isFinite(child.startedMs) && child.startedMs + TIME_SLACK_MS < parentStarted) {
        continue;
      }
      found.add(child.pid);
      queue.push(child.pid);
    }
  }
  return found;
};

/**
 * What a stop will signal, each with the start time it had when found: a
 * signal goes only to that same process, never to a pid handed on since.
 * A group is signalled as a group only while its leader is that same
 * leader; otherwise its members are signalled one by one.
 */
type Targets = { pids: Map<number, string | null>; groups: Map<number, string | null> };

const collectPosix = async (owner: string, ledger: string | undefined): Promise<Targets | null> => {
  const rows = await listPosix();
  if (!rows) return null;
  const kept = protectedPids(rows);
  const ownGroup = rows.find((row) => row.pid === process.pid)?.pgid;
  const pids = new Map<number, string | null>();
  const groups = new Map<number, string | null>();
  const addPid = (pid: number) => {
    if (!pids.has(pid)) pids.set(pid, readProcessIdentity(pid));
  };
  const addGroup = (pgid: number) => {
    if (pgid <= 1 || pgid === ownGroup || kept.has(pgid) || groups.has(pgid)) return;
    groups.set(pgid, rows.some((row) => row.pid === pgid) ? readProcessIdentity(pgid) : null);
  };
  for (const pid of await markedPids(owner, rows)) {
    if (kept.has(pid)) continue;
    addPid(pid);
    const row = rows.find((candidate) => candidate.pid === pid);
    if (row) addGroup(row.pgid);
  }
  if (ledger) {
    for (const entry of readLedger(ledger)) {
      const holds = entryHolds(entry, rows, true);
      if (holds.length === 0) {
        if (!rows.some((row) => row.pgid === entry.pgid || row.pid === entry.pgid)) forgetEntry(ledger, entry.pgid);
        continue;
      }
      addGroup(entry.pgid);
    }
  }
  for (const row of rows) {
    if (groups.has(row.pgid) && !kept.has(row.pid)) addPid(row.pid);
  }
  for (const pid of descendantsOf(rows, pids.keys())) {
    if (!kept.has(pid)) addPid(pid);
  }
  return { pids, groups };
};


const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === "EPERM";
  }
};

const groupAlive = (pgid: number) => {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch {
    return false;
  }
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const waitGone = async (targets: Targets, ms: number) => {
  const deadline = Date.now() + ms;
  for (;;) {
    const remaining =
      [...targets.pids].some(([pid, identity]) => alive(pid) && readProcessIdentity(pid) === identity) ||
      [...targets.groups.keys()].some(groupAlive);
    if (!remaining) return true;
    if (Date.now() >= deadline) return false;
    await sleep(POLL_MS);
  }
};

const merge = (into: Targets, from: Targets | null) => {
  if (!from) return;
  for (const [pid, identity] of from.pids) if (!into.pids.has(pid)) into.pids.set(pid, identity);
  for (const [pgid, identity] of from.groups) if (!into.groups.has(pgid)) into.groups.set(pgid, identity);
};

const endPosix = async (owner: string, ledger: string | undefined): Promise<number> => {
  const targets = await collectPosix(owner, ledger);
  if (!targets || (targets.pids.size === 0 && targets.groups.size === 0)) return 0;
  const reason = `stopping task ${owner}: a process it started`;
  const all = (name: NodeJS.Signals) => {
    for (const [pgid, identity] of targets.groups) {
      if (identity === null) continue;
      const leader: RecordedProcess = { pid: pgid, identity };
      signalRecordedProcess(leader, name, { reason, group: true });
    }
    for (const [pid, identity] of targets.pids) {
      signalRecordedProcess({ pid, identity }, name, { reason });
    }
  };
  // Frozen first, so nothing forks (and escapes with setsid) between the
  // snapshot and the signal; a second snapshot takes what forked before.
  all("SIGSTOP");
  merge(targets, await collectPosix(owner, ledger));
  all("SIGSTOP");
  all("SIGTERM");
  all("SIGCONT");
  if (!(await waitGone(targets, GRACE_MS))) {
    merge(targets, await collectPosix(owner, ledger));
    all("SIGKILL");
    await waitGone(targets, KILL_CONFIRM_MS);
  }
  if (ledger) {
    for (const pgid of targets.groups.keys()) if (!groupAlive(pgid)) forgetEntry(ledger, pgid);
  }
  return targets.pids.size;
};

const endWindows = async (ledger: string | undefined): Promise<number> => {
  if (!ledger) return 0;
  const rows = await listWindows();
  if (!rows) return 0;
  const kept = protectedPids(rows);
  const roots = new Set<number>();
  const orphans = new Set<number>();
  for (const entry of readLedger(ledger)) {
    const leader = entryHolds(entry, rows, false);
    if (leader.length > 0) {
      roots.add(entry.pgid);
      continue;
    }
    if (rows.some((row) => row.pid === entry.pgid)) continue;
    for (const row of rows) {
      if (row.ppid === entry.pgid && row.startedMs >= entry.startedMs - TIME_SLACK_MS && row.startedMs <= entry.endedMs + TIME_SLACK_MS) {
        orphans.add(row.pid);
      }
    }
    if (!rows.some((row) => row.ppid === entry.pgid)) forgetEntry(ledger, entry.pgid);
  }
  const targets = new Set<number>([...roots, ...orphans, ...descendantsOf(rows, [...roots, ...orphans])]);
  for (const pid of kept) targets.delete(pid);
  await Promise.all(
    [...targets].map((pid) => run("taskkill", ["/F", "/PID", String(pid)])),
  );
  return targets.size;
};

/**
 * End every process the task `owner` started that is still running, never
 * this process or its ancestors. Resolves with how many were signalled.
 */
export const endTaskProcesses = async (args: { owner: string; stellaDataDir?: string }): Promise<number> => {
  const ledger = args.stellaDataDir ? taskProcessLedgerDir(args.stellaDataDir, args.owner) : undefined;
  try {
    return process.platform === "win32" ? await endWindows(ledger) : await endPosix(args.owner, ledger);
  } catch {
    return 0;
  }
};

/** Drop ledger entries of groups that have ended, and ledgers left empty. */
export const pruneTaskProcessLedgers = async (stellaDataDir: string): Promise<void> => {
  const root = path.join(path.resolve(stellaDataDir), LEDGER_DIRECTORY);
  let owners: string[];
  try {
    owners = readdirSync(root).filter((name) => name !== BASH_HOOK_FILE && name !== CLAUDE_HOOK_FILE && !name.endsWith(".tmp"));
  } catch {
    return;
  }
  const rows = process.platform === "win32" ? await listWindows() : await listPosix();
  if (!rows) return;
  const live = new Set<number>();
  for (const row of rows) {
    live.add(row.pid);
    live.add(row.pgid);
    live.add(row.ppid);
  }
  for (const owner of owners) {
    const ledger = path.join(root, owner);
    for (const entry of readLedger(ledger)) {
      if (!live.has(entry.pgid)) forgetEntry(ledger, entry.pgid);
    }
    try {
      if (readdirSync(ledger).length === 0 && Date.now() - statSync(ledger).mtimeMs > EMPTY_LEDGER_KEEP_MS) {
        rmSync(ledger, { recursive: true, force: true });
      }
    } catch {
      // Not a ledger directory.
    }
  }
};
