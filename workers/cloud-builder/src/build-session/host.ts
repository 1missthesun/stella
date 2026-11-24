import { ownerFenceClient, type OwnerFenceClient } from "../owner-fence-client.js";
import type { ExecutionSession } from "../sandbox-client.js";
import type {
  TurnBrokerTurnStateCheckpointReceipt,
  TurnBrokerTurnStateCheckpointRequest,
} from "@stella/contracts/turn-credential-broker";
import type { OwnerEvent } from "@stella/contracts/turn-plane/owner-events";
import type { AgentHistoryRow } from "@stella/executor-cloud/agent-history";
import type {
  CloudHomeStore,
  CloudSkillCatalogSnapshot,
} from "../cloud-home-store.js";
import {
  type ExactTurnCancellation,
  ExactTurnCancellationLedger,
  type ExactTurnCancellationRequest,
} from "../execution-placement-turn-cancellation.js";
import type { SandboxHandle } from "../sandbox-client.js";
import type { InstanceSize } from "../instance-size.js";
import type { OwnerGate } from "../owner-gate.js";
import type { SandboxTarget, SandboxWorkload } from "../sandbox-lifecycle.js";
import type { ThreadMessageInput } from "../thread-transcript.js";
import type {
  TurnExecution,
  TurnExecutionContext,
} from "../turn-cancellation.js";
import type {
  ResolvedTurnState,
  TurnStateCandidate,
  TurnStateWorkspaceHead,
} from "../turn-state-registry.js";
import {
  agentTurnAccepted,
  runAgentTurn,
  startAgentTurn,
} from "./admission.js";
import {
  advanceBuilderFallback,
  ensureBuilderFallbackTranscript,
  reconcileAgentCheckpointAfterQuiescence,
  recoverAgentTurnAfterExecutorLoss,
  runAlarm,
  runAlarmWithLease,
} from "./alarms-recovery.js";
import {
  attachAgentWorld,
  exactAgentExecutionMarker,
  interruptAgentForBuilderFallback,
  quiesceCurrentAgentSession,
  runAgentAttempt,
  runContainerAgentTurn,
} from "./container-turn.js";
import {
  armOwnerFenceLeaseReconciliationAlarm,
  hasOwnerFenceLeaseRetirementDebt,
  ownerFenceLeaseSlotKey,
  ownerFenceReceiptMatches,
  registerBuildOwnerFenceLease,
  retireBuildOwnerFenceLease,
} from "./owner-fence-leases.js";
import {
  appendThreadTranscript,
  assertAgentExecutionActive,
  assertAgentTurnIdentity,
  assertTurnWritable,
  callOwnerTurnState,
  cleanupOwnerPurgedTurnStorage,
  cleanupTransientWrites,
  deleteTurnStoragePreservingExactCancellations,
  deliverOwnerEventsDurable,
  emitTurnEvent,
  event,
  fetchCanonicalAgentHistory,
  mutateExactTurn,
  ownerEventBase,
  ownerGateFor,
  ownsExactTurn,
  redeliverOrphan,
  registerTurn,
  releaseOwnerGate,
  scheduleDurabilityAlarm,
  setExactTurnAlarm,
  settleTerminalTransientWrites,
  trackTurn,
  unregisterTurn,
  unregisterTurnLease,
} from "./session-core.js";
import {
  currentSandbox,
  currentSandboxTarget,
  destroySandboxDurably,
  releaseAgentSessionResources,
  sandbox,
  sandboxContainerRunning,
  scheduleSandboxDestroyDebtAlarm,
  terminateCurrentAgentSession,
} from "./session-sandbox.js";
import {
  acknowledgeExactAgentTurnCancellation,
  acknowledgeExactCancellationFromAlarm,
  claimTerminalDecision,
  deliverExecutorLossTerminal,
  deliverTerminal,
} from "./terminal-delivery.js";
import {
  abortUnpublishedTurnStateOperation,
  confirmAgentTurnStateRestore,
  exactTurnStateCheckpointOperations,
  executeTurnStateCheckpoint,
  publishAgentTurnWorkspace,
  resolveAgentTurnState,
} from "./turn-broker.js";
import type { Env } from "./shared/env.js";
import type {
  AgentExecutionMarker,
  AgentExecutorResult,
  BuildOwnerFenceLeaseReceipt,
  BuilderFallbackInput,
  BuilderFallbackTranscript,
  PendingTerminal,
  TurnRequest,
  TurnStateCheckpointOperation,
} from "./shared/types.js";

