import { CLOUD_SANDBOX_SUBSCRIPTION_REQUIRED_MESSAGE } from "@stella/contracts/backend/billing";
import { attachedToolPathsForDirectory } from "@stella/executor-cloud/attached-tool-protocol";
import {
  normalizeToolWorkspaceRoot,
  withInfrastructureDeadline,
} from "./build-session/shared/keys.js";
import {
  describeInstanceSize,
  INSTANCE_TIERS,
  isInstanceSize,
  largerSize,
  sizeAfterOutOfDisk,
  sizeAfterOutOfMemory,
  type InstanceSize,
} from "./instance-size.js";
import { ownerGateStub } from "./rpc-release.js";
import {
  sandboxClient,
  type ExecResult,
  type ExecutionSession,
  type SandboxHandle,
} from "./sandbox-client.js";
import type { Sandbox, SandboxReleaseOptions } from "./sandbox-container.js";
import { sandboxLifecycleFailureFields } from "./sandbox-lifecycle.js";
import { issueWorldCapability } from "./world-capability.js";
import {
  worldMaterializationCommand,
  worldMaterializationFailure,
} from "./world-materialization.js";

/*
 * One agent container's lifecycle, shared by BuildSession's Claude agent
 * turns and the workspace compute of pi agents running in their
 * conversation: the sandbox handle at the agent's size, the owner's
 * container slot, the world attached into a session, the after-run memory
 * and disk probe that raises the agent's size, and the release.
 */

type Log = (level: "info" | "error", event: string, fields: Record<string, unknown>) => void;

export type AgentContainerTarget = {
  sandboxId: string;
  size: InstanceSize;
  world?: string;
  owner?: string;
  idleTimeoutMs?: number;
};

export const agentContainerHandle = (
  namespace: DurableObjectNamespace<Sandbox> | undefined,
  target: AgentContainerTarget,
): SandboxHandle => {
  if (!namespace) throw new Error("Cloud containers are not configured.");
  return sandboxClient(namespace, target.sandboxId, {
    size: target.size,
    workload: "world",
    ...(target.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: target.idleTimeoutMs }),
    ...(target.world ? { world: target.world } : {}),
    ...(target.owner ? { owner: target.owner } : {}),
  });
};

/**
 * Whether the container is running now, answered by its sandbox object and
 * never by the container: any container RPC starts it. An unanswerable state
 * counts as not running.
 */
export const agentContainerRunning = async (sandbox: SandboxHandle, log?: Log): Promise<boolean> => {
  try {
    const state = await withInfrastructureDeadline(sandbox.getState(), 10_000, "Sandbox state read did not settle.");
    return state.status === "running";
  } catch (error) {
    log?.("error", "sandbox_state_read_failed", { ...sandboxLifecycleFailureFields(error) });
    return false;
  }
};

export class AgentContainerRefusedError extends Error {
  constructor() {
    super(CLOUD_SANDBOX_SUBSCRIPTION_REQUIRED_MESSAGE);
    this.name = "AgentContainerRefusedError";
  }
}

type GateEnv = Pick<Cloudflare.Env, "OWNER_GATES">;

/** Takes one of the owner's agent container slots (container-cap); refused when the plan has none. */
export const acquireAgentContainerSlot = async (
  env: GateEnv,
  ownerId: string,
  sandboxId: string,
): Promise<{ running: number }> => {
  const slot = await ownerGateStub(env.OWNER_GATES, ownerId).acquireAgentContainer({ sandboxId });
  if (!slot.ok) throw new AgentContainerRefusedError();
  return { running: slot.running };
};

export const releaseAgentContainerSlot = async (env: GateEnv, ownerId: string, sandboxId: string): Promise<void> => {
  await ownerGateStub(env.OWNER_GATES, ownerId)
    .releaseAgentContainer({ sandboxId })
    .catch(() => undefined);
};

/** A session for one run; a failed attach leaves its session behind, so an existing one is replaced, never reused. */
export const openAgentSession = async (
  sandbox: SandboxHandle,
  options: { id: string; cwd: string; commandTimeoutMs: number; env: Record<string, string> },
): Promise<ExecutionSession> =>
  await sandbox.createSession(options).catch(async (error: unknown) => {
    if (!/already exists/iu.test(error instanceof Error ? error.message : String(error))) throw error;
    await sandbox.deleteSession(options.id).catch(() => undefined);
    return await sandbox.createSession(options);
  });

