import { attachedToolPaths } from "@stella/executor-cloud/attached-tool-protocol";
import {
  advanceSandboxDestroyDebt,
  clearSandboxDestroyDebt,
  createSandboxDestroyDebt,
  isSandboxDestroyDue,
  listSandboxDestroyDebts,
  persistSandboxDestroyDebt,
  readSandboxDestroyDebt,
  sandboxDestroyDebtKey,
  SandboxLifecycleDeferredError,
  sandboxLifecycleFailureFields,
  SANDBOX_WORKLOADS,
} from "../sandbox-lifecycle.js";
import {
  acquireAgentContainerSlot as acquireSharedAgentContainerSlot,
  AgentContainerRefusedError,
  agentContainerRunning,
  agentContainerSize,
  releaseAgentContainer,
} from "../agent-container.js";
import { sandboxClient } from "../sandbox-client.js";
import { SANDBOX_PAGE_CACHE_WARM_COMMAND } from "../sandbox-code.js";
import { snapshotAllowsCloudSandbox } from "../owner-gate.js";
import { agentSandboxId, agentTurnSessionId, worldName } from "../workspace.js";
import { initialInstanceSize, isInstanceSize } from "../instance-size.js";
import type { InstanceSize } from "../instance-size.js";
import type {
  SandboxDestroyDebt,
  SandboxTarget,
  SandboxWorkload,
} from "../sandbox-lifecycle.js";
import type { TurnExecutionContext } from "../turn-cancellation.js";
import type { BuildSessionInternals } from "./host.js";
import { AgentTurnError } from "./shared/errors.js";
import type { Env } from "./shared/env.js";
import {
  agentExecutionMarkerKey,
  BUILD_SESSION_CONTAINER_SIZE_KEYS,
  exactTurnIdentityMatches,
  json,
  log,
  withInfrastructureDeadline,
} from "./shared/keys.js";
import type { AgentExecutionMarker, TurnRequest } from "./shared/types.js";
import { ownerGateStub } from "../rpc-release.js";

export type SessionSandboxHost = Pick<
  BuildSessionInternals,
  | "ctx"
  | "env"
  | "currentSandboxTarget"
  | "destroySandboxDurably"
  | "releaseAgentSessionResources"
  | "sandbox"
  | "sandboxContainerRunning"
>;

const sandboxSleepAfterMs = (
  env: Pick<Env, "SANDBOX_IDLE_TIMEOUT_MS">,
): number | undefined => {
  const value = Number(env.SANDBOX_IDLE_TIMEOUT_MS);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
};

const DEFAULT_ORCHESTRATOR_IDLE_TIMEOUT_MS = 2 * 60_000;

export const orchestratorSleepAfterMs = (
  env: Pick<Env, "ORCHESTRATOR_IDLE_TIMEOUT_MS">,
): number => {
  const value = Number(env.ORCHESTRATOR_IDLE_TIMEOUT_MS);
  return Number.isSafeInteger(value) && value > 0
    ? value
    : DEFAULT_ORCHESTRATOR_IDLE_TIMEOUT_MS;
};

export const turnSleepAfterMs = (
  env: Pick<Env, "SANDBOX_IDLE_TIMEOUT_MS" | "ORCHESTRATOR_IDLE_TIMEOUT_MS">,
  turn: Pick<TurnRequest, "agentRole"> | undefined,
): number | undefined =>
  turn?.agentRole === "orchestrator"
    ? orchestratorSleepAfterMs(env)
    : sandboxSleepAfterMs(env);

const DEFAULT_PREWARM_IDLE_TIMEOUT_MS = 90_000;

const sandboxPrewarmSleepAfterMs = (
  env: Pick<
    Env,
    "SANDBOX_IDLE_TIMEOUT_MS" | "SANDBOX_PREWARM_IDLE_TIMEOUT_MS"
  >,
): number => {
  const configured = Number(env.SANDBOX_PREWARM_IDLE_TIMEOUT_MS);
  const prewarm =
    Number.isSafeInteger(configured) && configured > 0
      ? configured
      : DEFAULT_PREWARM_IDLE_TIMEOUT_MS;
  const afterTurn = sandboxSleepAfterMs(env);
  return afterTurn === undefined ? prewarm : Math.min(prewarm, afterTurn);
};