export interface BuildSessionInternals {
  readonly ctx: DurableObjectState;
  readonly env: Env;
  readonly runningTurns: Map<string, Set<Promise<unknown>>>;
  readonly agentTurnExecutions: Map<string, TurnExecution<void>>;

  readonly builderFallbackRecoveries: Set<string>;
  readonly turnStateCheckpointRuns: Map<
    string,
    Promise<TurnBrokerTurnStateCheckpointReceipt>
  >;
  readonly exactTurnCancellations: ExactTurnCancellationLedger;

  deleteTurnStoragePreservingExactCancellations(
    expectedTurn?: TurnRequest,
    deleteAlarm?: boolean,
  ): Promise<boolean>;
  ownerGateFor(ownerId: string): DurableObjectStub<OwnerGate>;
  releaseOwnerGate(turn: TurnRequest): Promise<void>;

  ownerEventBase(
    turn: TurnRequest,
    key: string,
  ): {
    readonly v: 1;
    readonly key: string;
    readonly ownerId: string;
    readonly ownerGeneration: string;
    readonly emittedAt: number;
  };
  deliverOwnerEventsDurable(events: OwnerEvent[]): Promise<void>;
  emitTurnEvent(
    turn: TurnRequest,
    eventKind: string,
    payload: unknown,
    options?: {
      terminal?: boolean;
      eventSeq?: number;
      errorMessage?: string;
      resultJson?: string;
      signal?: AbortSignal;
    },
  ): Promise<number>;
  appendThreadTranscript(
    turn: TurnRequest,
    messages: readonly ThreadMessageInput[],
  ): Promise<void>;
  trackTurn<T>(turnId: string, work: Promise<T>): Promise<T>;
  startAgentTurn(turn: TurnRequest, sandboxId: string | undefined): Promise<void>;
  ownerFence(ownerId: string): OwnerFenceClient;
  callOwnerTurnState<T>(
    turn: TurnRequest,
    path:
      | "prepare"
      | "mark-uploaded"
      | "commit"
      | "publish-workspace"
      | "abort-unpublished"
      | "resolve"
      | "confirm-restore"
      | "drain",
    body: Record<string, unknown>,
  ): Promise<T>;
  resolveAgentTurnState(
    turn: TurnRequest,
    canonicalHistoryCursor: string,
  ): Promise<ResolvedTurnState>;
  publishAgentTurnWorkspace(
    turn: TurnRequest,
    canonicalHistoryCursor: string,
    operationId: string,
  ): Promise<TurnStateWorkspaceHead | undefined>;
  confirmAgentTurnStateRestore(
    turn: TurnRequest,
    canonicalHistoryCursor: string,
    threadCandidate: TurnStateCandidate | undefined,
    threadConfirmationRequired: boolean,
  ): Promise<void>;
  quiesceCurrentAgentSession(turn: TurnRequest): Promise<void>;
  exactAgentExecutionMarker(
    turn: TurnRequest,
  ): Promise<AgentExecutionMarker | undefined>;
  interruptAgentForBuilderFallback(turn: TurnRequest): Promise<void>;
  exactTurnStateCheckpointOperations(
    turn: TurnRequest,
  ): Promise<TurnStateCheckpointOperation[]>;
  abortUnpublishedTurnStateOperation(
    turn: TurnRequest,
    operation: TurnStateCheckpointOperation,
    canonicalHistoryCursor: string,
  ): Promise<void>;
  recoverAgentTurnAfterExecutorLoss(
    turn: TurnRequest,
    marker: AgentExecutionMarker,
    error: string,
  ): Promise<TurnBrokerTurnStateCheckpointReceipt>;
  reconcileAgentCheckpointAfterQuiescence(
    turn: TurnRequest,
    marker: AgentExecutionMarker,
    error: string,
    input?: BuilderFallbackInput,
  ): Promise<TurnBrokerTurnStateCheckpointReceipt>;
  ensureBuilderFallbackTranscript(
    turn: TurnRequest,
    input?: BuilderFallbackInput & { error?: string },
  ): Promise<BuilderFallbackTranscript>;
  advanceBuilderFallback(
    turn: TurnRequest,
    fallback: BuilderFallbackTranscript,
  ): Promise<TurnBrokerTurnStateCheckpointReceipt>;
  registerTurn(turn: TurnRequest, freshLease?: boolean): Promise<string>;
  ownerFenceReceiptMatches(
    receipt: BuildOwnerFenceLeaseReceipt,
    target: Pick<TurnRequest, "ownerId" | "ownerGeneration" | "turnId">,
    leaseId: string,
  ): boolean;
  ownerFenceLeaseSlotKey(
    turn: TurnRequest,
    kind: BuildOwnerFenceLeaseReceipt["kind"],
  ): Promise<string>;
  armOwnerFenceLeaseReconciliationAlarm(): Promise<void>;
  hasOwnerFenceLeaseRetirementDebt(): Promise<boolean>;
  registerBuildOwnerFenceLease(args: {
    turn: TurnRequest;
    kind: BuildOwnerFenceLeaseReceipt["kind"];
    role: "run" | "aux";
    slotKey?: string;
    leaseId?: string;
    mutateTurn?: boolean;
  }): Promise<{ generation: string; expiresAt: number; leaseId: string }>;
  unregisterTurn(turn: TurnRequest): Promise<void>;
  unregisterTurnLease(
    turn: TurnRequest,
    leaseId: string,
    generation?: string,
  ): Promise<boolean>;
  retireBuildOwnerFenceLease(
    receipt: BuildOwnerFenceLeaseReceipt,
    generation?: string | undefined,
  ): Promise<boolean>;
  cleanupTransientWrites(turn: TurnRequest): Promise<void>;
  cleanupOwnerPurgedTurnStorage(turn: TurnRequest): Promise<boolean>;
  settleTerminalTransientWrites(turn: TurnRequest): Promise<boolean>;
  redeliverOrphan(turn: TurnRequest, pending: PendingTerminal): Promise<void>;
  assertTurnWritable(turn: TurnRequest): Promise<void>;
  assertAgentTurnIdentity(turn: TurnRequest): void;
  fetchCanonicalAgentHistory(
    turn: TurnRequest,
    options: { excludeCurrentTurn: boolean; signal?: AbortSignal },
  ): AgentHistoryRow[];
  assertAgentExecutionActive(
    turn: TurnRequest,
    execution: TurnExecutionContext,
  ): Promise<void>;
  sandbox(
    id: string,
    size?: InstanceSize,
    workload?: SandboxWorkload,
    world?: string,
    idleTimeoutMs?: number,
    owner?: string,
  ): SandboxHandle;
  sandboxContainerRunning(
    sandbox: ReturnType<BuildSessionInternals["sandbox"]>,
  ): Promise<boolean>;
  destroySandboxDurably(target: SandboxTarget, event: string): Promise<void>;
  deliverExecutorLossTerminal(
    turn: TurnRequest,
    text: { message: string; threadError: string },
  ): Promise<void>;
  scheduleSandboxDestroyDebtAlarm(): Promise<void>;
  scheduleDurabilityAlarm(): Promise<void>;
  currentSandboxTarget(): Promise<SandboxTarget | undefined>;
  currentSandbox(): Promise<SandboxHandle | undefined>;
  terminateCurrentAgentSession(turn: TurnRequest): Promise<void>;
  releaseAgentSessionResources(target: {
    sandboxId: string;
    size: InstanceSize;
    workload: "world";
    sessionId: string;
    daemonDirectory: string;
    warm?: boolean;
  }): Promise<void>;
  ownsExactTurn(turn: TurnRequest): Promise<boolean>;
  mutateExactTurn(
    turn: TurnRequest,
    operation: (txn: DurableObjectTransaction) => Promise<void>,
  ): Promise<boolean>;
  setExactTurnAlarm(turn: TurnRequest, scheduledTime: number): Promise<boolean>;
  event(
    turn: TurnRequest,
    seq: number | "auto",
    kind: string,
    payload: unknown,
    terminal?: boolean,
    executionSignal?: AbortSignal,
  ): Promise<number>;
  claimTerminalDecision(
    turn: TurnRequest,
    pending: PendingTerminal,
    alarmAt?: number,
  ): Promise<boolean>;
  deliverTerminal(
    turn: TurnRequest,
    pendingInput: PendingTerminal,
    options?: { preservePendingTerminal?: boolean },
  ): Promise<boolean>;
  runAlarmWithLease(turn: TurnRequest): Promise<void>;
  runAlarm(turn: TurnRequest): Promise<void>;
  acknowledgeExactAgentTurnCancellation(
    request: ExactTurnCancellationRequest,
  ): Promise<boolean>;
  acknowledgeExactCancellationFromAlarm(
    turn: TurnRequest,
    cancellation: ExactTurnCancellation,
  ): Promise<boolean>;
  executeTurnStateCheckpoint(args: {
    turn: TurnRequest;
    operationKey: string;
    operation: Extract<TurnStateCheckpointOperation, { state: "pending" }> & {
      payload: TurnBrokerTurnStateCheckpointRequest;
    };
  }): Promise<TurnBrokerTurnStateCheckpointReceipt>;
  agentTurnAccepted(
    turn: TurnRequest,
    replayed: boolean,
    extra?: Record<string, unknown>,
  ): Response;
  runAgentTurn(
    turn: TurnRequest,
    sandboxId: string | undefined,
    execution: TurnExecutionContext,
  ): Promise<void>;
  runContainerAgentTurn(
    turn: TurnRequest,
    sandboxId: string,
    execution: TurnExecutionContext,
  ): Promise<void>;
  attachAgentWorld(args: {
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
  }): Promise<{
    session: ExecutionSession;
    coldContainerStartMs: number;
    restoreMs: number;
    adoptedSession?: { sessionId: string; cliVersion: string; hydrated?: true };
    nativeRestored: boolean;
  }>;
  runAgentAttempt(args: {
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
  }): Promise<{
    result: AgentExecutorResult;
    oom: boolean;
    coldContainerStartMs: number;
    restoreMs: number;
  }>;
}

