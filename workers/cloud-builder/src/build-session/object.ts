import { storageKeks } from "../secret-rotation.js";
import { AGENT_STOPPED_REASON, isAgentStopReason } from "@stella/contracts/agent-status";
import { isManagedModelAudience } from "@stella/contracts/gateway/capability";
import type {
  TurnBrokerTurnStateCheckpointReceipt,
  TurnBrokerTurnStateCheckpointRequest,
} from "@stella/contracts/turn-credential-broker";
import type { OwnerEvent } from "@stella/contracts/turn-plane/owner-events";
import type { OwnerSnapshot } from "@stella/contracts/turn-plane/owner-snapshot";
import type { AgentHistoryRow } from "@stella/executor-cloud/agent-history";
import { DurableObject } from "cloudflare:workers";
import {
  acceptAgentTurn,
  admitAgentTurnThroughOwnerGate,
  agentTurnAccepted,
  runAgentTurn,
  startAgentTurn,
  turnRequestFromAgentStart,
} from "../build-session/admission.js";
import {
  advanceBuilderFallback,
  ensureBuilderFallbackTranscript,
  reconcileAgentCheckpointAfterQuiescence,
  recoverAgentTurnAfterExecutorLoss,
  runAlarm,
  runAlarmWithLease,
  runScheduledTurnAlarm,
} from "../build-session/alarms-recovery.js";
import {
  attachAgentWorld,
  exactAgentExecutionMarker,
  interruptAgentForBuilderFallback,
  persistAgentExecutionMarker,
  quiesceCurrentAgentSession,
  runAgentAttempt,
  runContainerAgentTurn,
  steerContainerAgent,
} from "../build-session/container-turn.js";
import {
  armOwnerFenceLeaseReconciliationAlarm,
  hasOwnerFenceLeaseRetirementDebt,
  ownerFenceLeaseSlotKey,
  ownerFenceReceiptMatches,
  registerBuildOwnerFenceLease,
  retireBuildOwnerFenceLease,
  retryOwnerFenceLeaseRetirements,
} from "../build-session/owner-fence-leases.js";
import {
  appendThreadTranscript,
  assertAgentExecutionActive,
  assertAgentTurnIdentity,
  assertAppExecutionActive,
  assertAppTurnIdentity,
  assertTurnWritable,
  callOwnerFence as callOwnerFenceCore,
  callOwnerTurnState,
  cleanupOwnerPurgedTurnStorage,
  cleanupTransientWrites,
  deleteTurnStoragePreservingExactCancellations,
  emitTurnEvent,
  deliverOwnerEventsDurable,
  event,
  fetchCanonicalAgentHistory,
  mutateExactTurn,
  ownerEventBase,
  ownerGateFor,
  ownsExactTurn,
  redeliverOrphan,
  registerTurn,
  releaseOwnerGate,
  retireTerminalAppTurnStorage,
  retryOwnerEventDebt,
  scheduleDurabilityAlarm,
  setExactTurnAlarm,
  settleAgentTransientBackup,
  settleTerminalTransientWrites,
  sweepNativeBackupDebt,
  trackTurn,
  unregisterTurn,
  unregisterTurnLease,
} from "../build-session/session-core.js";
import {
  currentSandbox,
  currentSandboxTarget,
  destroySandboxDurably,
  prewarmOrchestratorContainer,
  releaseAgentSessionResources,
  retryDueSandboxDestroyDebts,
  sandbox,
  sandboxContainerRunning,
  scheduleSandboxDestroyDebtAlarm,
  terminateCurrentAgentSession,
} from "../build-session/session-sandbox.js";
import type { Env } from "../build-session/shared/env.js";
import {
  AgentTurnAuthorityLostError,
  AppTurnAuthorityLostError,
  OwnerPurgeFenceError,
} from "../build-session/shared/errors.js";
import {
  builderFallbackTranscriptKey,
  HEADER_BUILD_SESSION_NAME,
  HEADER_TURN_BROKER_ENDPOINT,
  json,
  turnDispatchIdentity,
} from "../build-session/shared/keys.js";
import type {
  AgentExecutionMarker,
  BuilderFallbackInput,
  BuilderFallbackTranscript,
  BuildOwnerFenceLeaseReceipt,
  PendingTerminal,
  TurnRequest,
  TurnStateCheckpointOperation,
} from "../build-session/shared/types.js";
import {
  acknowledgeExactAgentTurnCancellation,
  acknowledgeExactCancellationFromAlarm,
  cancelExactAgentTurn,
  cancelForOwnerPurge,
  claimTerminalDecision,
  deliverExecutorLossTerminal,
  deliverTerminal,
  expireCurrentAgentTurn,
  handleOrchestratorTurnStatus,
} from "../build-session/terminal-delivery.js";
import {
  abortUnpublishedTurnStateOperation,
  confirmAgentTurnStateRestore,
  exactTurnStateCheckpointOperations,
  executeTurnStateCheckpoint,
  handleTurnBroker,
  publishAgentTurnWorkspace,
  resolveAgentTurnState,
} from "../build-session/turn-broker.js";
import type {
  ExactTurnCancellation,
  ExactTurnCancellationRequest,
} from "../execution-placement-turn-cancellation.js";
import {
  ExactTurnCancellationLedger,
  parseExactTurnCancellationRequest,
} from "../execution-placement-turn-cancellation.js";
import type { InstanceSize } from "../instance-size.js";
import { normalizeOwnerGeneration } from "../owner-generation.js";
import { stableValueMarker } from "../hash.js";
import { orchestratorCliSpecDigest } from "../orchestrator-cli-turn-store.js";
import type { SandboxTarget, SandboxWorkload } from "../sandbox-lifecycle.js";
import type { ThreadMessageInput } from "../thread-transcript.js";
import { configureThreadTranscriptCrypto } from "../thread-transcript.js";
import type {
  TurnExecution,
  TurnExecutionContext,
} from "../turn-cancellation.js";
import {
  HEADER_GATE_ADMITTED,
  parseCloudAgentTurnStartRequest,
} from "../turn-start-request.js";
import type {
  ResolvedTurnState,
  TurnStateCandidate,
  TurnStateWorkspaceHead,
} from "../turn-state-registry.js";
import type { BuildSessionInternals } from "./host.js";

