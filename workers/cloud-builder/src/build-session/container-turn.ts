import { builderServiceSecret } from "../secret-rotation.js";
import {
  agentFailureMessage,
  classifyAgentFailureDiagnostic,
} from "../agent-failure-diagnostic.js";
import { CloudHomeStore, gateHomeControl } from "../cloud-home-store.js";
import type { CloudSkillCatalogSnapshot } from "../cloud-home-store.js";
import {
  materializeCloudSkillSnapshot,
  mirrorCloudSkillsIntoHome,
} from "../cloud-skill-materializer.js";
import { devAcceptanceProbesEnabled } from "../dev-acceptance-probes.js";
import { executorSessionEnvironment } from "../executor-session-env.js";
import { cloudNativeStateRoot } from "@stella/contracts/cloud-native-state";
import {
  describeInstanceSize,
  initialInstanceSize,
  INSTANCE_TIERS,
  isInstanceSize,
  isOutOfMemoryFailure,
  sizeAfterOutOfDisk,
  sizeAfterOutOfMemory,
} from "../instance-size.js";
import type { InstanceSize } from "../instance-size.js";
import { nativeHistoryCursorFromRows } from "../native-state-checkpoint.js";
import {
  CapturedSessionAbandonedError,
  capturedSessionExec,
} from "../strict-session-process.js";
import { emitCloudTurnTelemetry } from "../telemetry.js";
import { createTurnRetryCancellation } from "../turn-cancellation.js";
import type {
  TurnExecutionContext,
  TurnRetryCancellation,
} from "../turn-cancellation.js";
import {
  issueTurnBrokerCredential,
  revokeTurnBrokerCredential,
  TURN_BROKER_MAX_TTL_MS,
  turnBrokerStorageKey,
} from "../turn-credential-broker.js";
import type { TurnBrokerRecord } from "../turn-credential-broker.js";
import { readOrchestratorCliSpec } from "../orchestrator-cli-turn-store.js";
import { writeAdoptedClaudeSession, writeHydratedClaudeSession } from "./claude-session-adoption.js";
import { restoreTurnStateArchive } from "../turn-state-archive.js";
import type {
  TurnStateCandidate,
  TurnStateWorkspaceHead,
} from "../turn-state-registry.js";
import {
  agentTurnSessionId,
  WORLD_ROOT,
  worldName,
} from "../workspace.js";
import { issueWorldCapability } from "../world-capability.js";
import { conversationWorldName } from "../slack/scope.js";
import { worldMaterializationCommand, worldMaterializationFailure } from "../world-materialization.js";
import {
  SANDBOX_EXECUTOR,
  SANDBOX_PAGE_CACHE_WARM_COMMAND,
} from "../sandbox-code.js";
import type { BuildSessionInternals } from "./host.js";
import type { Env } from "./shared/env.js";
import {
  backupClaudeCloudLogins,
  restoreClaudeCloudLogins,
  seedTestClaudeLogin,
} from "../claude-cloud-login.js";
import { TEST_CLAUDE_EMAIL, testClaudeConfigured } from "../test-claude.js";
import type { RpcResponse } from "@stella/contracts/backend/protocol";
import {
  parseAgentExecutorResult,
  validTurnStateCheckpointReceipt,
} from "./public-helpers.js";
import {
  AgentTurnAuthorityLostError,
  AgentTurnError,
  OwnerPurgeFenceError,
  TurnStateRegistryBookkeepingError,
  isTurnStateAuthorityError,
} from "./shared/errors.js";
import {
  AGENT_CONTAINER_SIZE_KEY,
  CONTAINER_OOM_BASELINE_KEY,
  AGENT_RECOVERY_PENDING_KEY,
  AGENT_TURN_HEARTBEAT_MS,
  AGENT_WATCHDOG_DEADLINE_KEY,
  agentContainerSize,
  agentExecutionMarkerKey,
  agentRecoveryIdentity,
  errorMessage,
  exactTurnIdentityMatches,
  json,
  log,
  nativeStateIntegrityKeyFor,
  nativeStateIntegrityKeysFor,
  nativeStateThreadHash,
  normalizeToolWorkspaceRoot,
  sessionName,
  turnBrokerCredentialsPath,
  withInfrastructureDeadline,
} from "./shared/keys.js";
import {
  acquireAgentContainerSlot,
  turnSleepAfterMs,
} from "./session-sandbox.js";
import type {
  AgentExecutionMarker,
  AgentExecutorResult,
  Execution,
  PendingTerminal,
  TurnRequest,
} from "./shared/types.js";
import type { ExecutionSession } from "../sandbox-client.js";
import type { CloudCliTurnRoleInput } from "@stella/contracts/cloud-orchestrator-cli";
import {
  CLOUD_TURN_ATTEMPT_ANCHOR,
  CLOUD_TURN_ATTEMPT_DIRECTORY_FLAG,
  cloudTurnAttemptPaths,
  cloudTurnInboxMessageName,
} from "@stella/contracts/cloud-turn-attempt";
import { sha256Hex } from "../hash.js";
import type { AgentHistoryRow } from "@stella/executor-cloud/agent-history";
import { attachedToolPaths } from "@stella/executor-cloud/attached-tool-protocol";
import { cloudGeneralToolNames } from "@stella/executor-cloud/cloud-general-tools";
import { renderCloudAgentPrompt } from "../prompts/bundled.js";
import {
  runToolEffect,
  sleepWithAbort,
} from "@stella/runtime/kernel/tools/effect-runtime.js";
import { Effect } from "effect";
import { ownerGateStub } from "../rpc-release.js";
import { importAgentLogIntoThread } from "./agent-log-bridge.js";
import { agentDevicesSection, takeAgentMove } from "./agent-move.js";
import { CLOUD_AGENT_MOVE_TOOL } from "@stella/executor-cloud/cloud-agent-move-protocol";

export type ContainerTurnHost = Pick<
  BuildSessionInternals,
  | "ctx"
  | "env"
  | "agentTurnExecutions"
  | "builderFallbackRecoveries"
  | "appendThreadTranscript"
  | "assertAgentExecutionActive"
  | "assertAgentTurnIdentity"
  | "attachAgentWorld"
  | "claimTerminalDecision"
  | "cleanupOwnerPurgedTurnStorage"
  | "confirmAgentTurnStateRestore"
  | "deleteTurnStoragePreservingExactCancellations"
  | "deliverTerminal"
  | "destroySandboxDurably"
  | "event"
  | "exactAgentExecutionMarker"
  | "fetchCanonicalAgentHistory"
  | "mutateExactTurn"
  | "ownsExactTurn"
  | "publishAgentTurnWorkspace"
  | "quiesceCurrentAgentSession"
  | "reconcileAgentCheckpointAfterQuiescence"
  | "releaseAgentSessionResources"
  | "resolveAgentTurnState"
  | "runAgentAttempt"
  | "sandbox"
  | "sandboxContainerRunning"
  | "setExactTurnAlarm"
  | "settleAgentTransientBackup"
  | "terminateCurrentAgentSession"
  | "unregisterTurn"
>;

/** The owner's world, or the Slack workspace's own world for a Stella Crew turn. */
const turnWorldName = async (
  env: { DB?: D1Database },
  turn: Pick<TurnRequest, "ownerId" | "conversationId" | "originConversationId">,
): Promise<string> =>
  await conversationWorldName(
    env,
    turn.ownerId,
    turn.conversationId ?? turn.originConversationId,
    worldName,
  );

const readCloudAgentTurnResultText = async (
  session: Pick<ExecutionSession, "readFile">,
  resultPath: string,
): Promise<string | undefined> => {
  let recorded: { content: string };
  try {
    recorded = await session.readFile(resultPath, { encoding: "base64" });
  } catch {
    return undefined;
  }
  const bytes = Uint8Array.from(atob(recorded.content), (character) =>
    character.charCodeAt(0),
  );
  try {
    if (bytes.byteLength > 4 * 1024 * 1024) {
      throw new MalformedExecutorResultError("exceeds 4 MiB");
    }
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
      bytes,
    );
  } catch (error) {
    if (error instanceof MalformedExecutorResultError) throw error;
    throw new MalformedExecutorResultError("is not UTF-8");
  } finally {
    bytes.fill(0);
  }
};

export class MalformedExecutorResultError extends Error {
  constructor(detail: string) {
    super(`The agent executor published a result that ${detail}.`);
    this.name = "MalformedExecutorResultError";
  }
}