export const sandboxHandle = (
  env: Env,
  target: SandboxTarget,
  idleTimeoutMs: number | undefined = sandboxSleepAfterMs(env),
  world?: string,
  owner?: string,
) =>
  sandboxClient(env.Sandbox, target.sandboxId, {
    size: target.size,
    workload: target.workload,
    ...(idleTimeoutMs === undefined ? {} : { idleTimeoutMs }),
    ...(world ? { world } : {}),
    ...(owner ? { owner } : {}),
  });

const RETIRE_SANDBOX_ID =
  /^(?:(?:agent|world|app)-[0-9a-f]{40}|echo-[0-9a-f-]{36})$/u;

const isWorldSandboxId = (sandboxId: string): boolean =>
  sandboxId.startsWith("agent-") || sandboxId.startsWith("world-");

export const retireSandboxInstance = async (
  env: Env,
  request: Request,
): Promise<Response> => {
  const raw = (await request.json().catch(() => null)) as unknown;
  const body =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const sandboxId = typeof body.sandboxId === "string" ? body.sandboxId : "";
  const size = body.size;
  const workload = body.workload;
  if (
    !RETIRE_SANDBOX_ID.test(sandboxId) ||
    !isInstanceSize(size) ||
    typeof workload !== "string" ||
    !(SANDBOX_WORKLOADS as readonly string[]).includes(workload) ||
    (isWorldSandboxId(sandboxId) && workload !== "world") ||
    (!isWorldSandboxId(sandboxId) && workload !== "app-build")
  ) {
    return json({ ok: false, reason: "invalid_target" }, 400);
  }
  const target: SandboxTarget = {
    sandboxId,
    size,
    workload: workload as SandboxWorkload,
  };
  const sandbox = sandboxHandle(env, target);
  try {
    await withInfrastructureDeadline(
      sandbox.destroy(),
      30_000,
      "Sandbox destruction did not settle.",
    );
  } catch (error) {
    const failure = sandboxLifecycleFailureFields(error);
    log("error", "sandbox_operator_destroy_failed", {
      workload: target.workload,
      instanceSize: target.size,
      ...failure,
    });
    return json(
      {
        ok: false,
        reason: "destroy_failed",
        target,
        ...failure,
      },
      502,
    );
  }
  log("info", "sandbox_retired_by_operator", {
    workload: target.workload,
    instanceSize: target.size,
  });
  return json({ ok: true, target });
};

export const prewarmOrchestratorContainer = async (
  host: SessionSandboxHost,
  request: Request,
): Promise<Response> => {
  const raw = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const ownerId = typeof raw?.ownerId === "string" ? raw.ownerId.trim() : "";
  const threadId =
    typeof raw?.threadId === "string" ? raw.threadId.trim() : "";
  if (!ownerId || ownerId.length > 512 || !threadId || threadId.length > 512) {
    return json({ error: "ownerId and threadId are required." }, 400);
  }
  const stored = await host.ctx.storage.get<TurnRequest>("turn");
  if (
    stored &&
    (stored.ownerId !== ownerId ||
      (stored.threadId !== undefined && stored.threadId !== threadId))
  ) {
    return json({ prewarmed: false, reason: "owner_mismatch" }, 409);
  }
  const snapshot = await ownerGateStub(host.env.OWNER_GATES, ownerId)
    .snapshot()
    .catch(() => null);
  if (!snapshot || !snapshotAllowsCloudSandbox(snapshot)) {
    return json({ prewarmed: false, reason: "subscription_required" }, 403);
  }
  const size = await agentContainerSize(
    host.ctx.storage,
    BUILD_SESSION_CONTAINER_SIZE_KEYS,
    initialInstanceSize({}),
  );
  const handle = sandboxHandle(
    host.env,
    {
      sandboxId: await agentSandboxId(ownerId, threadId),
      size,
      workload: "world",
    },
    sandboxPrewarmSleepAfterMs(host.env),
    await worldName(ownerId),
    ownerId,
  );
  if (await host.sandboxContainerRunning(handle)) {
    return json({ prewarmed: true, alreadyRunning: true });
  }
  const started = performance.now();
  try {
    await withInfrastructureDeadline(
      handle.exec("true"),
      120_000,
      "Orchestrator container prewarm did not settle.",
    );
  } catch (error) {
    log("error", "orchestrator_container_prewarm_failed", {
      ...sandboxLifecycleFailureFields(error),
    });
    return json({ prewarmed: false, reason: "start_failed" }, 502);
  }
  const startMs = Math.round(performance.now() - started);
  await handle
    .exec(SANDBOX_PAGE_CACHE_WARM_COMMAND)
    .catch(() => undefined);
  log("info", "orchestrator_container_prewarmed", {
    instanceSize: size,
    startMs,
  });
  return json({ prewarmed: true, alreadyRunning: false, startMs });
};