export const createBuildSessionHost = (
  ctx: DurableObjectState,
  env: Env,
): BuildSessionInternals => {
  const bound =
    <A extends unknown[], R>(
      fn: (host: BuildSessionInternals, ...args: A) => R,
    ) =>
    (...args: A): R =>
      fn(host, ...args);
  const host: BuildSessionInternals = {
    ctx,
    env,
    runningTurns: new Map(),
    agentTurnExecutions: new Map(),
    builderFallbackRecoveries: new Set(),
    turnStateCheckpointRuns: new Map(),
    exactTurnCancellations: new ExactTurnCancellationLedger(ctx.storage),
    deleteTurnStoragePreservingExactCancellations: bound(deleteTurnStoragePreservingExactCancellations),
    ownerGateFor: bound(ownerGateFor),
    releaseOwnerGate: bound(releaseOwnerGate),
    ownerEventBase: bound(ownerEventBase),
    deliverOwnerEventsDurable: bound(deliverOwnerEventsDurable),
    emitTurnEvent: bound(emitTurnEvent),
    appendThreadTranscript: bound(appendThreadTranscript),
    trackTurn: <T,>(turnId: string, work: Promise<T>) =>
      trackTurn(host, turnId, work),
    startAgentTurn: bound(startAgentTurn),
    ownerFence: (ownerId: string) => ownerFenceClient(env.OWNER_GATES, ownerId),
    callOwnerTurnState: <T,>(
      turn: TurnRequest,
      path: Parameters<BuildSessionInternals["callOwnerTurnState"]>[1],
      body: Record<string, unknown>,
    ) => callOwnerTurnState<T>(host, turn, path, body),
    resolveAgentTurnState: bound(resolveAgentTurnState),
    publishAgentTurnWorkspace: bound(publishAgentTurnWorkspace),
    confirmAgentTurnStateRestore: bound(confirmAgentTurnStateRestore),
    quiesceCurrentAgentSession: bound(quiesceCurrentAgentSession),
    exactAgentExecutionMarker: bound(exactAgentExecutionMarker),
    interruptAgentForBuilderFallback: bound(interruptAgentForBuilderFallback),
    exactTurnStateCheckpointOperations: bound(exactTurnStateCheckpointOperations),
    abortUnpublishedTurnStateOperation: bound(abortUnpublishedTurnStateOperation),
    recoverAgentTurnAfterExecutorLoss: bound(recoverAgentTurnAfterExecutorLoss),
    reconcileAgentCheckpointAfterQuiescence: bound(reconcileAgentCheckpointAfterQuiescence),
    ensureBuilderFallbackTranscript: bound(ensureBuilderFallbackTranscript),
    advanceBuilderFallback: bound(advanceBuilderFallback),
    registerTurn: bound(registerTurn),
    ownerFenceReceiptMatches: bound(ownerFenceReceiptMatches),
    ownerFenceLeaseSlotKey: bound(ownerFenceLeaseSlotKey),
    armOwnerFenceLeaseReconciliationAlarm: bound(armOwnerFenceLeaseReconciliationAlarm),
    hasOwnerFenceLeaseRetirementDebt: bound(hasOwnerFenceLeaseRetirementDebt),
    registerBuildOwnerFenceLease: bound(registerBuildOwnerFenceLease),
    unregisterTurn: bound(unregisterTurn),
    unregisterTurnLease: bound(unregisterTurnLease),
    retireBuildOwnerFenceLease: bound(retireBuildOwnerFenceLease),
    cleanupTransientWrites: bound(cleanupTransientWrites),
    cleanupOwnerPurgedTurnStorage: bound(cleanupOwnerPurgedTurnStorage),
    settleTerminalTransientWrites: bound(settleTerminalTransientWrites),
    redeliverOrphan: bound(redeliverOrphan),
    assertTurnWritable: bound(assertTurnWritable),
    assertAgentTurnIdentity: bound(assertAgentTurnIdentity),
    fetchCanonicalAgentHistory: bound(fetchCanonicalAgentHistory),
    assertAgentExecutionActive: bound(assertAgentExecutionActive),
    sandbox: bound(sandbox),
    sandboxContainerRunning: bound(sandboxContainerRunning),
    destroySandboxDurably: bound(destroySandboxDurably),
    deliverExecutorLossTerminal: bound(deliverExecutorLossTerminal),
    scheduleSandboxDestroyDebtAlarm: bound(scheduleSandboxDestroyDebtAlarm),
    scheduleDurabilityAlarm: bound(scheduleDurabilityAlarm),
    currentSandboxTarget: bound(currentSandboxTarget),
    currentSandbox: bound(currentSandbox),
    terminateCurrentAgentSession: bound(terminateCurrentAgentSession),
    releaseAgentSessionResources: bound(releaseAgentSessionResources),
    ownsExactTurn: bound(ownsExactTurn),
    mutateExactTurn: bound(mutateExactTurn),
    setExactTurnAlarm: bound(setExactTurnAlarm),
    event: bound(event),
    claimTerminalDecision: bound(claimTerminalDecision),
    deliverTerminal: bound(deliverTerminal),
    runAlarmWithLease: bound(runAlarmWithLease),
    runAlarm: bound(runAlarm),
    acknowledgeExactAgentTurnCancellation: bound(acknowledgeExactAgentTurnCancellation),
    acknowledgeExactCancellationFromAlarm: bound(acknowledgeExactCancellationFromAlarm),
    executeTurnStateCheckpoint: bound(executeTurnStateCheckpoint),
    agentTurnAccepted: bound(agentTurnAccepted),
    runAgentTurn: bound(runAgentTurn),
    runContainerAgentTurn: bound(runContainerAgentTurn),
    attachAgentWorld: bound(attachAgentWorld),
    runAgentAttempt: bound(runAgentAttempt),
  };
  return host;
};