/**
 * Brings the owner's world (or a Crew workspace's) into the session's
 * workspace root from the world's export, with a capability for this run.
 */
export const materializeAgentWorld = async (
  session: ExecutionSession,
  args: {
    secret: string;
    origin: string;
    worldRoot: string;
    worldName: string;
    turnId: string;
    attemptGeneration: number;
    ttlMs: number;
    timeoutMs: number;
  },
): Promise<{ ok: true } | { ok: false; message: string; result: ExecResult }> => {
  const capability = await issueWorldCapability({
    secret: args.secret,
    worldName: args.worldName,
    turnId: args.turnId,
    attemptGeneration: args.attemptGeneration,
    now: Date.now(),
    ttlMs: args.ttlMs,
  });
  const exportUrl = new URL(`${args.origin.replace(/\/+$/u, "")}/internal/worlds/${args.worldName}/export`);
  const result = await session.exec(
    worldMaterializationCommand({ worldRoot: args.worldRoot, exportUrl: exportUrl.toString(), capability }),
    { timeout: args.timeoutMs },
  );
  if (!result.success) return { ok: false, message: worldMaterializationFailure(result), result };
  await normalizeToolWorkspaceRoot(session, args.worldRoot);
  return { ok: true };
};

/** Where an agent's size floor and its container's last seen OOM count are kept. */
export type AgentContainerSizeKeys = { size: string; oomBaseline: string; legacyLarge?: string };

export const piAgentContainerSizeKeys = (threadId: string): AgentContainerSizeKeys => ({
  size: `piContainerSize:${threadId}`,
  oomBaseline: `piContainerOomBaseline:${threadId}`,
});

/** The size an agent's next container gets: what this run asks for, never below what earlier runs grew to. */
export const agentContainerSize = async (
  storage: Pick<DurableObjectStorage, "get">,
  keys: AgentContainerSizeKeys,
  initial: InstanceSize,
): Promise<InstanceSize> => {
  const [floor, legacyLarge] = await Promise.all([
    storage.get<InstanceSize>(keys.size),
    keys.legacyLarge ? storage.get<boolean>(keys.legacyLarge) : Promise.resolve(undefined),
  ]);
  let size = initial;
  if (isInstanceSize(floor)) size = largerSize(size, floor);
  if (legacyLarge === true) size = "large";
  return size;
};

export const raiseAgentContainerSize = async (
  storage: Pick<DurableObjectStorage, "get" | "put">,
  keys: AgentContainerSizeKeys,
  size: InstanceSize,
): Promise<void> => {
  const stored = await storage.get<InstanceSize>(keys.size);
  const next = isInstanceSize(stored) ? largerSize(stored, size) : size;
  if (next !== stored && next !== "small") await storage.put(keys.size, next);
};

const DISK_EXHAUSTED_BYTES = 1_500 * 1000 ** 2;

const CONTAINER_PRESSURE_PROBE = `boot=$(cat /proc/sys/kernel/random/boot_id 2>/dev/null)
oom=$(awk '$1 == "oom_kill" { print $2 }' /proc/vmstat 2>/dev/null)
set -- $( (df -B1 --output=avail,size /workspace 2>/dev/null || df -B1 --output=avail,size /) | tail -1)
printf '%s %s %s %s\n' "\${boot:-unknown}" "\${oom:-0}" "\${1:-0}" "\${2:-0}"`;

type ContainerOomBaseline = { bootId: string; oomKills: number };

export type AgentContainerPressure = { note: string; resizedTo?: InstanceSize };

/**
 * After a run: whether the container killed a process for memory since the
 * last probe (the kernel's oom_kill count on this boot) or is nearly out of
 * disk. Either raises the agent's stored size for its next run and returns
 * the note its report carries.
 */
