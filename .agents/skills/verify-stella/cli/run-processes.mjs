// Process bookkeeping for verify runs, so teardown never depends on the
// agent remembering `session stop` or on its checkout still existing.
//
// - A run records every process in Electron's tree (pid + start time), which
//   catches helpers that detach and outlive Electron (crash reporter, zygotes)
//   and carry no run marker in their command line.
// - Every run is also listed in a per-user registry outside the checkout. A
//   run whose pointer file is gone (worktree deleted, or stopped without
//   cleanup) is reaped by the next harness call from any checkout.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const isAlive = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
};

const realHome = () => {
  try {
    return os.userInfo().homedir || os.homedir();
  } catch {
    return os.homedir();
  }
};

export const runRegistryDir = () =>
  process.env.STELLA_VERIFY_RUN_REGISTRY?.trim() ||
  path.join(process.env.XDG_CACHE_HOME?.trim() || path.join(realHome(), ".cache"), "stella-verify", "runs");

const LSTART = /^\s*(\d+)\s+(\d+)\s+(\w{3}\s+\w{3}\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/;

/** pid, ppid, start time (as ps prints it) and command of every process. */
export const processTableWithStart = () => {
  const result = spawnSync("ps", ["-axo", "pid=,ppid=,lstart=,command="], {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C" },
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.status !== 0) return [];
  return result.stdout
    .split("\n")
    .map((line) => line.match(LSTART))
    .filter(Boolean)
    .map(([, pid, ppid, started, command]) => ({
      pid: Number(pid),
      ppid: Number(ppid),
      started: started.replace(/\s+/g, " "),
      command,
    }));
};

/** The root and all of its descendants, as currently running. */
export const processTree = (rootPid, table = processTableWithStart()) => {
  if (!isAlive(rootPid)) return [];
  const children = new Map();
  for (const entry of table) {
    if (!children.has(entry.ppid)) children.set(entry.ppid, []);
    children.get(entry.ppid).push(entry);
  }
  const tree = [];
  const seen = new Set();
  const queue = table.filter((entry) => entry.pid === rootPid);
  while (queue.length > 0) {
    const entry = queue.shift();
    if (seen.has(entry.pid)) continue;
    seen.add(entry.pid);
    tree.push(entry);
    queue.push(...(children.get(entry.pid) ?? []));
  }
  return tree;
};

/** Adds the processes now in `rootPid`'s tree (and `extra`) to `recorded`. */
export const recordProcesses = (recorded = [], rootPid, extra = []) => {
  const table = processTableWithStart();
  const byKey = new Map(recorded.map((entry) => [`${entry.pid}:${entry.started}`, entry]));
  const extraPids = new Set(extra.map((entry) => entry.pid));
  const found = [...processTree(rootPid, table), ...table.filter((entry) => extraPids.has(entry.pid))];
  for (const entry of found) {
    if (entry.pid === process.pid) continue;
    byKey.set(`${entry.pid}:${entry.started}`, {
      pid: entry.pid,
      started: entry.started,
      command: entry.command.slice(0, 200),
    });
  }
  return [...byKey.values()];
};

/**
 * Stops recorded processes that are still the very process recorded (same
 * pid and start time): SIGTERM, then SIGKILL after the grace period.
 */
export const reapRecordedProcesses = async (recorded = [], graceMs = 4_000) => {
  const table = new Map(processTableWithStart().map((entry) => [entry.pid, entry]));
  const live = recorded.filter((entry) => table.get(entry.pid)?.started === entry.started && entry.pid !== process.pid);
  for (const { pid } of live) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {}
  }
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline && live.some(({ pid }) => isAlive(pid))) await delay(150);
  const now = new Map(processTableWithStart().map((entry) => [entry.pid, entry]));
  for (const entry of live) {
    if (now.get(entry.pid)?.started !== entry.started) continue;
    try {
      process.kill(entry.pid, "SIGKILL");
    } catch {}
  }
  return live.map(({ pid, command }) => ({ pid, command: command.slice(0, 160) }));
};

const registryFile = (runId) => path.join(runRegistryDir(), `${runId}.json`);

/** Lists the run where any checkout's harness can find it. */
export const registerRun = (run, pointerPath, tempRoot) => {
  try {
    mkdirSync(runRegistryDir(), { recursive: true, mode: 0o700 });
    const target = registryFile(run.runId);
    const temp = `${target}.${process.pid}.tmp`;
    writeFileSync(
      temp,
      JSON.stringify({
        runId: run.runId,
        pointerPath,
        runDir: run.runDir,
        tempRoot,
        xvfbPid: run.display?.mode === "xvfb" ? run.display.pid : null,
        processes: run.ownedProcesses ?? [],
        updatedAt: new Date().toISOString(),
      }),
      { mode: 0o600 },
    );
    renameSync(temp, target);
  } catch {}
};

export const unregisterRun = (runId) => rmSync(registryFile(runId), { force: true });

const pointerNamesRun = (pointerPath, runId) => {
  try {
    return JSON.parse(readFileSync(pointerPath, "utf8"))?.runId === runId;
  } catch {
    return false;
  }
};

/**
 * Reaps runs nobody can stop any more: their pointer file is gone or names
 * another run. `runOwnedProcesses` finds what still carries the run marker;
 * `removeTempRoot` deletes the run's temp folder once its processes are gone.
 */
export const sweepOrphanedRuns = async ({ runOwnedProcesses, removeTempRoot }) => {
  let entries;
  try {
    entries = readdirSync(runRegistryDir()).filter((entry) => entry.endsWith(".json"));
  } catch {
    return [];
  }
  const swept = [];
  for (const entry of entries) {
    const file = path.join(runRegistryDir(), entry);
    let record;
    try {
      record = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      rmSync(file, { force: true });
      continue;
    }
    if (!record?.runId || pointerNamesRun(record.pointerPath, record.runId)) continue;
    const marked = runOwnedProcesses(record.runId).map(({ pid }) => pid);
    const table = processTableWithStart();
    const extra = table.filter((row) => marked.includes(row.pid)).map(({ pid, started, command }) => ({ pid, started, command }));
    const xvfb = record.xvfbPid ? table.filter((row) => row.pid === record.xvfbPid && /Xvfb/.test(row.command)) : [];
    const stopped = await reapRecordedProcesses([...(record.processes ?? []), ...extra, ...xvfb], 2_000);
    if (record.tempRoot && existsSync(record.tempRoot)) removeTempRoot(record.tempRoot);
    rmSync(file, { force: true });
    swept.push({ runId: record.runId, stopped });
  }
  return swept;
};