export class BuildSessionObject extends DurableObject<Env> {
  private readonly runningTurns = new Map<string, Set<Promise<unknown>>>();
  private readonly appTurnExecutions = new Map<
    string,
    TurnExecution<Response>
  >();
  private readonly agentTurnExecutions = new Map<string, TurnExecution<void>>();

  private readonly builderFallbackRecoveries = new Set<string>();
  private readonly turnStateCheckpointRuns = new Map<
    string,
    Promise<TurnBrokerTurnStateCheckpointReceipt>
  >();
  private readonly exactTurnCancellations = new ExactTurnCancellationLedger(
    this.ctx.storage,
  );

  private readonly self: BuildSessionInternals = {
    ctx: this.ctx,
    env: this.env,
    runningTurns: this.runningTurns,
    appTurnExecutions: this.appTurnExecutions,
    agentTurnExecutions: this.agentTurnExecutions,
    builderFallbackRecoveries: this.builderFallbackRecoveries,
    turnStateCheckpointRuns: this.turnStateCheckpointRuns,
    exactTurnCancellations: this.exactTurnCancellations,
    deleteTurnStoragePreservingExactCancellations: this.deleteTurnStoragePreservingExactCancellations.bind(this),
    ownerGateFor: this.ownerGateFor.bind(this),
    releaseOwnerGate: this.releaseOwnerGate.bind(this),
    ownerEventBase: this.ownerEventBase.bind(this),
    deliverOwnerEventsDurable: this.deliverOwnerEventsDurable.bind(this),
    retryOwnerEventDebt: this.retryOwnerEventDebt.bind(this),
    emitTurnEvent: this.emitTurnEvent.bind(this),
    appendThreadTranscript: this.appendThreadTranscript.bind(this),
    trackTurn: this.trackTurn.bind(this),
    startAgentTurn: this.startAgentTurn.bind(this),
    callOwnerFence: this.callOwnerFence.bind(this),
    callOwnerTurnState: this.callOwnerTurnState.bind(this),
    resolveAgentTurnState: this.resolveAgentTurnState.bind(this),
    publishAgentTurnWorkspace: this.publishAgentTurnWorkspace.bind(this),
    confirmAgentTurnStateRestore: this.confirmAgentTurnStateRestore.bind(this),
    quiesceCurrentAgentSession: this.quiesceCurrentAgentSession.bind(this),
    exactAgentExecutionMarker: this.exactAgentExecutionMarker.bind(this),
    persistAgentExecutionMarker: this.persistAgentExecutionMarker.bind(this),
    interruptAgentForBuilderFallback: this.interruptAgentForBuilderFallback.bind(this),
    exactTurnStateCheckpointOperations: this.exactTurnStateCheckpointOperations.bind(this),
    abortUnpublishedTurnStateOperation: this.abortUnpublishedTurnStateOperation.bind(this),
    recoverAgentTurnAfterExecutorLoss: this.recoverAgentTurnAfterExecutorLoss.bind(this),
    reconcileAgentCheckpointAfterQuiescence: this.reconcileAgentCheckpointAfterQuiescence.bind(this),
    ensureBuilderFallbackTranscript: this.ensureBuilderFallbackTranscript.bind(this),
    advanceBuilderFallback: this.advanceBuilderFallback.bind(this),
    registerTurn: this.registerTurn.bind(this),
    ownerFenceReceiptMatches: this.ownerFenceReceiptMatches.bind(this),
    ownerFenceLeaseSlotKey: this.ownerFenceLeaseSlotKey.bind(this),
    armOwnerFenceLeaseReconciliationAlarm: this.armOwnerFenceLeaseReconciliationAlarm.bind(this),
    hasOwnerFenceLeaseRetirementDebt: this.hasOwnerFenceLeaseRetirementDebt.bind(this),
    retryOwnerFenceLeaseRetirements: this.retryOwnerFenceLeaseRetirements.bind(this),
    registerBuildOwnerFenceLease: this.registerBuildOwnerFenceLease.bind(this),
    unregisterTurn: this.unregisterTurn.bind(this),
    unregisterTurnLease: this.unregisterTurnLease.bind(this),
    retireBuildOwnerFenceLease: this.retireBuildOwnerFenceLease.bind(this),
    sweepNativeBackupDebt: this.sweepNativeBackupDebt.bind(this),
    settleAgentTransientBackup: this.settleAgentTransientBackup.bind(this),
    cleanupTransientWrites: this.cleanupTransientWrites.bind(this),
    cleanupOwnerPurgedTurnStorage: this.cleanupOwnerPurgedTurnStorage.bind(this),
    settleTerminalTransientWrites: this.settleTerminalTransientWrites.bind(this),
    retireTerminalAppTurnStorage: this.retireTerminalAppTurnStorage.bind(this),
    cancelForOwnerPurge: this.cancelForOwnerPurge.bind(this),
    redeliverOrphan: this.redeliverOrphan.bind(this),
    assertTurnWritable: this.assertTurnWritable.bind(this),
    assertAgentTurnIdentity: this.assertAgentTurnIdentity.bind(this),
    assertAppTurnIdentity: this.assertAppTurnIdentity.bind(this),
    fetchCanonicalAgentHistory: this.fetchCanonicalAgentHistory.bind(this),
    assertAgentExecutionActive: this.assertAgentExecutionActive.bind(this),
    assertAppExecutionActive: this.assertAppExecutionActive.bind(this),
    sandbox: this.sandbox.bind(this),
    sandboxContainerRunning: this.sandboxContainerRunning.bind(this),
    destroySandboxDurably: this.destroySandboxDurably.bind(this),
    deliverExecutorLossTerminal: this.deliverExecutorLossTerminal.bind(this),
    retryDueSandboxDestroyDebts: this.retryDueSandboxDestroyDebts.bind(this),
    scheduleSandboxDestroyDebtAlarm: this.scheduleSandboxDestroyDebtAlarm.bind(this),
    scheduleDurabilityAlarm: this.scheduleDurabilityAlarm.bind(this),
    currentSandboxTarget: this.currentSandboxTarget.bind(this),
    currentSandbox: this.currentSandbox.bind(this),
    terminateCurrentAgentSession: this.terminateCurrentAgentSession.bind(this),
    releaseAgentSessionResources: this.releaseAgentSessionResources.bind(this),
    ownsExactTurn: this.ownsExactTurn.bind(this),
    mutateExactTurn: this.mutateExactTurn.bind(this),
    setExactTurnAlarm: this.setExactTurnAlarm.bind(this),
    event: this.event.bind(this),
    claimTerminalDecision: this.claimTerminalDecision.bind(this),
    deliverTerminal: this.deliverTerminal.bind(this),
    alarm: this.alarm.bind(this),
    runScheduledTurnAlarm: this.runScheduledTurnAlarm.bind(this),
    runAlarmWithLease: this.runAlarmWithLease.bind(this),
    runAlarm: this.runAlarm.bind(this),
    acknowledgeExactAgentTurnCancellation: this.acknowledgeExactAgentTurnCancellation.bind(this),
    acknowledgeExactCancellationFromAlarm: this.acknowledgeExactCancellationFromAlarm.bind(this),
    expireCurrentAgentTurn: this.expireCurrentAgentTurn.bind(this),
    cancelExactAgentTurn: this.cancelExactAgentTurn.bind(this),
    executeTurnStateCheckpoint: this.executeTurnStateCheckpoint.bind(this),
    handleTurnBroker: this.handleTurnBroker.bind(this),
    fetch: this.fetch.bind(this),
    admitAgentTurnThroughOwnerGate: this.admitAgentTurnThroughOwnerGate.bind(this),
    agentTurnAccepted: this.agentTurnAccepted.bind(this),
    acceptAgentTurn: this.acceptAgentTurn.bind(this),
    runAgentTurn: this.runAgentTurn.bind(this),
    runContainerAgentTurn: this.runContainerAgentTurn.bind(this),
    attachAgentWorld: this.attachAgentWorld.bind(this),
    runAgentAttempt: this.runAgentAttempt.bind(this),
  };

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    configureThreadTranscriptCrypto(
      ctx.storage.sql,
      storageKeks(env),
    );
  }


  private deleteTurnStoragePreservingExactCancellations(
    expectedTurn?: TurnRequest,
    deleteAlarm = false,
  ): Promise<boolean> {
    return deleteTurnStoragePreservingExactCancellations(
      this.self,
      expectedTurn,
      deleteAlarm,
    );
  }

  private ownerGateFor(ownerId: string) {
    return ownerGateFor(this.self, ownerId);
  }

  private releaseOwnerGate(turn: TurnRequest): Promise<void> {
    return releaseOwnerGate(this.self, turn);
  }


  private ownerEventBase(turn: TurnRequest, key: string) {
    return ownerEventBase(this.self, turn, key);
  }

  private deliverOwnerEventsDurable(events: OwnerEvent[]): Promise<void> {
    return deliverOwnerEventsDurable(this.self, events);
  }

  private retryOwnerEventDebt(): Promise<void> {
    return retryOwnerEventDebt(this.self);
  }

  private emitTurnEvent(
    turn: TurnRequest,
    eventKind: string,
    payload: unknown,
    options: {
      terminal?: boolean;
      eventSeq?: number;
      errorMessage?: string;
      resultJson?: string;
      signal?: AbortSignal;
    } = {},
  ): Promise<number> {
    return emitTurnEvent(this.self, turn, eventKind, payload, options);
  }

  private appendThreadTranscript(
    turn: TurnRequest,
    messages: readonly ThreadMessageInput[],
  ): Promise<void> {
    return appendThreadTranscript(this.self, turn, messages);
  }

  private trackTurn<T>(turnId: string, work: Promise<T>): Promise<T> {
    return trackTurn(this.self, turnId, work);
  }

  private startAgentTurn(
    turn: TurnRequest,
    sandboxId: string | undefined,
  ): Promise<void> {
    return startAgentTurn(this.self, turn, sandboxId);
  }

  private callOwnerFence(
    ownerId: string,
    path: string,
    body: Record<string, unknown>,
  ): Promise<Response> {
    return callOwnerFenceCore(this.self, ownerId, path, body);
  }

  private callOwnerTurnState<T>(
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
  ): Promise<T> {
    return callOwnerTurnState(this.self, turn, path, body);
  }

  private resolveAgentTurnState(
    turn: TurnRequest,
    canonicalHistoryCursor: string,
  ): Promise<ResolvedTurnState> {
    return resolveAgentTurnState(
      this.self,
      turn,
      canonicalHistoryCursor,
    );
  }

  private publishAgentTurnWorkspace(
    turn: TurnRequest,
    canonicalHistoryCursor: string,
    operationId: string,
  ): Promise<TurnStateWorkspaceHead | undefined> {
    return publishAgentTurnWorkspace(
      this.self,
      turn,
      canonicalHistoryCursor,
      operationId,
    );
  }

  private confirmAgentTurnStateRestore(
    turn: TurnRequest,
    canonicalHistoryCursor: string,
    threadCandidate: TurnStateCandidate | undefined,
    threadConfirmationRequired: boolean,
  ): Promise<void> {
    return confirmAgentTurnStateRestore(
      this.self,
      turn,
      canonicalHistoryCursor,
      threadCandidate,
      threadConfirmationRequired,
    );
  }

  private quiesceCurrentAgentSession(turn: TurnRequest): Promise<void> {
    return quiesceCurrentAgentSession(this.self, turn);
  }

  private exactAgentExecutionMarker(
    turn: TurnRequest,
  ): Promise<AgentExecutionMarker | undefined> {
    return exactAgentExecutionMarker(this.self, turn);
  }

  private persistAgentExecutionMarker(
    turn: TurnRequest,
    marker: AgentExecutionMarker,
  ): Promise<void> {
    return persistAgentExecutionMarker(this.self, turn, marker);
  }

  private interruptAgentForBuilderFallback(turn: TurnRequest): Promise<void> {
    return interruptAgentForBuilderFallback(this.self, turn);
  }

  private exactTurnStateCheckpointOperations(
    turn: TurnRequest,
  ): Promise<TurnStateCheckpointOperation[]> {
    return exactTurnStateCheckpointOperations(this.self, turn);
  }

  private abortUnpublishedTurnStateOperation(
    turn: TurnRequest,
    operation: TurnStateCheckpointOperation,
    canonicalHistoryCursor: string,
  ): Promise<void> {
    return abortUnpublishedTurnStateOperation(
      this.self,
      turn,
      operation,
      canonicalHistoryCursor,
    );
  }

  private recoverAgentTurnAfterExecutorLoss(
    turn: TurnRequest,
    marker: AgentExecutionMarker,
    error: string,
  ): Promise<TurnBrokerTurnStateCheckpointReceipt> {
    return recoverAgentTurnAfterExecutorLoss(this.self, turn, marker, error);
  }

  private reconcileAgentCheckpointAfterQuiescence(
    turn: TurnRequest,
    marker: AgentExecutionMarker,
    error: string,
    input?: BuilderFallbackInput,
  ): Promise<TurnBrokerTurnStateCheckpointReceipt> {
    return reconcileAgentCheckpointAfterQuiescence(
      this.self,
      turn,
      marker,
      error,
      input,
    );
  }

  private ensureBuilderFallbackTranscript(
    turn: TurnRequest,
    input?: BuilderFallbackInput & { error?: string },
  ): Promise<BuilderFallbackTranscript> {
    return ensureBuilderFallbackTranscript(this.self, turn, input);
  }

  private advanceBuilderFallback(
    turn: TurnRequest,
    fallback: BuilderFallbackTranscript,
  ): Promise<TurnBrokerTurnStateCheckpointReceipt> {
    return advanceBuilderFallback(this.self, turn, fallback);
  }

  private registerTurn(turn: TurnRequest, freshLease = false): Promise<string> {
    return registerTurn(this.self, turn, freshLease);
  }

  private ownerFenceReceiptMatches(
    receipt: BuildOwnerFenceLeaseReceipt,
    target: Pick<TurnRequest, "ownerId" | "ownerGeneration" | "turnId">,
    leaseId: string,
  ): boolean {
    return ownerFenceReceiptMatches(this.self, receipt, target, leaseId);
  }

  private ownerFenceLeaseSlotKey(
    turn: TurnRequest,
    kind: BuildOwnerFenceLeaseReceipt["kind"],
  ): Promise<string> {
    return ownerFenceLeaseSlotKey(this.self, turn, kind);
  }

  private armOwnerFenceLeaseReconciliationAlarm(): Promise<void> {
    return armOwnerFenceLeaseReconciliationAlarm(this.self);
  }

  private hasOwnerFenceLeaseRetirementDebt(): Promise<boolean> {
    return hasOwnerFenceLeaseRetirementDebt(this.self);
  }

  private retryOwnerFenceLeaseRetirements(): Promise<void> {
    return retryOwnerFenceLeaseRetirements(this.self);
  }

  private registerBuildOwnerFenceLease(args: {
    turn: TurnRequest;
    kind: BuildOwnerFenceLeaseReceipt["kind"];
    role: "run" | "aux";
    slotKey?: string;
    leaseId?: string;
    mutateTurn?: boolean;
  }): Promise<{ generation: string; expiresAt: number; leaseId: string }> {
    return registerBuildOwnerFenceLease(this.self, args);
  }

  private unregisterTurn(turn: TurnRequest): Promise<void> {
    return unregisterTurn(this.self, turn);
  }

  private unregisterTurnLease(
    turn: TurnRequest,
    leaseId: string,
    generation?: string,
  ): Promise<boolean> {
    return unregisterTurnLease(this.self, turn, leaseId, generation);
  }

  private retireBuildOwnerFenceLease(
    receipt: BuildOwnerFenceLeaseReceipt,
    generation = receipt.registrationGeneration,
  ): Promise<boolean> {
    return retireBuildOwnerFenceLease(this.self, receipt, generation);
  }

  private sweepNativeBackupDebt(workspaceKey: string): Promise<void> {
    return sweepNativeBackupDebt(this.self, workspaceKey);
  }

  private settleAgentTransientBackup(turn: TurnRequest): Promise<boolean> {
    return settleAgentTransientBackup(this.self, turn);
  }

  private cleanupTransientWrites(turn: TurnRequest): Promise<void> {
    return cleanupTransientWrites(this.self, turn);
  }

  private cleanupOwnerPurgedTurnStorage(turn: TurnRequest): Promise<boolean> {
    return cleanupOwnerPurgedTurnStorage(this.self, turn);
  }

  private settleTerminalTransientWrites(turn: TurnRequest): Promise<boolean> {
    return settleTerminalTransientWrites(this.self, turn);
  }

  private retireTerminalAppTurnStorage(turn: TurnRequest): Promise<void> {
    return retireTerminalAppTurnStorage(this.self, turn);
  }

  private cancelForOwnerPurge(request: Request): Promise<Response> {
    return cancelForOwnerPurge(this.self, request);
  }

  private redeliverOrphan(
    turn: TurnRequest,
    pending: PendingTerminal,
  ): Promise<void> {
    return redeliverOrphan(this.self, turn, pending);
  }

  private assertTurnWritable(turn: TurnRequest): Promise<void> {
    return assertTurnWritable(this.self, turn);
  }

  private assertAgentTurnIdentity(turn: TurnRequest): void {
    return assertAgentTurnIdentity(this.self, turn);
  }

  private assertAppTurnIdentity(turn: TurnRequest): void {
    return assertAppTurnIdentity(this.self, turn);
  }

  private fetchCanonicalAgentHistory(
    turn: TurnRequest,
    options: { excludeCurrentTurn: boolean; signal?: AbortSignal },
  ): AgentHistoryRow[] {
    return fetchCanonicalAgentHistory(this.self, turn, options);
  }

  private assertAgentExecutionActive(
    turn: TurnRequest,
    execution: TurnExecutionContext,
  ): Promise<void> {
    return assertAgentExecutionActive(this.self, turn, execution);
  }

  private assertAppExecutionActive(
    turn: TurnRequest,
    execution: TurnExecutionContext,
  ): Promise<void> {
    return assertAppExecutionActive(this.self, turn, execution);
  }

  private sandbox(
    id: string,
    size: InstanceSize = "large",
    workload: SandboxWorkload = "app-build",
    world?: string,
    idleTimeoutMs?: number,
    owner?: string,
  ) {
    return sandbox(this.self, id, size, workload, world, idleTimeoutMs, owner);
  }

  private sandboxContainerRunning(
    sandbox: ReturnType<BuildSessionObject["sandbox"]>,
  ): Promise<boolean> {
    return sandboxContainerRunning(this.self, sandbox);
  }

  private destroySandboxDurably(
    target: SandboxTarget,
    event: string,
  ): Promise<void> {
    return destroySandboxDurably(this.self, target, event);
  }

  private deliverExecutorLossTerminal(
    turn: TurnRequest,
    text: { message: string; threadError: string },
  ): Promise<void> {
    return deliverExecutorLossTerminal(this.self, turn, text);
  }

  private retryDueSandboxDestroyDebts(now = Date.now()): Promise<void> {
    return retryDueSandboxDestroyDebts(this.self, now);
  }

  private scheduleSandboxDestroyDebtAlarm(): Promise<void> {
    return scheduleSandboxDestroyDebtAlarm(this.self);
  }

  private scheduleDurabilityAlarm(): Promise<void> {
    return scheduleDurabilityAlarm(this.self);
  }

  private currentSandboxTarget(): Promise<SandboxTarget | undefined> {
    return currentSandboxTarget(this.self);
  }

  private currentSandbox() {
    return currentSandbox(this.self);
  }

  private terminateCurrentAgentSession(turn: TurnRequest): Promise<void> {
    return terminateCurrentAgentSession(this.self, turn);
  }

  private releaseAgentSessionResources(target: {
    sandboxId: string;
    size: InstanceSize;
    workload: "world";
    sessionId: string;
    daemonDirectory: string;
    warm?: boolean;
  }): Promise<void> {
    return releaseAgentSessionResources(this.self, target);
  }

  private ownsExactTurn(turn: TurnRequest): Promise<boolean> {
    return ownsExactTurn(this.self, turn);
  }

  private mutateExactTurn(
    turn: TurnRequest,
    operation: (txn: DurableObjectTransaction) => Promise<void>,
  ): Promise<boolean> {
    return mutateExactTurn(this.self, turn, operation);
  }

  private setExactTurnAlarm(
    turn: TurnRequest,
    scheduledTime: number,
  ): Promise<boolean> {
    return setExactTurnAlarm(this.self, turn, scheduledTime);
  }

  private event(
    turn: TurnRequest,
    seq: number | "auto",
    kind: string,
    payload: unknown,
    terminal = false,
    executionSignal?: AbortSignal,
  ): Promise<number> {
    return event(
      this.self,
      turn,
      seq,
      kind,
      payload,
      terminal,
      executionSignal,
    );
  }

  private claimTerminalDecision(
    turn: TurnRequest,
    pending: PendingTerminal,
    alarmAt?: number,
  ): Promise<boolean> {
    return claimTerminalDecision(this.self, turn, pending, alarmAt);
  }

  private deliverTerminal(
    turn: TurnRequest,
    pendingInput: PendingTerminal,
    options: { preservePendingTerminal?: boolean } = {},
  ): Promise<boolean> {
    return deliverTerminal(this.self, turn, pendingInput, options);
  }

  async alarm(): Promise<void> {
    await this.retryDueSandboxDestroyDebts();
    await this.retryOwnerFenceLeaseRetirements();
    await this.retryOwnerEventDebt();
    try {
      await this.runScheduledTurnAlarm();
    } finally {
      await this.scheduleDurabilityAlarm();
    }
  }

  private runScheduledTurnAlarm(): Promise<void> {
    return runScheduledTurnAlarm(this.self);
  }

  private runAlarmWithLease(turn: TurnRequest): Promise<void> {
    return runAlarmWithLease(this.self, turn);
  }

  private runAlarm(turn: TurnRequest): Promise<void> {
    return runAlarm(this.self, turn);
  }

  private acknowledgeExactAgentTurnCancellation(
    request: ExactTurnCancellationRequest,
  ): Promise<boolean> {
    return acknowledgeExactAgentTurnCancellation(this.self, request);
  }

  private acknowledgeExactCancellationFromAlarm(
    turn: TurnRequest,
    cancellation: ExactTurnCancellation,
  ): Promise<boolean> {
    return acknowledgeExactCancellationFromAlarm(this.self, turn, cancellation);
  }

  private expireCurrentAgentTurn(request: Request): Promise<Response> {
    return expireCurrentAgentTurn(this.self, request);
  }

  private cancelExactAgentTurn(
    request: ExactTurnCancellationRequest,
    reason: string,
  ): Promise<Response> {
    return cancelExactAgentTurn(this.self, request, reason);
  }

  private executeTurnStateCheckpoint(args: {
    turn: TurnRequest;
    operationKey: string;
    operation: Extract<TurnStateCheckpointOperation, { state: "pending" }> & {
      payload: TurnBrokerTurnStateCheckpointRequest;
    };
  }): Promise<TurnBrokerTurnStateCheckpointReceipt> {
    return executeTurnStateCheckpoint(this.self, args);
  }

  private handleTurnBroker(request: Request): Promise<Response> {
    return handleTurnBroker(this.self, request);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/turn-broker") {
      return await this.handleTurnBroker(request);
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed." }, 405);
    }
    if (url.pathname === "/owner-purge-cancel") {
      return this.cancelForOwnerPurge(request);
    }
    if (url.pathname === "/expire-agent-turn") {
      return await this.expireCurrentAgentTurn(request);
    }
    if (url.pathname === "/orchestrator-turn/status") {
      return await handleOrchestratorTurnStatus(this.self, request);
    }
    if (url.pathname === "/orchestrator-turn/prewarm") {
      return await prewarmOrchestratorContainer(this.self, request);
    }
    if (url.pathname === "/steer") {
      return await steerContainerAgent(this.self, request);
    }
    if (url.pathname === "/cancel") {
      const raw = await request.json().catch(() => null);
      const cancellation = parseExactTurnCancellationRequest(raw);
      if (!cancellation || cancellation.attemptGeneration === undefined) {
        return json(
          { canceled: false, reason: "exact_turn_identity_required" },
          400,
        );
      }
      const reason =
        raw &&
        typeof raw === "object" &&
        !Array.isArray(raw) &&
        isAgentStopReason((raw as Record<string, unknown>).reason as string | undefined)
          ? AGENT_STOPPED_REASON
          : "The agent was stopped.";
      return await this.cancelExactAgentTurn(cancellation, reason);
    }

    if (url.pathname !== "/turn") return json({ error: "Not found." }, 404);
    const raw = (await request.json().catch(() => null)) as unknown;
    let turn: TurnRequest;
    if (
      raw &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      (raw as { kind?: unknown }).kind === "agent"
    ) {
      const parsed = parseCloudAgentTurnStartRequest(raw);
      if (!parsed.ok) return json({ error: parsed.message }, 400);
      if (parsed.request.execution.engine !== "anthropic") {
        return json({ error: "This agent runs in its conversation." }, 400);
      }
      turn = turnRequestFromAgentStart(parsed.request);
    } else {
      return json({ error: "Unsupported turn kind." }, 400);
    }
    delete turn.turnBrokerRoute;
    delete turn.gateAdmittedByCaller;
    if (request.headers.get(HEADER_GATE_ADMITTED)?.trim() === "1") {
      turn.gateAdmittedByCaller = true;
    }
    if (turn.agentRole === "orchestrator") {
      if (!turn.gateAdmittedByCaller) {
        return json(
          { error: "An orchestrator turn is dispatched by its conversation." },
          403,
        );
      }
      turn.orchestratorCliDigest = await orchestratorCliSpecDigest(
        turn.orchestratorCli!,
      );
    }
    const brokerSessionId =
      request.headers.get(HEADER_BUILD_SESSION_NAME)?.trim() ?? "";
    const brokerEndpoint =
      request.headers.get(HEADER_TURN_BROKER_ENDPOINT)?.trim() ?? "";
    if (turn?.kind === "agent" && (brokerSessionId || brokerEndpoint)) {
      try {
        const endpoint = new URL(brokerEndpoint);
        const localHttp =
          endpoint.protocol === "http:" &&
          (endpoint.hostname === "127.0.0.1" ||
            endpoint.hostname === "localhost");
        if (
          !brokerSessionId ||
          brokerSessionId.length > 512 ||
          (endpoint.protocol !== "https:" && !localHttp) ||
          endpoint.username ||
          endpoint.password ||
          endpoint.search ||
          endpoint.hash ||
          endpoint.pathname !==
            `/sessions/${encodeURIComponent(brokerSessionId)}/turn-broker`
        ) {
          throw new Error("invalid broker route");
        }
        turn.turnBrokerRoute = {
          sessionId: brokerSessionId,
          endpoint: endpoint.toString(),
        };
      } catch {
        return json({ error: "Trusted turn broker route is required." }, 400);
      }
    }
    const dispatchOwnerGeneration = normalizeOwnerGeneration(
      turn?.ownerGeneration,
    );
    if (
      !turn ||
      typeof turn.ownerId !== "string" ||
      !turn.ownerId.trim() ||
      typeof turn.turnId !== "string" ||
      !turn.turnId.trim() ||
      !dispatchOwnerGeneration
    ) {
      return json(
        { error: "ownerId, turnId, and ownerGeneration are required." },
        400,
      );
    }
    turn.ownerId = turn.ownerId.trim();
    turn.turnId = turn.turnId.trim();
    turn.ownerGeneration = dispatchOwnerGeneration;
    if (
      !isManagedModelAudience(turn.audience) ||
      typeof turn.budgetMicroCents !== "number" ||
      !Number.isFinite(turn.budgetMicroCents)
    ) {
      return json(
        { error: "audience and budgetMicroCents are required." },
        400,
      );
    }
    if (
      turn.kind !== "agent" &&
      (typeof turn.appId !== "string" ||
        !turn.appId.trim() ||
        typeof turn.conversationId !== "string" ||
        !turn.conversationId.trim() ||
        typeof turn.sessionId !== "string" ||
        !turn.sessionId.trim())
    ) {
      return json(
        { error: "App turns require appId, conversationId, and sessionId." },
        400,
      );
    }
    if (turn.kind === "agent") {
      turn.threadId = turn.threadId!.trim();
    } else {
      turn.appId = turn.appId.trim();
      turn.conversationId = turn.conversationId!.trim();
      turn.sessionId = turn.sessionId!.trim();
    }
    const storedTurn = await this.ctx.storage.get<TurnRequest>("turn");
    if (storedTurn?.turnId === turn.turnId) {
      const [storedFingerprint, replayFingerprint] = await Promise.all([
        stableValueMarker(turnDispatchIdentity(storedTurn)),
        stableValueMarker(turnDispatchIdentity(turn)),
      ]);
      if (storedFingerprint !== replayFingerprint) {
        if (turn.kind === "agent") await this.releaseOwnerGate(turn);
        return json(
          {
            error: "Turn dispatch was replayed with different input.",
            turnId: turn.turnId,
          },
          409,
        );
      }
      try {
        await this.assertTurnWritable(storedTurn);
        if (turn.kind === "agent") {
          this.assertAgentTurnIdentity(turn);
          if (this.agentTurnExecutions.has(turn.turnId)) {
            return this.agentTurnAccepted(turn, true, { inProgress: true });
          }
          const [executionMarker, fallbackJournal] = await Promise.all([
            this.exactAgentExecutionMarker(storedTurn),
            this.ctx.storage.get<BuilderFallbackTranscript>(
              builderFallbackTranscriptKey(
                storedTurn.turnId,
                storedTurn.attemptGeneration!,
              ),
            ),
          ]);
          if (executionMarker || fallbackJournal) {
            await this.setExactTurnAlarm(storedTurn, Date.now());
            return json(
              { accepted: false, replayed: true, recoveryPending: true },
              425,
            );
          }
          const pending: PendingTerminal = {
            turnId: turn.turnId,
            attemptGeneration: turn.attemptGeneration!,
            kind: "failed",
            payload: {
              message:
                "The cloud worker restarted before this agent could finish. Try again.",
            },
            threadError:
              "The cloud worker restarted before this agent could finish.",
            terminateSandbox: true,
          };
          if (!(await this.claimTerminalDecision(storedTurn, pending))) {
            await this.releaseOwnerGate(turn);
            return json(
              { accepted: false, replayed: true, reason: "superseded" },
              409,
            );
          }
          await this.setExactTurnAlarm(storedTurn, Date.now());
          return json(
            { accepted: false, replayed: true, recoveryPending: true },
            425,
          );
        }
        this.assertAppTurnIdentity(storedTurn);
        const running = this.appTurnExecutions.get(turn.turnId);
        if (running) {
          return json(
            { accepted: true, replayed: true, inProgress: true },
            202,
          );
        }
        const pending: PendingTerminal = {
          turnId: turn.turnId,
          attemptGeneration: turn.attemptGeneration ?? 1,
          kind: "failed",
          payload: {
            message:
              "The cloud worker restarted before this change could finish. Try again.",
          },
          terminateSandbox: true,
        };
        if (!(await this.claimTerminalDecision(storedTurn, pending))) {
          return json(
            { accepted: false, replayed: true, reason: "superseded" },
            409,
          );
        }
        await this.setExactTurnAlarm(storedTurn, Date.now());
        return json(
          { accepted: false, replayed: true, recoveryPending: true },
          425,
        );
      } catch (error) {
        if (error instanceof OwnerPurgeFenceError) {
          return json({ error: "Owner cloud activity is being purged." }, 409);
        }
        if (error instanceof AgentTurnAuthorityLostError) {
          return json(
            { error: "Cloud agent attempt is no longer active." },
            409,
          );
        }
        if (error instanceof AppTurnAuthorityLostError) {
          return json({ error: "Cloud app attempt is no longer active." }, 409);
        }
        throw error;
      }
    }
    let admitted = false;
    if (turn.kind === "agent") {
      const gate = await this.admitAgentTurnThroughOwnerGate(turn);
      if (!gate.ok) return gate.response;
      admitted = true;
    }
    try {
      delete turn.ownerPurgeGeneration;
      delete turn.ownerPurgeLeaseId;
      turn.ownerPurgeGeneration = await this.registerTurn(turn);
      await this.assertTurnWritable(turn);
      if (turn.kind === "agent") {
        this.assertAgentTurnIdentity(turn);
        return await this.acceptAgentTurn(turn);
      }
      return json({ error: "Unsupported turn kind." }, 400);
    } catch (error) {
      await this.unregisterTurn(turn);
      if (admitted) await this.releaseOwnerGate(turn);
      if (error instanceof OwnerPurgeFenceError) {
        return json({ error: "Owner cloud activity is being purged." }, 409);
      }
      if (error instanceof AgentTurnAuthorityLostError) {
        return json({ error: "Cloud agent attempt is no longer active." }, 409);
      }
      if (error instanceof AppTurnAuthorityLostError) {
        return json({ error: "Cloud app attempt is no longer active." }, 409);
      }
      throw error;
    }
  }

  private admitAgentTurnThroughOwnerGate(
    turn: TurnRequest,
  ): Promise<
    { ok: true; snapshot: OwnerSnapshot } | { ok: false; response: Response }
  > {
    return admitAgentTurnThroughOwnerGate(this.self, turn);
  }

  private agentTurnAccepted(
    turn: TurnRequest,
    replayed: boolean,
    extra: Record<string, unknown> = {},
  ): Response {
    return agentTurnAccepted(this.self, turn, replayed, extra);
  }

  private acceptAgentTurn(turn: TurnRequest): Promise<Response> {
    return acceptAgentTurn(this.self, turn);
  }

  private runAgentTurn(
    turn: TurnRequest,
    sandboxId: string | undefined,
    execution: TurnExecutionContext,
  ): Promise<void> {
    return runAgentTurn(this.self, turn, sandboxId, execution);
  }

  private runContainerAgentTurn(
    turn: TurnRequest,
    sandboxId: string,
    execution: TurnExecutionContext,
  ): Promise<void> {
    return runContainerAgentTurn(this.self, turn, sandboxId, execution);
  }

  private attachAgentWorld(
    args: Parameters<typeof attachAgentWorld>[1],
  ): ReturnType<typeof attachAgentWorld> {
    return attachAgentWorld(this.self, args);
  }

  private runAgentAttempt(
    args: Parameters<typeof runAgentAttempt>[1],
  ): ReturnType<typeof runAgentAttempt> {
    return runAgentAttempt(this.self, args);
  }
}
