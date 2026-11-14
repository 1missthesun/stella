import { mkdir, stat } from "node:fs/promises";
import { hostname } from "node:os";
import type { Context } from "@earendil-works/chord";
import type { EnvTarget } from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { defaultAgentDirectory } from "@stella/runtime/kernel/agents/agent-directory";
import { terminateProcessTree } from "@stella/runtime/kernel/shared/process-tree";
import { isOwnUnreapedChild } from "@stella/runtime/kernel/shared/process-identity";
import { endTaskProcesses, pruneTaskProcessLedgers } from "@stella/runtime/kernel/shared/task-processes";
import { StellaAgentDoc } from "../stella/agent-doc.ts";
import type { RemoteAgentHost, StellaAgentsHost } from "../stella/agents.ts";

const LEDGER_PRUNE_DELAY_MS = 60_000;
const prunedLedgers = new Set<string>();
const pruneLedgersOnce = (dataDir: string) => {
  if (prunedLedgers.has(dataDir)) return;
  prunedLedgers.add(dataDir);
  setTimeout(() => void pruneTaskProcessLedgers(dataDir).catch(() => undefined), LEDGER_PRUNE_DELAY_MS).unref?.();
};

export function desktopAgentsHost(
  options: {
    deviceId?: string;
    cloud?: RemoteAgentHost;
    devices?: (deviceId: string) => RemoteAgentHost | undefined;
    agentReported?: StellaAgentsHost["agentReported"];
    agentStopped?: StellaAgentsHost["agentStopped"];
    beginAgentRun?: StellaAgentsHost["beginAgentRun"];
    endAgentRun?: StellaAgentsHost["endAgentRun"];
    ensureModel?: StellaAgentsHost["ensureModel"];
    agentModel?: StellaAgentsHost["agentModel"];
    engine?: StellaAgentsHost["engine"];
    deliverReport?: StellaAgentsHost["deliverReport"];
    deliverNote?: StellaAgentsHost["deliverNote"];
    reportsFromLedger?: StellaAgentsHost["reportsFromLedger"];
    directory?: StellaAgentsHost["directory"];
    dataDir?: string;
    endAgentShells?: (threadId: string) => Promise<number>;
    execution?: StellaAgentsHost["execution"];
    agentLog?: StellaAgentsHost["agentLog"];
  } = {},
): StellaAgentsHost {
  if (options.dataDir) pruneLedgersOnce(options.dataDir);
  return {
    ...(options.agentReported ? { agentReported: options.agentReported } : {}),
    ...(options.agentStopped ? { agentStopped: options.agentStopped } : {}),
    ...(options.beginAgentRun ? { beginAgentRun: options.beginAgentRun } : {}),
    ...(options.endAgentRun ? { endAgentRun: options.endAgentRun } : {}),
    ...(options.ensureModel ? { ensureModel: options.ensureModel } : {}),
    ...(options.agentModel ? { agentModel: options.agentModel } : {}),
    ...(options.engine ? { engine: options.engine } : {}),
    ...(options.deliverReport ? { deliverReport: options.deliverReport } : {}),
    ...(options.deliverNote ? { deliverNote: options.deliverNote } : {}),
    ...(options.reportsFromLedger ? { reportsFromLedger: options.reportsFromLedger } : {}),
    ...(options.directory ? { directory: options.directory } : {}),
    ...(options.dataDir ? { agentDirectory: (threadId: string) => defaultAgentDirectory(options.dataDir!, threadId) } : {}),
    ...(options.dataDir
      ? {
          endAgentProcesses: async (threadId: string) => {
            const shells = (await options.endAgentShells?.(threadId).catch(() => 0)) ?? 0;
            return shells + (await endTaskProcesses({ owner: threadId, stellaDataDir: options.dataDir! }));
          },
        }
      : {}),
    ...(options.execution ? { execution: options.execution } : {}),
    ...(options.agentLog ? { agentLog: options.agentLog } : {}),
    directoryProblem: async (directory) => {
      const found = await stat(directory).catch(() => undefined);
      if (found?.isDirectory()) return undefined;
      const here = `this computer (${hostname()})`;
      return found
        ? `directory ${directory} is not a folder on ${here}. Pass a folder that exists here, or leave directory out.`
        : `directory ${directory} does not exist on ${here}, where this agent would run. It may be a path from another computer: pass a folder that exists here, or leave directory out and name the path in the prompt.`;
    },
    rootPlacement: { kind: "local" },
    place: (destination, caller) => {
      if (destination.kind === "here") return caller;
      if (destination.kind === "device" && destination.deviceId === options.deviceId) return { kind: "local" };
      if (destination.kind === "cloud") {
        return options.cloud
          ? { kind: "cloud" }
          : { error: "Cloud agents run in conversations stored in the cloud; this one is kept on this computer." };
      }
      if (options.devices) return { kind: "device", deviceId: destination.deviceId };
      return { error: "This chat is stored only on this computer, so its agents can only run here." };
    },
    remote: (placement) =>
      placement.kind === "cloud" ? options.cloud : placement.kind === "device" ? options.devices?.(placement.deviceId) : undefined,
  };
}


export function desktopEnvironments(
  defaultCwd: string,
  shellEnv?: (target: { conversationId: string; agentId?: string; cwd: string }) => Record<string, string> | undefined,
) {
  const envs = new Map<string, NodeExecutionEnv>();
  const terminations = new Set<Promise<void>>();
  // pi keeps a command's pid until its output closes, which a background
  // child holding stdout can delay long after the shell itself exited and
  // was reaped; by then the pid may be another program's (on 2026-11-14 an
  // unexplained SIGKILL took Stella's own window processes). The shell is
  // only ours while it is still our unreaped child.
  const killCommandTree = (pid: number) => {
    const termination = terminateProcessTree(pid, {
      isRootRunning: () => isOwnUnreapedChild(pid),
      reason: "ending a task's shell command (stop, abort or timeout)",
    }).finally(() => {
      terminations.delete(termination);
    });
    terminations.add(termination);
    return termination;
  };
  const terminateCommands = async (context: Context) => {
    await Promise.all([...envs.values()].map((env) => env.cleanup(context)));
    while (terminations.size > 0) await Promise.allSettled([...terminations]);
  };
  return {
    terminateCommands,
    env: async ({ conversationId, cwd, read }: EnvTarget, context: Context) => {
      const directory = cwd ?? defaultCwd;
      const agentId = shellEnv
        ? (await read.snapshot(StellaAgentDoc, conversationId, context))?.threadId
        : undefined;
      const key = shellEnv ? `${conversationId}\0${agentId ?? ""}\0${directory}` : directory;
      let env = envs.get(key);
      if (!env) {
        if (cwd) await mkdir(directory, { recursive: true }).catch(() => undefined);
        const commandEnv = shellEnv?.({
          conversationId: String(conversationId),
          ...(agentId ? { agentId } : {}),
          cwd: directory,
        });
        env = new NodeExecutionEnv({
          cwd: directory,
          killProcessTree: killCommandTree,
          ...(commandEnv ? { shellEnv: { ...process.env, ...commandEnv } } : {}),
        });
        envs.set(key, env);
      }
      return env;
    },
    cleanup: async (context: Context) => {
      await terminateCommands(context);
      envs.clear();
    },
  };
}
