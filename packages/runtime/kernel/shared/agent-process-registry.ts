import type { ChildProcess } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { terminateProcessTree } from "@stella/node-shared/shared/process-tree.js";
import {
  pidIsAlive as isAlive,
  readProcessIdentity,
  signalRecordedProcess,
} from "@stella/node-shared/shared/process-identity.js";

export type AgentProcessRecord = {
  pid: number;
  label: string;
  command: string;
  startedAt: number;
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
  } catch {}
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

export const killAgentProcessesSync = (
  signal: NodeJS.Signals = "SIGKILL",
): number => {
  let signalled = 0;
  for (const record of live.values()) {
    const outcome = signalRecordedProcess(
      { pid: record.pid, identity: record.identity },
      signal,
      { reason: `runtime exiting: stopping ${record.label}`, group: record.processGroup },
    );
    if (outcome === "sent") signalled += 1;
  }
  live.clear();
  persist();
  return signalled;
};

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
            isRootRunning: () =>
              isAlive(record.pid) && readProcessIdentity(record.pid) === record.identity,
            reason: `reaping ${record.label} left by a previous runtime`,
          })
        : Promise.resolve().then(() => {
            signalRecordedProcess({ pid: record.pid, identity: record.identity }, "SIGKILL", {
              reason: `reaping ${record.label} left by a previous runtime`,
            });
          }),
    ),
  );
};