export const acquireAgentContainerSlot = async (
  host: Pick<SessionSandboxHost, "env">,
  turn: TurnRequest,
  sandboxId: string,
  execution: TurnExecutionContext,
): Promise<void> => {
  if (turn.agentRole === "orchestrator") return;
  execution.assertActive();
  const slot = await acquireSharedAgentContainerSlot(
    host.env,
    turn.ownerId,
    sandboxId,
  ).catch((error: unknown) => {
    throw error instanceof AgentContainerRefusedError
      ? new AgentTurnError(error.message)
      : error;
  });
  log("info", "agent_container_acquired", {
    threadId: turn.threadId,
    sandbox: sandboxId.slice(0, 16),
    running: slot.running,
  });
};

export const sandbox = (
  host: Pick<SessionSandboxHost, "env">,
  id: string,
  size: InstanceSize = "large",
  workload: SandboxWorkload = "world",
  world?: string,
  idleTimeoutMs: number | undefined = sandboxSleepAfterMs(host.env),
  owner?: string,
) =>
  sandboxHandle(
    host.env,
    { sandboxId: id, size, workload },
    idleTimeoutMs,
    world,
    owner,
  );

export const sandboxContainerRunning = async (
  _host: SessionSandboxHost,
  sandbox: ReturnType<BuildSessionInternals["sandbox"]>,
): Promise<boolean> => await agentContainerRunning(sandbox, log);

export const destroySandboxDurably = async (
  host: SessionSandboxHost,
  target: SandboxTarget,
  event: string,
): Promise<void> => {
  const now = Date.now();
  let debt!: SandboxDestroyDebt;
  await host.ctx.storage.transaction(async (txn) => {
    debt =
      (await readSandboxDestroyDebt(txn, target)) ??
      createSandboxDestroyDebt(target, now);
    const debtKey = sandboxDestroyDebtKey(target);
    await txn.put(debtKey, debt);
    const existingAlarm = await txn.getAlarm();
    await txn.setAlarm(
      existingAlarm === null
        ? debt.nextAttemptAt
        : Math.min(existingAlarm, debt.nextAttemptAt),
    );
  });
  const sandbox = host.sandbox(target.sandboxId, target.size, target.workload);
  try {
    await withInfrastructureDeadline(
      sandbox.destroy({ keepSnapshot: event === "agent_oom_resize" }),
      30_000,
      "Sandbox destruction did not settle.",
    );
  } catch (error) {
    const advanced = advanceSandboxDestroyDebt(debt, Date.now());
    await persistSandboxDestroyDebt(host.ctx.storage, advanced);
    log("error", "sandbox_destroy_deferred", {
      lifecycleReason: event,
      workload: target.workload,
      instanceSize: target.size,
      attemptCount: advanced.attemptCount,
      retryDelayMs: Math.max(0, advanced.nextAttemptAt - Date.now()),
      ...sandboxLifecycleFailureFields(error),
    });
    throw new SandboxLifecycleDeferredError();
  }
  await clearSandboxDestroyDebt(host.ctx.storage, debt);
  log("info", "sandbox_destroyed", {
    lifecycleReason: event,
    workload: target.workload,
    instanceSize: target.size,
    attempts: debt.attemptCount + 1,
  });
};