const parsePublishedExecutorResult = (text: string): AgentExecutorResult => {
  let decoded: unknown;
  try {
    decoded = JSON.parse(text) as unknown;
  } catch {
    throw new MalformedExecutorResultError("is not JSON");
  }
  const result = parseAgentExecutorResult(decoded);
  if (!result) {
    throw new MalformedExecutorResultError("does not match the result schema");
  }
  return result;
};

export const waitForCloudAgentTurnResultText = async (
  session: Pick<ExecutionSession, "readFile">,
  resultPath: string,
  signals: readonly AbortSignal[],
  cancellation?: TurnRetryCancellation,
): Promise<string> => {
  const abortError = (): Error | undefined => {
    if (cancellation?.aborted) {
      return cancellation.reason instanceof Error
        ? cancellation.reason
        : new Error("Agent result observation was canceled.");
    }
    const signal = signals.find((candidate) => candidate.aborted);
    if (!signal) return undefined;
    return signal.reason instanceof Error
      ? signal.reason
      : new Error("Agent result observation was canceled.");
  };
  const combinedSignal =
    signals.length > 0 ? AbortSignal.any([...signals]) : undefined;
  while (true) {
    const reason = abortError();
    if (reason) throw reason;
    const recorded = await readCloudAgentTurnResultText(session, resultPath);
    const afterReadReason = abortError();
    if (afterReadReason) throw afterReadReason;
    if (recorded !== undefined) {
      parsePublishedExecutorResult(recorded);
      return recorded;
    }
    const signalDelay = sleepWithAbort(250, combinedSignal, (activeSignal) =>
      activeSignal.reason instanceof Error
        ? activeSignal.reason
        : new Error("Agent result observation was canceled."),
    );
    await (cancellation
      ? Promise.race([signalDelay, cancellation.sleep(250)])
      : signalDelay);
  }
};

export const quiesceCurrentAgentSession = async (
  host: ContainerTurnHost,
  turn: TurnRequest,
): Promise<void> => {
  const target = await host.ctx.storage.transaction(async (transaction) => {
    const [current, sandboxId, size] = await Promise.all([
      transaction.get<TurnRequest>("turn"),
      transaction.get<string>("sandboxId"),
      transaction.get<InstanceSize>("sandboxSize"),
    ]);
    if (!sandboxId || !exactTurnIdentityMatches(current, turn)) {
      throw new AgentTurnAuthorityLostError();
    }
    return { sandboxId, size: size ?? ("large" as const) };
  });
  const sandbox = host.sandbox(
    target.sandboxId,
    target.size,
    "world",
    undefined,
    turnSleepAfterMs(host.env, turn),
  );
  if (!(await host.sandboxContainerRunning(sandbox))) return;
  await sandbox
    .killProcess(
      sessionName(`agent-executor-${turn.turnId}-${turn.attemptGeneration}`),
      "SIGKILL",
    )
    .catch(() => undefined);
  await sandbox
    .deleteSession(agentTurnSessionId(turn.turnId))
    .catch(() => undefined);
};

export const exactAgentExecutionMarker = async (
  host: ContainerTurnHost,
  turn: TurnRequest,
): Promise<AgentExecutionMarker | undefined> => {
  const marker = await host.ctx.storage.get<AgentExecutionMarker>(
    agentExecutionMarkerKey(turn.turnId, turn.attemptGeneration!),
  );
  if (!marker) return undefined;
  if (
    marker.schemaVersion !== 1 ||
    marker.turnId !== turn.turnId ||
    marker.attemptGeneration !== turn.attemptGeneration ||
    !Number.isSafeInteger(marker.startedAt) ||
    marker.startedAt < 0 ||
    !marker.sandboxId ||
    !isInstanceSize(marker.size)
  ) {
    throw new Error("Agent execution recovery marker was invalid.");
  }
  return marker;
};

export const persistAgentExecutionMarker = async (
  host: ContainerTurnHost,
  turn: TurnRequest,
  marker: AgentExecutionMarker,
): Promise<void> => {
  await host.ctx.storage.transaction(async (txn) => {
    if (!exactTurnIdentityMatches(await txn.get<TurnRequest>("turn"), turn)) {
      throw new AgentTurnAuthorityLostError();
    }
    await txn.put(
      agentExecutionMarkerKey(turn.turnId, turn.attemptGeneration!),
      marker,
    );
  });
};

export const interruptAgentForBuilderFallback = async (
  host: ContainerTurnHost,
  turn: TurnRequest,
): Promise<void> => {
  const running = host.agentTurnExecutions.get(turn.turnId);
  if (!running) {
    await host.quiesceCurrentAgentSession(turn);
    return;
  }
  host.builderFallbackRecoveries.add(turn.turnId);
  try {
    await running.interrupt(
      new Error("The Builder is recovering this turn's durable workspace."),
    );
  } finally {
    host.builderFallbackRecoveries.delete(turn.turnId);
  }
};

const AGENT_MESSAGE_MAX_CHARS = 64_000;

export const steerContainerAgent = async (
  host: ContainerTurnHost,
  request: Request,
): Promise<Response> => {
  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const messageId = body?.messageId;
  const text = body?.text;
  if (
    typeof body?.ownerId !== "string" ||
    typeof body.ownerGeneration !== "string" ||
    typeof messageId !== "string" ||
    !messageId ||
    messageId.length > 256 ||
    typeof text !== "string" ||
    !text.trim() ||
    text.length > AGENT_MESSAGE_MAX_CHARS
  ) {
    return json({ error: "Invalid agent message." }, 400);
  }
  const [turn, terminal] = await Promise.all([
    host.ctx.storage.get<TurnRequest>("turn"),
    host.ctx.storage.get<boolean>("terminal"),
  ]);
  if (
    !turn ||
    turn.kind !== "agent" ||
    turn.agentRole === "orchestrator" ||
    !turn.threadId ||
    terminal !== false ||
    !Number.isSafeInteger(turn.attemptGeneration) ||
    turn.ownerId !== body.ownerId ||
    turn.ownerGeneration !== body.ownerGeneration ||
    (turn.execution?.engine !== "anthropic" &&
      turn.execution?.engine !== "chatgpt")
  ) {
    return json({ accepted: false, reason: "not_running" });
  }
  const marker = await host
    .exactAgentExecutionMarker(turn)
    .catch(() => undefined);
  if (!marker) return json({ accepted: false, reason: "busy" });
  const paths = cloudTurnAttemptPaths(
    await nativeStateThreadHash(turn),
    turn.attemptGeneration!,
  );
  const name = cloudTurnInboxMessageName(
    Date.now(),
    await sha256Hex(messageId),
  );
  const staged = `${CLOUD_TURN_ATTEMPT_ANCHOR}/.inbox-${crypto.randomUUID()}`;
  const sandbox = host.sandbox(marker.sandboxId, marker.size, "world");
  // Any call into a stopped container starts it again; a lost one is the
  // alarm's to recover.
  if (!(await host.sandboxContainerRunning(sandbox))) {
    return json({ accepted: false, reason: "busy" });
  }
  try {
    await withInfrastructureDeadline(
      sandbox.writeFile(staged, JSON.stringify({ text })),
      20_000,
      "Agent message staging did not settle.",
    );
    const moved = await withInfrastructureDeadline(
      sandbox.exec(
        `mv -T ${staged} ${paths.inbox}/${name} 2>/dev/null || { rm -f ${staged}; exit 1; }`,
      ),
      20_000,
      "Agent message delivery did not settle.",
    );
    if (!moved.success) return json({ accepted: false, reason: "busy" });
  } catch (error) {
    log("error", "agent_message_delivery_failed", {
      turnId: turn.turnId,
      threadId: turn.threadId,
      message: errorMessage(error),
    });
    return json({ accepted: false, reason: "busy" });
  }
  log("info", "agent_message_delivered", {
    turnId: turn.turnId,
    threadId: turn.threadId,
    attemptGeneration: turn.attemptGeneration,
  });
  return json({
    accepted: true,
    turnId: turn.turnId,
    attemptGeneration: turn.attemptGeneration,
  });
};

const DISK_EXHAUSTED_BYTES = 1_500 * 1000 ** 2;

const CONTAINER_PRESSURE_PROBE = `boot=$(cat /proc/sys/kernel/random/boot_id 2>/dev/null)
oom=$(awk '$1 == "oom_kill" { print $2 }' /proc/vmstat 2>/dev/null)
set -- $( (df -B1 --output=avail,size /workspace 2>/dev/null || df -B1 --output=avail,size /) | tail -1)
printf '%s %s %s %s\n' "\${boot:-unknown}" "\${oom:-0}" "\${1:-0}" "\${2:-0}"`;

export type ContainerOomBaseline = { bootId: string; oomKills: number };