export const probeAgentContainerPressure = async (args: {
  sandbox: SandboxHandle;
  size: InstanceSize;
  storage: Pick<DurableObjectStorage, "get" | "put">;
  keys: AgentContainerSizeKeys;
  log: Log;
  fields: Record<string, unknown>;
}): Promise<AgentContainerPressure | undefined> => {
  const { sandbox, size, storage, keys } = args;
  if (!(await agentContainerRunning(sandbox, args.log))) return undefined;
  const probe = await withInfrastructureDeadline(
    sandbox.exec(CONTAINER_PRESSURE_PROBE),
    10_000,
    "Container pressure probe did not settle.",
  );
  if (!probe.success) return undefined;
  const [bootId = "", oomRaw, availRaw, totalRaw] = probe.stdout.trim().split(/\s+/u);
  const oomKills = Number(oomRaw);
  const availBytes = Number(availRaw);
  const totalBytes = Number(totalRaw);
  if (!Number.isSafeInteger(oomKills) || !Number.isFinite(availBytes)) return undefined;
  const baseline = await storage.get<ContainerOomBaseline>(keys.oomBaseline);
  const outOfMemory = oomKills > (baseline?.bootId === bootId ? baseline.oomKills : 0);
  await storage.put(keys.oomBaseline, { bootId, oomKills } satisfies ContainerOomBaseline);
  const outOfDisk = totalBytes > 0 && availBytes < DISK_EXHAUSTED_BYTES;
  args.log("info", "agent_container_pressure", {
    ...args.fields,
    instanceType: INSTANCE_TIERS[size].instanceType,
    oomKills,
    availBytes,
    totalBytes,
    outOfMemory,
    outOfDisk,
  });
  if (!outOfMemory && !outOfDisk) return undefined;
  const ran = outOfMemory && outOfDisk ? "memory and disk" : outOfMemory ? "memory" : "disk";
  const next = outOfMemory ? sizeAfterOutOfMemory(size) : sizeAfterOutOfDisk(size);
  if (next) await raiseAgentContainerSize(storage, keys, next);
  const what = `[Workspace: this agent's cloud container (${describeInstanceSize(size)}) ran out of ${ran} during this run, so a command in it was killed or failed.`;
  return next
    ? {
        resizedTo: next,
        note: `${what} Its next run gets a larger one (${describeInstanceSize(next)}); message it to continue.]`,
      }
    : { note: `${what} No cloud container has more ${outOfMemory ? "memory" : "disk"}.]` };
};

const quoted = (value: string) => `'${value.replace(/'/gu, `'"'"'`)}'`;

/**
 * Ends one run's use of an agent container: the owner's slot, the attached
 * tool daemon's process group and directory, the run's session, then the
 * container itself, which snapshots and stops (after the warm window unless
 * `release` says otherwise). Each step is best-effort and bounded; a
 * container that is not running holds none of them.
 */
export const releaseAgentContainer = async (args: {
  env: GateEnv;
  ownerId?: string;
  sandbox: SandboxHandle;
  sandboxId: string;
  sessionId: string;
  daemonDirectory: string;
  release: SandboxReleaseOptions;
  log?: Log;
}): Promise<void> => {
  const { sandbox } = args;
  if (args.ownerId) await releaseAgentContainerSlot(args.env, args.ownerId, args.sandboxId);
  if (!(await agentContainerRunning(sandbox, args.log))) return;
  const paths = attachedToolPathsForDirectory(args.daemonDirectory);
  const bounded = <T>(work: Promise<T>, ms: number, what: string) =>
    withInfrastructureDeadline(work, ms, what).catch(() => undefined);
  const group = await withInfrastructureDeadline(
    sandbox.exec(`cat -- ${quoted(paths.daemonPid)}`),
    5_000,
    "Attached daemon identity read did not settle.",
  )
    .then((result) => {
      if (!result.success) return undefined;
      const value: unknown = JSON.parse(result.stdout);
      if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
      const pid = "pid" in value ? value.pid : undefined;
      const pgid = "pgid" in value ? value.pgid : undefined;
      return Number.isSafeInteger(pid) && pid === pgid && Number(pid) > 1 ? Number(pgid) : undefined;
    })
    .catch(() => undefined);
  if (group !== undefined) {
    await bounded(sandbox.exec(`kill -TERM -- -${group}`), 5_000, "Attached daemon group SIGTERM did not settle.");
    await scheduler.wait(500);
    await bounded(sandbox.exec(`kill -KILL -- -${group}`), 5_000, "Attached daemon group SIGKILL did not settle.");
  }
  await bounded(
    sandbox.killProcess(`attached-daemon-${args.sessionId}`.slice(0, 64), "SIGKILL"),
    10_000,
    "Attached daemon teardown did not settle.",
  );
  await bounded(sandbox.exec(`rm -rf -- ${quoted(args.daemonDirectory)}`), 5_000, "Attached daemon directory removal did not settle.");
  await sandbox.deleteSession(args.sessionId).catch(() => undefined);
  await sandbox.release(args.release).catch(() => undefined);
};
