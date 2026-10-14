import type { ChildProcess } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { terminateProcessTree } from "./process-tree.js";
import { pidIsAlive as isAlive, readProcessIdentity } from "./process-identity.js";

export type AgentProcessRecord = {
  pid: number;
  label: string;
  command: string;
  startedAt: number;
  /** Kernel start time (Linux) or `ps lstart` (macOS); guards pid reuse. */
  identity: string | null;
  processGroup: boolean;
};

const live = new Map<number, AgentProcessRecord>();
let registryFile: string | null = null;

const persist = () => {
  if (!registryFile) return;
  try {
    if (live.size === 0) {
      rmSync(registryFile, { force: true });
      return;
    }
    mkdirSync(path.dirname(registryFile), { recursive: true });
    const temp = `${registryFile}.${process.pid}.tmp`;
    writeFileSync(temp, JSON.stringify([...live.values()]), { mode: 0o600 });
    renameSync(temp, registryFile);
  } catch {
    // The exit lane still covers this process; only the restart lane is lost.
  }
};

export const configureAgentProcessRegistry = (file: string): void => {
  registryFile = file;
  persist();
};

export const trackAgentProcess = (
  child: ChildProcess,
  label: string,
  options: { processGroup: boolean },
): void => {
  const pid = child.pid;
  if (!pid) return;
  const record: AgentProcessRecord = {
    pid,
    label,
    command: child.spawnfile,
    startedAt: Date.now(),
    identity: readProcessIdentity(pid),
    processGroup: options.processGroup && process.platform !== "win32",
  };
  live.set(pid, record);
  persist();
  child.once("exit", () => {
    if (live.get(pid) !== record) return;
    live.delete(pid);
    persist();
  });
};

export const describeAgentProcesses = (): Array<{
  pid: number;
  label: string;
  alive: boolean;
}> =>
  [...live.values()].map((record) => ({
    pid: record.pid,
    label: record.label,
    alive: isAlive(record.pid),
  }));

/**
 * Synchronous so it can run from `process.on("exit")`: signal every tracked
 * CLI (its whole group when it leads one) and forget it.
 */
export const killAgentProcessesSync = (
  signal: NodeJS.Signals = "SIGKILL",
): number => {
  let signalled = 0;
  for (const record of live.values()) {
    try {
      process.kill(record.processGroup ? -record.pid : record.pid, signal);
      signalled += 1;
    } catch {
      // Already gone.
    }
  }
  live.clear();
  persist();
  return signalled;
};

/**
 * Read and clear what a previous worker left in `file`. Only processes still
 * alive with the same start-time identity are returned, so a recycled pid is
 * never touched.
 */
export const takeOrphanedAgentProcesses = (
  file: string,
): AgentProcessRecord[] => {
  let records: AgentProcessRecord[] = [];
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    if (Array.isArray(parsed)) records = parsed as AgentProcessRecord[];
  } catch {
    return [];
  }
  rmSync(file, { force: true });
  return records.filter(
    (record) =>
      Number.isInteger(record?.pid) &&
      record.pid > 1 &&
      record.pid !== process.pid &&
      typeof record.identity === "string" &&
      isAlive(record.pid) &&
      readProcessIdentity(record.pid) === record.identity,
  );
};

export const reapAgentProcesses = async (
  records: readonly AgentProcessRecord[],
): Promise<void> => {
  await Promise.all(
    records.map((record) =>
      record.processGroup
        ? terminateProcessTree(record.pid, {
            isRootRunning: () => isAlive(record.pid),
          })
        : Promise.resolve().then(() => {
            try {
              process.kill(record.pid, "SIGKILL");
            } catch {
              // Already gone.
            }
          }),
    ),
  );
};