const containerPressure = async (
  host: ContainerTurnHost,
  turn: TurnRequest,
  sandbox: ReturnType<ContainerTurnHost["sandbox"]>,
  size: InstanceSize,
): Promise<{ note: string; resizedTo?: InstanceSize } | undefined> => {
  if (!(await host.sandboxContainerRunning(sandbox))) return undefined;
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
  if (!Number.isSafeInteger(oomKills) || !Number.isFinite(availBytes)) {
    return undefined;
  }
  const baseline = await host.ctx.storage.get<ContainerOomBaseline>(
    CONTAINER_OOM_BASELINE_KEY,
  );
  const outOfMemory =
    oomKills > (baseline?.bootId === bootId ? baseline.oomKills : 0);
  await host.ctx.storage.put(CONTAINER_OOM_BASELINE_KEY, {
    bootId,
    oomKills,
  } satisfies ContainerOomBaseline);
  const outOfDisk = totalBytes > 0 && availBytes < DISK_EXHAUSTED_BYTES;
  log("info", "agent_container_pressure", {
    turnId: turn.turnId,
    threadId: turn.threadId,
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
  const stored = await host.ctx.storage.get<InstanceSize>(AGENT_CONTAINER_SIZE_KEY);
  if (next && (!isInstanceSize(stored) || stored !== next)) {
    await host.ctx.storage.put(AGENT_CONTAINER_SIZE_KEY, next);
  }
  return next
    ? {
        resizedTo: next,
        note: `[Workspace: this agent's cloud container (${describeInstanceSize(size)}) ran out of ${ran} during this run, so a command in it was killed or failed. Its next run gets a larger one (${describeInstanceSize(next)}); message it to continue.]`,
      }
    : {
        note: `[Workspace: this agent's cloud container (${describeInstanceSize(size)}) ran out of ${ran} during this run, so a command in it was killed or failed. No cloud container has more ${outOfMemory ? "memory" : "disk"}.]`,
      };
};

export const runContainerAgentTurn = async (
  host: ContainerTurnHost,
  turn: TurnRequest,
  sandboxId: string,
  execution: TurnExecutionContext,
): Promise<void> => {
  const commandTimeoutMs = Number(host.env.TURN_TIMEOUT_MS);
  const requestStarted = performance.now();
  const turnStartedAt = Date.now();
  const ownerWorld = await turnWorldName(host.env, turn);
  const idleTimeoutMs = turnSleepAfterMs(host.env, turn);
  let sandbox = host.sandbox(
    sandboxId,
    "large",
    "world",
    ownerWorld,
    idleTimeoutMs,
  );
  const sessionId = agentTurnSessionId(turn.turnId);
  const daemonDirectory = attachedToolPaths({
    turnId: turn.turnId,
    attemptGeneration: turn.attemptGeneration!,
  }).directory;
  log("info", "agent_turn_started", {
    turnId: turn.turnId,
    threadId: turn.threadId,
    sessionId: host.ctx.id.toString(),
    sandbox: sandboxId.slice(0, 16),
  });
  let prewarmed: Promise<void> | undefined;
  try {
    await host.assertAgentExecutionActive(turn, execution);
    const proposedSize: InstanceSize = initialInstanceSize({
      workspace: turn.workspace,
    });
    let size = await agentContainerSize(host.ctx.storage, proposedSize);
    await host.ctx.storage.put({
      sandboxSize: size,
      ...(turn.agentRole !== "orchestrator" && size !== "small"
        ? { [AGENT_CONTAINER_SIZE_KEY]: size }
        : {}),
    });
    execution.assertActive();
    const contextStarted = performance.now();
    const slot = acquireAgentContainerSlot(host, turn, sandboxId, execution);
    slot.catch(() => undefined);
    let prewarmMs: number | undefined;
    prewarmed = slot.then(async () => {
      const started = performance.now();
      try {
        const warming = host.sandbox(sandboxId, size, "world", ownerWorld, idleTimeoutMs);
        const wasRunning = await host.sandboxContainerRunning(warming);
        await withInfrastructureDeadline(
          warming.exec("true"),
          120_000,
          "Agent container prewarm did not settle.",
        );
        prewarmMs = Math.round(performance.now() - started);
        if (!wasRunning) {
          await warming
            .exec(SANDBOX_PAGE_CACHE_WARM_COMMAND)
            .catch(() => undefined);
        }
      } catch (error) {
        log("error", "agent_container_prewarm_failed", {
          turnId: turn.turnId,
          threadId: turn.threadId,
          message: errorMessage(error),
        });
      }
    }, () => undefined);
    await host.event(
      turn,
      "auto",
      "started",
      { threadId: turn.threadId },
      false,
      execution.signal,
    );
    execution.assertActive();

    await importAgentLogIntoThread(host, turn, execution.signal);
    execution.assertActive();
    const history = host.fetchCanonicalAgentHistory(turn, {
      excludeCurrentTurn: true,
      signal: execution.signal,
    });
    execution.assertActive();

    const canonicalHistoryCursor = await nativeHistoryCursorFromRows(history);
    let resolvedTurnState = await host.resolveAgentTurnState(
      turn,
      canonicalHistoryCursor,
    );
    execution.assertActive();
    if (resolvedTurnState.workspacePublication) {
      if (!resolvedTurnState.workspacePublication.publishable) {
        throw new AgentTurnError(
          "This workspace is still recovering a previous agent turn. Try again shortly.",
        );
      }
      host.assertAgentTurnIdentity(turn);
      await host.publishAgentTurnWorkspace(
        turn,
        canonicalHistoryCursor,
        resolvedTurnState.workspacePublication.operationId,
      );
      execution.assertActive();
      resolvedTurnState = await host.resolveAgentTurnState(
        turn,
        canonicalHistoryCursor,
      );
      execution.assertActive();
      if (resolvedTurnState.workspacePublication) {
        throw new AgentTurnError(
          "This workspace is still recovering a previous agent turn. Try again shortly.",
        );
      }
    }
    const turnStateWorkspaceRestore = resolvedTurnState.workspace;
    const turnStateThreadRestore = resolvedTurnState.restore;
    if (
      resolvedTurnState.threadRegistryPresent &&
      !turnStateThreadRestore &&
      turn.execution === undefined
    ) {
      throw new AgentTurnError(
        "This agent's saved session no longer matches its cloud conversation. Start a new agent thread to continue safely.",
      );
    }
    execution.assertActive();

    const cloudSkillHome =
      host.env.AGENT_HOME && turn.agentRole !== "orchestrator"
        ? new CloudHomeStore(host.env.AGENT_HOME, {
            control: gateHomeControl(host.env.OWNER_GATES, turn.ownerId),
            ownerId: turn.ownerId,
            ownerGeneration: turn.ownerGeneration,
            assertExternalWrite: async () =>
              await host.assertAgentExecutionActive(turn, execution),
          })
        : undefined;
    const cloudSkillCatalog = cloudSkillHome
      ? await cloudSkillHome.loadSkillCatalog("general")
      : undefined;
    execution.assertActive();

    const contextMs = Math.round(performance.now() - contextStarted);
    await slot;
    execution.assertActive();
    const slotWaitMs = Math.round(performance.now() - contextStarted);
    log("info", "agent_container_prewarm", {
      turnId: turn.turnId,
      threadId: turn.threadId,
      contextMs,
      slotWaitMs,
      ...(prewarmMs === undefined ? {} : { prewarmMs }),
    });
    sandbox = host.sandbox(sandboxId, size, "world", ownerWorld, idleTimeoutMs);
    let attempt = await host.runAgentAttempt({
      turn,
      execution,
      sandbox,
      size,
      turnStateWorkspaceRestore,
      turnStateThreadRestore,
      turnStateThreadRestoreConfirmationRequired:
        resolvedTurnState.confirmationRequired,
      history,
      cloudSkillHome,
      cloudSkillCatalog,
      commandTimeoutMs,
      sessionId,
    });
    execution.assertActive();

    const sizeAfterOom = sizeAfterOutOfMemory(size);
    if (
      attempt.oom &&
      sizeAfterOom &&
      (await host.ownsExactTurn(turn)) &&
      !(await host.ctx.storage.get<boolean>("terminal"))
    ) {
      await host.ctx.storage.delete(
        agentExecutionMarkerKey(turn.turnId, turn.attemptGeneration!),
      );
      await host.destroySandboxDurably(
        { sandboxId, size, workload: "world" },
        "agent_oom_resize",
      );
      execution.assertActive();
      size = sizeAfterOom;
      await host.ctx.storage.put({
        sandboxId,
        sandboxSize: size,
        [AGENT_CONTAINER_SIZE_KEY]: size,
      });
      execution.assertActive();
      await host.assertAgentExecutionActive(turn, execution);
      // The watchdog budget was spent on the attempt that died; without a
      // fresh one the retry is guaranteed to be cut off mid-run and the
      // escalation buys nothing.
      const watchdogDeadlineAt =
        Date.now() + Math.max(1_000, turn.watchdogMs ?? 15 * 60_000);
      await host.ctx.storage.put(
        AGENT_WATCHDOG_DEADLINE_KEY,
        watchdogDeadlineAt,
      );
      await host.ctx.storage.setAlarm(
        Math.min(watchdogDeadlineAt, Date.now() + AGENT_TURN_HEARTBEAT_MS),
      );
      execution.assertActive();
      log("info", "agent_turn_resized", {
        turnId: turn.turnId,
        threadId: turn.threadId,
        instanceType: INSTANCE_TIERS[size].instanceType,
      });
      await host
        .event(
          turn,
          "auto",
          "resized",
          {
            reason: "out_of_memory",
            instanceType: INSTANCE_TIERS[size].instanceType,
          },
          false,
          execution.signal,
        )
        .catch(() => undefined);
      execution.assertActive();
      sandbox = host.sandbox(sandboxId, size, "world", ownerWorld, idleTimeoutMs);
      attempt = await host.runAgentAttempt({
        turn,
        execution,
        sandbox,
        size,
        turnStateWorkspaceRestore,
        turnStateThreadRestore,
        turnStateThreadRestoreConfirmationRequired:
          resolvedTurnState.confirmationRequired,
        history,
        cloudSkillHome,
        cloudSkillCatalog,
        commandTimeoutMs,
        sessionId,
      });
      execution.assertActive();
    }
    const { coldContainerStartMs, restoreMs } = attempt;
    if (attempt.result.timings) {
      log("info", "agent_turn_timing", {
        turnId: turn.turnId,
        threadId: turn.threadId,
        turnStartedAt,
        executor: attempt.result.timings,
      });
    }
    let result = attempt.result;
    if (
      !(await host.ownsExactTurn(turn)) ||
      (await host.ctx.storage.get<boolean>("terminal"))
    ) {
      await host
        .releaseAgentSessionResources({
          sandboxId,
          size,
          workload: "world",
          sessionId,
          daemonDirectory,
        })
        .catch(() => undefined);
      log("info", "agent_turn_superseded", {
        turnId: turn.turnId,
        threadId: turn.threadId,
      });
      return;
    }

    const pressure =
      turn.agentRole === "orchestrator"
        ? undefined
        : await containerPressure(host, turn, sandbox, size).catch(
            () => undefined,
          );

    if (result.checkpointPolicy === "builder_fallback") {
      try {
        const marker = await host.exactAgentExecutionMarker(turn);
        if (!marker) {
          throw new Error("Agent execution recovery marker was missing.");
        }
        await host.quiesceCurrentAgentSession(turn);
        const fallbackReceipt =
          await host.reconcileAgentCheckpointAfterQuiescence(
            turn,
            marker,
            result.error ??
              "The agent stopped unexpectedly after making workspace changes.",
            result.builderFallback,
          );
        result = {
          ...result,
          checkpointPolicy: undefined,
          turnStateCheckpoint: fallbackReceipt,
        };
      } catch (error) {
        if (
          error instanceof TurnStateRegistryBookkeepingError &&
          result.builderFallback
        ) {
          await host.appendThreadTranscript(
            turn,
            result.builderFallback.messages,
          );
          const canonicalRows = host.fetchCanonicalAgentHistory(turn, {
            excludeCurrentTurn: false,
            signal: execution.signal,
          });
          if (
            (await nativeHistoryCursorFromRows(canonicalRows)) !==
            result.builderFallback.historyCursor
          ) {
            throw new Error(
              "Builder fallback transcript was not canonical after registry bookkeeping failed.",
            );
          }
          log("error", "turn_state_publish_failed", {
            turnId: turn.turnId,
            threadId: turn.threadId,
            phase: "checkpoint_registry",
            historyCursor: error.historyCursor,
            manifestId: error.manifestId,
            message: errorMessage(error.cause),
          });
          result = {
            ...result,
            checkpointPolicy: "preserve_prior",
            builderFallback: undefined,
          };
        } else {
          log("error", "agent_builder_fallback_deferred", {
            turnId: turn.turnId,
            threadId: turn.threadId,
            message: errorMessage(error),
          });
          await host.setExactTurnAlarm(turn, Date.now() + 1_000);
          return;
        }
      }
    }

    const checkpointMs =
      Number.isSafeInteger(result.checkpointMs) && result.checkpointMs! >= 0
        ? result.checkpointMs!
        : 0;
    let checkpointError: string | undefined;
    const checkpoint = result.turnStateCheckpoint;
    if (result.checkpointPolicy !== "preserve_prior") {
      if (!validTurnStateCheckpointReceipt(checkpoint)) {
        checkpointError =
          "The executor did not return a valid turn-state receipt.";
      } else {
        try {
          await host.assertAgentExecutionActive(turn, execution);
          const canonicalRows = host.fetchCanonicalAgentHistory(turn, {
            excludeCurrentTurn: false,
            signal: execution.signal,
          });
          execution.assertActive();
          if (
            (await nativeHistoryCursorFromRows(canonicalRows)) !==
            checkpoint.historyCursor
          ) {
            throw new Error(
              "The checkpoint transcript was not canonical in cloud history.",
            );
          }
          await host.publishAgentTurnWorkspace(
            turn,
            checkpoint.historyCursor,
            checkpoint.operationId,
          );
          execution.assertActive();
          const published = await host.resolveAgentTurnState(
            turn,
            checkpoint.historyCursor,
          );
          if (
            published.workspacePublication ||
            (checkpoint.manifestId !== undefined && !published.workspace) ||
            !published.restore ||
            published.restore.workspace?.manifestId !== checkpoint.manifestId
          ) {
            throw new Error(
              "The canonical turn state did not match its checkpoint receipt.",
            );
          }
        } catch (error) {
          if (!isTurnStateAuthorityError(error)) {
            log("error", "turn_state_publish_failed", {
              turnId: turn.turnId,
              threadId: turn.threadId,
              historyCursor: checkpoint.historyCursor,
              manifestId: checkpoint.manifestId,
              message: errorMessage(error),
            });
          } else {
            checkpointError = errorMessage(error);
          }
        }
      }
    }
    if (
      !(await host.ownsExactTurn(turn)) ||
      (await host.ctx.storage.get<boolean>("terminal"))
    ) {
      await host
        .releaseAgentSessionResources({
          sandboxId,
          size,
          workload: "world",
          sessionId,
          daemonDirectory,
        })
        .catch(() => undefined);
      return;
    }
    if (checkpointError) {
      log("error", "agent_turn_state_invalid", {
        turnId: turn.turnId,
        threadId: turn.threadId,
        message: checkpointError,
      });
      await host
        .event(
          turn,
          "auto",
          "checkpoint_failed",
          {
            message:
              "Stella could not validate the durable workspace receipt for this turn.",
          },
          false,
          execution.signal,
        )
        .catch(() => undefined);
      execution.assertActive();
      if (result.ok) {
        result = {
          ...result,
          ok: false,
          error:
            "Stella could not validate the durable workspace receipt for this turn. Please retry before continuing this agent.",
          finalText:
            `${result.finalText ?? ""}\n\nHeads up: Stella could not validate the durable workspace receipt for this turn. Please retry before continuing this agent.`.trim(),
        };
      }
    }

    const wallClockMs = Math.round(performance.now() - requestStarted);
    let pending: PendingTerminal;
    if (result.ok) {
      pending = {
        turnId: turn.turnId,
        attemptGeneration: turn.attemptGeneration!,
        kind: "completed",
        payload: {
          finalText: result.finalText ?? "",
          usage: result.usage,
          coldContainerStartMs,
          restoreMs,
          checkpointMs,
          wallClockMs,
          instanceType: INSTANCE_TIERS[size].instanceType,
        },
      };
      if (pressure) {
        pending.payload = {
          ...pending.payload,
          finalText: `${result.finalText ?? ""}\n\n${pressure.note}`.trim(),
        };
      }
    } else {
      let message = result.error ?? "The agent failed.";
      if (pressure) message = `${message}\n\n${pressure.note}`;
      if (checkpointError) {
        message = `${message} Do not continue this agent until the turn is retried.`;
      }
      pending = {
        turnId: turn.turnId,
        attemptGeneration: turn.attemptGeneration!,
        kind: "failed",
        payload: { message },
        threadError: message,
      };
    }
    if (result.ok && turn.agentRole !== "orchestrator") {
      const move = await takeAgentMove(host.ctx.storage, host.env, turn);
      if (move && "failed" in move && pending.kind === "completed") {
        const finalText = (pending.payload as { finalText?: string }).finalText ?? "";
        pending = {
          ...pending,
          payload: {
            ...(pending.payload as Record<string, unknown>),
            finalText: `${finalText}\n\n[switch_destination: the move did not happen: ${move.failed} The agent still runs in the cloud; message it to carry on there.]`.trim(),
          },
        } as PendingTerminal;
      }
    }
    const delivered = await host.deliverTerminal(turn, pending);
    await host
      .releaseAgentSessionResources({
        sandboxId,
        size,
        workload: "world",
        sessionId,
        daemonDirectory,
        ...(pressure?.resizedTo ? { warm: false } : {}),
      })
      .catch(() => undefined);
    if (delivered && (await host.ownsExactTurn(turn))) {
      if (await host.settleAgentTransientBackup(turn)) {
        await host.deleteTurnStoragePreservingExactCancellations(turn, true);
      } else {
        await host.setExactTurnAlarm(turn, Date.now() + 30_000);
      }
    }
    log("info", "agent_turn_finished", {
      turnId: turn.turnId,
      threadId: turn.threadId,
      ok: result.ok,
      wallClockMs,
    });
    emitCloudTurnTelemetry(host.ctx, host.env, turn, {
      type: "cloud.turn",
      workload: "agent",
      phase: result.ok ? "completed" : "failed",
      wallClockMs,
      coldContainerStartMs,
      restoreMs,
      checkpointMs,
      ...(typeof result.usage?.inputTokens === "number"
        ? { inputTokens: result.usage.inputTokens }
        : {}),
      ...(typeof result.usage?.outputTokens === "number"
        ? { outputTokens: result.usage.outputTokens }
        : {}),
      ...(typeof result.usage?.llmCalls === "number"
        ? { llmCalls: result.usage.llmCalls }
        : {}),
      instanceType: INSTANCE_TIERS[size].instanceType,
    });
  } catch (error) {
    await prewarmed;
    const message = errorMessage(error);
    if (host.builderFallbackRecoveries.has(turn.turnId)) {
      log("info", "agent_turn_yielded_to_builder_fallback", {
        turnId: turn.turnId,
        threadId: turn.threadId,
        message,
      });
      return;
    }
    let executionMarker: AgentExecutionMarker | undefined;
    try {
      executionMarker = await host.exactAgentExecutionMarker(turn);
    } catch (markerError) {
      log("error", "agent_recovery_marker_invalid", {
        turnId: turn.turnId,
        threadId: turn.threadId,
        message: errorMessage(markerError),
      });
      await host.setExactTurnAlarm(turn, Date.now() + 30_000);
      return;
    }
    if (
      executionMarker &&
      !(
        error instanceof CapturedSessionAbandonedError &&
        error.disposition === "compute_released"
      ) &&
      !(error instanceof AgentTurnAuthorityLostError) &&
      !(error instanceof OwnerPurgeFenceError) &&
      (await host.ownsExactTurn(turn)) &&
      !(await host.ctx.storage.get<boolean>("terminal"))
    ) {
      log("error", "agent_turn_recovery_scheduled", {
        turnId: turn.turnId,
        threadId: turn.threadId,
        message,
      });
      await host.mutateExactTurn(turn, async (txn) => {
        await txn.put(AGENT_RECOVERY_PENDING_KEY, agentRecoveryIdentity(turn));
        await txn.setAlarm(Date.now() + 1_000);
      });
      return;
    }
    if (await host.ctx.storage.get<boolean>("terminal")) return;
    try {
      await host.terminateCurrentAgentSession(turn);
    } catch (releaseError) {
      log("error", "agent_session_release_deferred", {
        turnId: turn.turnId,
        threadId: turn.threadId,
        message: errorMessage(releaseError),
      });
      await host.claimTerminalDecision(
        turn,
        {
          turnId: turn.turnId,
          attemptGeneration: turn.attemptGeneration!,
          kind: "failed",
          payload: {
            message: "The agent hit a problem and stopped. Try again.",
          },
          threadError: "The agent hit a problem and stopped. Try again.",
          terminateSandbox: true,
        },
        Date.now() + 30_000,
      );
      return;
    }
    const failureCode = classifyAgentFailureDiagnostic(message);
    log("error", "agent_turn_failed", {
      turnId: turn.turnId,
      threadId: turn.threadId,
      message,
      failureCode,
    });
    if (error instanceof AgentTurnAuthorityLostError) {
      log("info", "agent_turn_authority_lost", {
        turnId: turn.turnId,
        threadId: turn.threadId,
        attemptGeneration: turn.attemptGeneration,
      });
      return;
    }
    if (!(await host.ownsExactTurn(turn))) return;
    if (await host.ctx.storage.get<boolean>("terminal")) return;
    if (error instanceof OwnerPurgeFenceError) {
      try {
        await host.cleanupOwnerPurgedTurnStorage(turn);
      } catch (cleanupError) {
        log("error", "owner_purge_agent_cleanup_failed", {
          turnId: turn.turnId,
          message: errorMessage(cleanupError),
        });
      }
      return;
    }
    const friendly =
      error instanceof AgentTurnError
        ? error.userMessage
        : devAcceptanceProbesEnabled(host.env)
          ? `${agentFailureMessage(failureCode, turn.turnId)} [diagnostic: turn.${failureCode}]`
          : agentFailureMessage(failureCode, turn.turnId);
    const delivered = await host.deliverTerminal(turn, {
      turnId: turn.turnId,
      attemptGeneration: turn.attemptGeneration!,
      kind: "failed",
      payload: { message: friendly },
      threadError: friendly,
    });
    if (delivered && (await host.ownsExactTurn(turn))) {
      if (await host.settleAgentTransientBackup(turn)) {
        await host.deleteTurnStoragePreservingExactCancellations(turn, true);
      } else {
        await host.setExactTurnAlarm(turn, Date.now() + 30_000);
      }
    }
  } finally {
    await host.unregisterTurn(turn);
  }
};

export const attachAgentWorld = async (
  host: ContainerTurnHost,
  args: {
    turn: TurnRequest;
    execution: TurnExecutionContext;
    sandbox: ReturnType<BuildSessionInternals["sandbox"]>;
    size: InstanceSize;
    turnStateWorkspaceRestore?: TurnStateWorkspaceHead;
    turnStateThreadRestore?: TurnStateCandidate;
    turnStateThreadRestoreConfirmationRequired: boolean;
    history: AgentHistoryRow[];
    commandTimeoutMs: number;
    sessionId: string;
  },
): Promise<{
  session: ExecutionSession;
  coldContainerStartMs: number;
  restoreMs: number;
  adoptedSession?: { sessionId: string; cliVersion: string; hydrated?: true };
  nativeRestored: boolean;
}> => {
  const { turn, execution: turnExecution, sandbox } = args;
  const worldRoot = WORLD_ROOT;
  const attachStarted = performance.now();
  const phaseMs = (started: number): number =>
    Math.min(60 * 60_000, Math.max(0, Math.round(performance.now() - started)));
  const coldStarted = performance.now();
  await host.assertAgentExecutionActive(turn, turnExecution);
  const worldNameStarted = performance.now();
  const worldNamePreparation = turnWorldName(host.env, turn).then(
    (name) => ({ ok: true as const, name }),
    (error: unknown) => ({ ok: false as const, error }),
  );
  const sessionOptions = {
    id: args.sessionId,
    cwd: "/opt/stella",
    commandTimeoutMs: args.commandTimeoutMs,
    env: executorSessionEnvironment(),
  };
  // A failed attach leaves its session behind in the agent's container; the
  // retry owns the same id, so an existing session is replaced, never reused.
  const session = await sandbox
    .createSession(sessionOptions)
    .catch(async (error: unknown) => {
      if (!/already exists/iu.test(errorMessage(error))) throw error;
      await sandbox.deleteSession(args.sessionId).catch(() => undefined);
      return await sandbox.createSession(sessionOptions);
    });
  turnExecution.assertActive();
  const coldContainerStartMs = phaseMs(coldStarted);

  let restoreMs = 0;
  const initialNormalizeStarted = performance.now();
  await normalizeToolWorkspaceRoot(session, worldRoot);
  const initialNormalizeMs = phaseMs(initialNormalizeStarted);
  turnExecution.assertActive();
  const restoreStarted = performance.now();
  const materializeWorld = turn.agentRole !== "orchestrator";
  const preparedName = await worldNamePreparation;
  if (!preparedName.ok) {
    await sandbox.deleteSession(args.sessionId).catch(() => undefined);
    throw preparedName.error;
  }
  const worldNameMs = phaseMs(worldNameStarted);
  const { name } = preparedName;
  let capabilityMs = 0;
  let materializationMs = 0;
  if (materializeWorld) {
    const capabilityStarted = performance.now();
    const capability = await issueWorldCapability({
      secret: builderServiceSecret(host.env),
      worldName: name,
      turnId: turn.turnId,
      attemptGeneration: turn.attemptGeneration!,
      now: Date.now(),
      ttlMs: Math.max(1, Math.min(30 * 60_000, args.commandTimeoutMs)),
    });
    capabilityMs = phaseMs(capabilityStarted);
    const origin = host.env.CLOUD_BUILDER_PUBLIC_URL.replace(/\/+$/u, "");
    const exportUrl = new URL(`${origin}/internal/worlds/${name}/export`);
    const materializationStarted = performance.now();
    const materialized = await session.exec(
      worldMaterializationCommand({
        worldRoot,
        exportUrl: exportUrl.toString(),
        capability,
      }),
      { timeout: args.commandTimeoutMs },
    );
    if (!materialized.success)
      throw new AgentTurnError(worldMaterializationFailure(materialized));
    await normalizeToolWorkspaceRoot(session, worldRoot);
    turnExecution.assertActive();
    materializationMs = phaseMs(materializationStarted);
  }
  restoreMs = phaseMs(restoreStarted);

  let nativeRestoreMs = 0;
  let nativeRestore: "current" | "restored" | undefined;
  let adoptedSession: { sessionId: string; cliVersion: string; hydrated?: true } | undefined;
  const orchestratorSpec =
    turn.agentRole === "orchestrator"
      ? (turn.orchestratorCli ??
        readOrchestratorCliSpec(host.ctx.storage.sql, {
          turnId: turn.turnId,
          attemptGeneration: turn.attemptGeneration!,
        }))
      : undefined;
  const replacesSession = Boolean(orchestratorSpec?.hydrateSession || orchestratorSpec?.startFresh);
  const nativeArchive = replacesSession ? undefined : args.turnStateThreadRestore?.native;
  if (turn.execution?.engine === "anthropic" && !nativeArchive) {
    const stateRoot = cloudNativeStateRoot(await nativeStateThreadHash(turn));
    const clear = async () => {
      const cleared = await session.exec(`rm -rf -- ${stateRoot}`, {
        timeout: args.commandTimeoutMs,
      });
      if (!cleared.success) {
        throw new AgentTurnError(
          "Stella could not rebuild this thread's Claude session.",
        );
      }
      turnExecution.assertActive();
    };
    await clear();
    const hydrateSession = orchestratorSpec?.hydrateSession;
    const adopt = orchestratorSpec?.startFresh || hydrateSession ? undefined : orchestratorSpec?.adoptSession;
    if (hydrateSession && turn.conversationId) {
      const hydrateStarted = performance.now();
      adoptedSession = await writeHydratedClaudeSession({
        bucket: host.env.BACKUP_BUCKET,
        ownerId: turn.ownerId,
        conversationId: turn.conversationId,
        sessionId: hydrateSession,
        session,
        stateRoot,
      }).catch((error: unknown) => {
        log("error", "claude_session_hydration_failed", {
          turnId: turn.turnId,
          message: errorMessage(error),
        });
        return undefined;
      });
      if (!adoptedSession) await clear();
      nativeRestoreMs = phaseMs(hydrateStarted);
    } else if (adopt) {
      const adoptStarted = performance.now();
      adoptedSession = await writeAdoptedClaudeSession({
        gates: host.env.OWNER_GATES,
        ownerId: turn.ownerId,
        ownerGeneration: turn.ownerGeneration,
        session,
        stateRoot,
        adopt,
      }).catch((error: unknown) => {
        log("error", "claude_session_adoption_failed", {
          turnId: turn.turnId,
          message: errorMessage(error),
        });
        return undefined;
      });
      if (!adoptedSession) await clear();
      nativeRestoreMs = phaseMs(adoptStarted);
    }
  }
  if (nativeArchive) {
    const nativeRestoreStarted = performance.now();
    turnExecution.assertActive();
    nativeRestore = await restoreTurnStateArchive({
      session,
      bucket: host.env.BACKUP_BUCKET,
      archive: nativeArchive,
      target: { kind: "native", threadHash: await nativeStateThreadHash(turn) },
    });
    turnExecution.assertActive();
    nativeRestoreMs = phaseMs(nativeRestoreStarted);
    restoreMs = Math.min(60 * 60_000, restoreMs + nativeRestoreMs);
  }
  turnExecution.assertActive();
  const confirmationStarted = performance.now();
  if (args.turnStateThreadRestore) {
    await host.confirmAgentTurnStateRestore(
      turn,
      await nativeHistoryCursorFromRows(args.history),
      args.turnStateThreadRestore,
      args.turnStateThreadRestoreConfirmationRequired,
    );
    turnExecution.assertActive();
  }
  log("info", "agent_world_attached", {
    turnId: turn.turnId,
    threadId: turn.threadId,
    coldContainerStartMs,
    worldNameMs,
    initialNormalizeMs,
    capabilityMs,
    materializationMs,
    nativeRestoreMs,
    ...(nativeRestore ? { nativeRestore } : {}),
    restoreConfirmationMs: phaseMs(confirmationStarted),
    totalAttachMs: phaseMs(attachStarted),
  });
  return {
    session,
    coldContainerStartMs,
    restoreMs,
    ...(adoptedSession ? { adoptedSession } : {}),
    nativeRestored: nativeArchive !== undefined,
  };
};

export const runAgentAttempt = async (
  host: ContainerTurnHost,
  args: {
    turn: TurnRequest;
    execution: TurnExecutionContext;
    sandbox: ReturnType<BuildSessionInternals["sandbox"]>;
    size: InstanceSize;
    turnStateWorkspaceRestore?: TurnStateWorkspaceHead;
    turnStateThreadRestore?: TurnStateCandidate;
    turnStateThreadRestoreConfirmationRequired: boolean;
    history: AgentHistoryRow[];
    cloudSkillHome?: CloudHomeStore;
    cloudSkillCatalog?: CloudSkillCatalogSnapshot;
    commandTimeoutMs: number;
    sessionId: string;
  },
): Promise<{
  result: AgentExecutorResult;
  oom: boolean;
  coldContainerStartMs: number;
  restoreMs: number;
}> => {
  const { turn, execution: turnExecution, sandbox } = args;
  const setupMs: Record<string, number> = {};
  let setupMark = performance.now();
  const setupStep = (name: string) => {
    const now = performance.now();
    setupMs[name] = Math.round(now - setupMark);
    setupMark = now;
  };
  const world = await host.attachAgentWorld(args);
  setupStep("attachWorld");
  const { session, coldContainerStartMs, restoreMs, adoptedSession, nativeRestored } = world;
  const sandboxReadyEvent = host.event(
    turn,
    "auto",
    "sandbox_ready",
    {
      coldContainerStartMs,
      restoreMs,
      restored: Boolean(args.turnStateWorkspaceRestore),
      instanceType: INSTANCE_TIERS[args.size].instanceType,
    },
    false,
    turnExecution.signal,
  );
  sandboxReadyEvent.catch(() => undefined);
  let claudeLoginsMs: Record<string, number> | undefined;
  const claudeLogins = (async () => {
    if (turn.execution?.engine !== "anthropic") return null;
    const started = performance.now();
    const account = await claudeCloudAccountFor(host.env, turn);
    const accountAt = performance.now();
    await restoreClaudeCloudLogins(host.env, turn.ownerId, sandbox);
    const restoredAt = performance.now();
    if (account.email === TEST_CLAUDE_EMAIL && testClaudeConfigured(host.env)) {
      await seedTestClaudeLogin(host.env, turn.ownerId, sandbox);
    }
    claudeLoginsMs = {
      account: Math.round(accountAt - started),
      restore: Math.round(restoredAt - accountAt),
      testSeed: Math.round(performance.now() - restoredAt),
    };
    return account;
  })();
  claudeLogins.catch(() => undefined);
  let skillsMs: number | undefined;
  const skillsReady = (async () => {
    if (!args.cloudSkillHome || !args.cloudSkillCatalog) return undefined;
    const started = performance.now();
    turnExecution.assertActive();
    const materialized = await materializeCloudSkillSnapshot({
      home: args.cloudSkillHome,
      snapshot: args.cloudSkillCatalog,
      session,
      assertActive: () => turnExecution.assertActive(),
    });
    turnExecution.assertActive();
    await mirrorCloudSkillsIntoHome({ session, catalog: materialized }).catch(
      (error: unknown) => {
        log("error", "cloud_skills_home_mirror_failed", {
          turnId: turn.turnId,
          message: errorMessage(error),
        });
      },
    );
    turnExecution.assertActive();
    skillsMs = Math.round(performance.now() - started);
    return materialized;
  })();
  skillsReady.catch(() => undefined);

  const nativeStateIntegrityKey = await nativeStateIntegrityKeyFor(
    host.env,
    turn,
  );
  const nativeStatePreviousIntegrityKeys = (
    await nativeStateIntegrityKeysFor(host.env, turn)
  ).filter((key) => key !== nativeStateIntegrityKey);
  turnExecution.assertActive();

  if (!turn.turnBrokerRoute) {
    throw new AgentTurnAuthorityLostError();
  }
  const brokerIdentity = {
    sessionId: turn.turnBrokerRoute.sessionId,
    ownerId: turn.ownerId,
    ownerGeneration: turn.ownerGeneration,
    turnId: turn.turnId,
    attemptGeneration: turn.attemptGeneration!,
  };
  const issuedBroker = await issueTurnBrokerCredential({
    identity: brokerIdentity,
    endpoint: turn.turnBrokerRoute.endpoint,
    now: Date.now(),
    ttlMs: Math.max(1, Math.min(TURN_BROKER_MAX_TTL_MS, args.commandTimeoutMs)),
  });
  const brokerRecordKey = turnBrokerStorageKey(brokerIdentity);
  await host.ctx.storage.put(brokerRecordKey, issuedBroker.record);
  turnExecution.assertActive();
  setupStep("brokerIssue");
  const attemptPaths = cloudTurnAttemptPaths(
    await nativeStateThreadHash(turn),
    turn.attemptGeneration!,
  );
  const brokerCredentialsPath = turnBrokerCredentialsPath(
    attemptPaths.directory,
  );
  let credentialsPath: string | undefined;
  let execution: Execution | undefined;
  let capturedExecutionError: unknown;
  let recordedExecutorResultText: string | undefined;
  let recordedResultProcessQuiesced = false;
  try {
    const createdAttemptDirectory = await session.exec(
      `mkdir -p ${CLOUD_TURN_ATTEMPT_ANCHOR} && chmod 700 ${CLOUD_TURN_ATTEMPT_ANCHOR} && rm -rf ${attemptPaths.directory} && mkdir -m 700 ${attemptPaths.directory}`,
    );
    if (!createdAttemptDirectory.success) {
      throw new Error("Turn attempt directory could not be created.");
    }
    turnExecution.assertActive();
    setupStep("mkdirAttempt");
    await session.writeFile(
      brokerCredentialsPath,
      JSON.stringify(issuedBroker.handoff),
    );
    setupStep("writeCredentials");
    const protectedBrokerHandoff = await session.exec(
      `chmod 600 ${brokerCredentialsPath}`,
    );
    if (!protectedBrokerHandoff.success) {
      throw new Error("Turn broker handoff could not be protected.");
    }
    turnExecution.assertActive();
    setupStep("chmodCredentials");

    if (!turn.execution) throw new AgentTurnAuthorityLostError();
    const orchestrator = turn.agentRole === "orchestrator";
    const claudeAccount = await claudeLogins;
    turnExecution.assertActive();
    setupStep("claudeLoginsWait");
    const cloudSkills = await skillsReady;
    await sandboxReadyEvent;
    turnExecution.assertActive();
    setupStep("skillsWait");

    turnExecution.assertActive();
    const devicesSection = await agentDevicesSection(host.env, turn);
    let roleInput: CloudCliTurnRoleInput = {
      role: "agent",
      systemPrompt: [
        renderCloudAgentPrompt("agents/general.md", {
          names: [...cloudGeneralToolNames(), CLOUD_AGENT_MOVE_TOOL],
          history: true,
        }),
        ...(devicesSection ? [devicesSection] : []),
      ].join("\n\n"),
    };
    if (orchestrator) {
      const spec =
        turn.orchestratorCli ??
        readOrchestratorCliSpec(host.ctx.storage.sql, {
          turnId: turn.turnId,
          attemptGeneration: turn.attemptGeneration!,
        });
      if (!spec) {
        throw new AgentTurnError(
          "Stella lost this message's instructions before it could run. Try again.",
        );
      }
      roleInput = { role: "orchestrator", ...spec };
    }
    await session.writeFile(
      attemptPaths.input,
      JSON.stringify({
        ...roleInput,
        kind: "agent",
        ownerId: turn.ownerId,
        ownerGeneration: turn.ownerGeneration,
        conversationId: turn.conversationId,
        threadId: turn.threadId,
        turnId: turn.turnId,
        attemptGeneration: turn.attemptGeneration,
        prompt: turn.prompt,
        workspaceRestored: Boolean(args.turnStateWorkspaceRestore),
        nativeStateIntegrityKey,
        ...(nativeStatePreviousIntegrityKeys.length > 0
          ? { nativeStatePreviousIntegrityKeys }
          : {}),
        rebuildNativeSession:
          turn.execution?.engine === "anthropic" &&
          !nativeRestored &&
          !adoptedSession,
        ...(adoptedSession ? { adoptedNativeSession: adoptedSession } : {}),
        turnBroker: { credentialsPath: brokerCredentialsPath },
        world: {
          origin: host.env.CLOUD_BUILDER_PUBLIC_URL.replace(/\/+$/u, ""),
          name: await turnWorldName(host.env, turn),
          capability: await issueWorldCapability({
            secret: builderServiceSecret(host.env),
            worldName: await turnWorldName(host.env, turn),
            turnId: turn.turnId,
            attemptGeneration: turn.attemptGeneration!,
            now: Date.now(),
            ttlMs: Math.max(1, Math.min(30 * 60_000, args.commandTimeoutMs)),
          }),
        },
        ...(claudeAccount ? { claudeAccount } : {}),
        history: args.history,
        ...(cloudSkills ? { skills: cloudSkills } : {}),
        ...(turn.execution ? { execution: turn.execution } : {}),
      }),
    );
    turnExecution.assertActive();
    setupStep("writeInput");
    const markerKey = agentExecutionMarkerKey(
      turn.turnId,
      turn.attemptGeneration!,
    );
    turnExecution.assertActive();
    log("info", "agent_executor_admission_started", {
      turnId: turn.turnId,
      threadId: turn.threadId,
      attemptGeneration: turn.attemptGeneration,
      coldContainerStartMs,
      restoreMs,
      setupMs,
      ...(claudeLoginsMs === undefined ? {} : { claudeLoginsMs }),
      ...(skillsMs === undefined ? {} : { skillsMs }),
    });
    const executorProcessId = sessionName(
      `agent-executor-${turn.turnId}-${turn.attemptGeneration}`,
    );
    const resultPollCancellation = createTurnRetryCancellation();
    const captureOutcome = capturedSessionExec(
      sandbox,
      [
        SANDBOX_EXECUTOR,
        "--agent-turn",
        CLOUD_TURN_ATTEMPT_DIRECTORY_FLAG,
        attemptPaths.directory,
      ],
      args.commandTimeoutMs,
      {
        cwd: "/opt/stella",
        env: executorSessionEnvironment(),
        resultTimeoutMs: 10_000,
        processId: executorProcessId,
        signal: turnExecution.signal,
        onAbandon: async ({ phase, processId }) => {
          if (phase === "process_unsettled") {
            try {
              await withInfrastructureDeadline(
                sandbox.killProcess(processId, "SIGKILL"),
                35_000,
                "Captured session process kill did not settle.",
              );
              return "session_quiesced" as const;
            } catch {
              // A kill ambiguity must not reach Builder fallback. Fence a
              // generic terminal result before rotating the sandbox lifetime;
              // alarm replay will only retry teardown/delivery, never archive
              // a newly recreated empty container.
            }
          }
          const teardownPending: PendingTerminal = {
            turnId: turn.turnId,
            attemptGeneration: turn.attemptGeneration!,
            kind: "failed",
            payload: {
              message: "The agent hit a problem and stopped. Try again.",
            },
            threadError: "The agent hit a problem and stopped. Try again.",
            terminateSandbox: true,
          };
          await host.claimTerminalDecision(
            turn,
            teardownPending,
            Date.now() + 1_000,
          );
          await host.terminateCurrentAgentSession(turn);
          await host.ctx.storage
            .transaction(async (transaction) => {
              if (
                exactTurnIdentityMatches(
                  await transaction.get<TurnRequest>("turn"),
                  turn,
                )
              ) {
                await transaction.delete(markerKey);
              }
            })
            .catch((error) => {
              log("error", "agent_execution_marker_cleanup_deferred", {
                turnId: turn.turnId,
                threadId: turn.threadId,
                message: errorMessage(error),
              });
            });
          return "compute_released" as const;
        },
        onStarted: async () => {
          turnExecution.assertActive();
          const marker = await host.ctx.storage.transaction(
            async (transaction): Promise<AgentExecutionMarker> => {
              const [current, currentSandboxId, currentSize] =
                await Promise.all([
                  transaction.get<TurnRequest>("turn"),
                  transaction.get<string>("sandboxId"),
                  transaction.get<InstanceSize>("sandboxSize"),
                ]);
              if (
                !exactTurnIdentityMatches(current, turn) ||
                !currentSandboxId ||
                currentSize !== args.size
              ) {
                throw new AgentTurnAuthorityLostError();
              }
              const value: AgentExecutionMarker = {
                schemaVersion: 1,
                turnId: turn.turnId,
                attemptGeneration: turn.attemptGeneration!,
                sandboxId: currentSandboxId,
                size: args.size,
                startedAt: Date.now(),
              };
              await transaction.put(markerKey, value);
              return value;
            },
          );
          if (marker.turnId !== turn.turnId) {
            throw new AgentTurnAuthorityLostError();
          }
          turnExecution.assertActive();
          log("info", "agent_executor_process_started", {
            turnId: turn.turnId,
            threadId: turn.threadId,
            attemptGeneration: turn.attemptGeneration,
          });
        },
      },
    ).then(
      (capturedExecution) =>
        ({
          kind: "execution" as const,
          execution: capturedExecution,
        }) as const,
      (error: unknown) =>
        ({ kind: "execution_error" as const, error }) as const,
    );
    const resultFileOutcome = waitForCloudAgentTurnResultText(
      session,
      attemptPaths.result,
      [turnExecution.signal],
      resultPollCancellation,
    ).then(
      (resultText) => ({ kind: "result_file" as const, resultText }) as const,
      (error: unknown) =>
        ({ kind: "result_file_error" as const, error }) as const,
    );
    const firstOutcome = await Promise.race([
      captureOutcome,
      resultFileOutcome,
    ]);
    resultPollCancellation.abort(
      new Error("Agent process observation already settled."),
    );
    if (firstOutcome.kind === "execution") {
      execution = firstOutcome.execution;
      recordedResultProcessQuiesced = true;
    } else if (firstOutcome.kind === "execution_error") {
      capturedExecutionError = firstOutcome.error;
      recordedResultProcessQuiesced = !(
        firstOutcome.error instanceof CapturedSessionAbandonedError
      );
    } else if (firstOutcome.kind === "result_file_error") {
      throw firstOutcome.error;
    } else {
      recordedExecutorResultText = firstOutcome.resultText;
      const captureAfterFile = await Promise.race([
        captureOutcome,
        runToolEffect(
          Effect.sleep(1_000).pipe(
            Effect.as({ kind: "capture_pending" as const }),
          ),
        ),
      ]);
      if (captureAfterFile.kind === "execution") {
        execution = captureAfterFile.execution;
        recordedResultProcessQuiesced = true;
      } else if (captureAfterFile.kind === "execution_error") {
        capturedExecutionError = captureAfterFile.error;
        recordedResultProcessQuiesced =
          !(captureAfterFile.error instanceof CapturedSessionAbandonedError) ||
          captureAfterFile.error.disposition === "session_quiesced";
      } else {
        await withInfrastructureDeadline(
          sandbox.killProcess(executorProcessId, "SIGKILL"),
          10_000,
          "Completed agent executor could not be quiesced.",
        );
        recordedResultProcessQuiesced = true;
      }
    }
    turnExecution.assertActive();
  } catch (error) {
    capturedExecutionError = error;
  } finally {
    recordedExecutorResultText ??= await readCloudAgentTurnResultText(
      session,
      attemptPaths.result,
    ).catch((error: unknown) => {
      capturedExecutionError ??= error;
      return undefined;
    });
    if (credentialsPath) {
      await session.deleteFile(credentialsPath).catch(() => undefined);
    }
    await session.deleteFile(brokerCredentialsPath).catch(() => undefined);
    await session
      .exec(`rm -rf ${attemptPaths.directory}`)
      .catch(() => undefined);
    if (turn.execution?.engine === "anthropic") {
      await backupClaudeCloudLogins(host.env, turn.ownerId, sandbox).catch(
        () => false,
      );
    }
    await host.ctx.storage.transaction(async (txn) => {
      const current = await txn.get<TurnBrokerRecord>(brokerRecordKey);
      if (
        current?.capabilityHash === issuedBroker.record.capabilityHash &&
        current.state === "active"
      ) {
        await txn.put(
          brokerRecordKey,
          revokeTurnBrokerCredential(current, Date.now()),
        );
      }
    });
  }
  let recordedExecutorResult: AgentExecutorResult | null = null;
  if (recordedExecutorResultText) {
    try {
      recordedExecutorResult = parsePublishedExecutorResult(
        recordedExecutorResultText,
      );
    } catch (error) {
      capturedExecutionError ??= error;
    }
  }
  if (
    recordedExecutorResult &&
    recordedResultProcessQuiesced &&
    !turnExecution.signal.aborted
  ) {
    log("info", "agent_executor_result_file_recovered", {
      turnId: turn.turnId,
      threadId: turn.threadId,
    });
    return {
      result: recordedExecutorResult,
      oom: false,
      coldContainerStartMs,
      restoreMs,
    };
  }
  if (capturedExecutionError) {
    throw capturedExecutionError;
  }
  if (!execution) {
    throw new Error("Captured agent executor returned no process result.");
  }
  if (execution.success) {
    try {
      const parsed =
        recordedExecutorResult ??
        parseAgentExecutorResult(
          JSON.parse(
            execution.stdout.trim().split("\n").at(-1) ?? "{}",
          ) as unknown,
        );
      if (!parsed) throw new Error("invalid agent executor result");
      return {
        result: parsed,
        oom: false,
        coldContainerStartMs,
        restoreMs,
      };
    } catch {
      return {
        result: {
          ok: false,
          error: "The agent's report was unreadable.",
          checkpointPolicy: "builder_fallback",
        },
        oom: false,
        coldContainerStartMs,
        restoreMs,
      };
    }
  }
  const oom = isOutOfMemoryFailure({
    exitCode: execution.exitCode,
    stdout: execution.stdout,
    stderr: execution.stderr,
  });
  const failureCode = classifyAgentFailureDiagnostic(execution.stderr);
  log("error", "agent_executor_failed", {
    turnId: turn.turnId,
    threadId: turn.threadId,
    oom,
    instanceType: INSTANCE_TIERS[args.size].instanceType,
    failureCode,
  });
  return {
    result: {
      ok: false,
      error: oom
        ? "The agent ran out of memory and stopped. Try again with a smaller slice of the work."
        : devAcceptanceProbesEnabled(host.env)
          ? `${agentFailureMessage(failureCode, turn.turnId)} [diagnostic: executor.${failureCode}]`
          : agentFailureMessage(failureCode, turn.turnId),
      checkpointPolicy: oom ? "preserve_prior" : "builder_fallback",
    },
    oom,
    coldContainerStartMs,
    restoreMs,
  };
};

const claudeCloudAccountFor = async (
  env: Env,
  turn: TurnRequest,
): Promise<{ key: string; email: string }> => {
  const response = (await ownerGateStub(env.OWNER_GATES, turn.ownerId).ownerInternal({
    name: "engines.claudeCloudAccount",
    args: {},
    ownerGeneration: turn.ownerGeneration,
  })) as unknown as RpcResponse;
  if (!response.ok) {
    if (response.error.reason === "owner_generation_stale") {
      throw new AgentTurnAuthorityLostError();
    }
    throw new Error("Your Claude account selection couldn't be read. Try again.");
  }
  const value = response.value as
    | { key: string; email: string }
    | { missing: true; email?: string };
  if ("missing" in value) {
    throw new AgentTurnError(
      value.email
        ? `Claude isn't signed in to ${value.email} in your cloud. Sign in under Settings > Account > Claude, or pick another model.`
        : "No Claude account is signed in in your cloud. Sign in under Settings > Account > Claude, or pick another model.",
    );
  }
  return value;
};