export const retryDueSandboxDestroyDebts = async (
  host: SessionSandboxHost,
  now = Date.now(),
): Promise<void> => {
  const debts = await listSandboxDestroyDebts(host.ctx.storage);
  for (const debt of debts) {
    if (!isSandboxDestroyDue(debt, now)) continue;
    await host
      .destroySandboxDurably(debt.target, "alarm_retry")
      .catch(() => undefined);
  }
};

export const scheduleSandboxDestroyDebtAlarm = async (
  host: SessionSandboxHost,
): Promise<void> => {
  const debts = await listSandboxDestroyDebts(host.ctx.storage);
  const next = debts.reduce<number | null>(
    (earliest, debt) =>
      earliest === null
        ? debt.nextAttemptAt
        : Math.min(earliest, debt.nextAttemptAt),
    null,
  );
  if (next === null) return;
  const existing = await host.ctx.storage.getAlarm();
  await host.ctx.storage.setAlarm(
    existing === null ? next : Math.min(existing, next),
  );
};

export const currentSandboxTarget = async (
  host: SessionSandboxHost,
): Promise<SandboxTarget | undefined> => {
  const [storedSandboxId, storedSize] = await Promise.all([
    host.ctx.storage.get<string>("sandboxId"),
    host.ctx.storage.get<InstanceSize>("sandboxSize"),
  ]);
  return storedSandboxId
    ? { sandboxId: storedSandboxId, size: storedSize ?? "large", workload: "world" }
    : undefined;
};

export const currentSandbox = async (host: SessionSandboxHost) => {
  const target = await host.currentSandboxTarget();
  return target
    ? host.sandbox(target.sandboxId, target.size, target.workload)
    : undefined;
};

export const terminateCurrentAgentSession = async (
  host: SessionSandboxHost,
  turn: TurnRequest,
): Promise<void> => {
  const target = await host.ctx.storage.transaction(async (txn) => {
    const markerKey =
      Number.isSafeInteger(turn.attemptGeneration) &&
      turn.attemptGeneration! >= 1
        ? agentExecutionMarkerKey(turn.turnId, turn.attemptGeneration!)
        : undefined;
    const [current, sandboxId, storedSize, executionMarker] = await Promise.all(
      [
        txn.get<TurnRequest>("turn"),
        txn.get<string>("sandboxId"),
        txn.get<InstanceSize>("sandboxSize"),
        markerKey
          ? txn.get<AgentExecutionMarker>(markerKey)
          : Promise.resolve(undefined),
      ],
    );
    if (!sandboxId || !exactTurnIdentityMatches(current, turn)) {
      return undefined;
    }
    const size = storedSize ?? ("large" as const);
    return {
      sandboxId,
      size,
      workload: "world" as const,
      sessionId: agentTurnSessionId(turn.turnId),
      daemonDirectory: attachedToolPaths({
        turnId: turn.turnId,
        attemptGeneration: turn.attemptGeneration ?? 1,
      }).directory,
      executorAdmitted:
        executionMarker?.schemaVersion === 1 &&
        executionMarker.turnId === turn.turnId &&
        executionMarker.attemptGeneration === turn.attemptGeneration &&
        executionMarker.sandboxId === sandboxId &&
        executionMarker.size === size,
    };
  });
  if (!target) return;
  await host.releaseAgentSessionResources({ ...target, warm: false });
};

export const releaseAgentSessionResources = async (
  host: SessionSandboxHost,
  target: {
    sandboxId: string;
    size: InstanceSize;
    workload: "world";
    sessionId: string;
    daemonDirectory: string;
    warm?: boolean;
  },
): Promise<void> => {
  const turn = await host.ctx.storage.get<TurnRequest>("turn");
  await releaseAgentContainer({
    env: host.env,
    ...(turn?.ownerId ? { ownerId: turn.ownerId } : {}),
    sandbox: host.sandbox(
      target.sandboxId,
      target.size,
      target.workload,
      undefined,
      turnSleepAfterMs(host.env, turn),
    ),
    sandboxId: target.sandboxId,
    sessionId: target.sessionId,
    daemonDirectory: target.daemonDirectory,
    release:
      turn?.agentRole === "orchestrator"
        ? { warmMs: orchestratorSleepAfterMs(host.env), snapshot: false }
        : { warm: target.warm !== false },
    log,
  });
};
