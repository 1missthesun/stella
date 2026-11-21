import { EXACT_TURN_CANCELLATIONS_KEY } from "../execution-placement-turn-cancellation.js";
import {
  nativeStateCheckpointPrefix,
  parseNativeStateCheckpointRecord,
} from "../native-state-checkpoint.js";
import { deliverOwnerEvents } from "../owner-events.js";
import { isSandboxDestroyDebtKey } from "../sandbox-lifecycle.js";
import {
  appendThreadMessages,
  nextTurnEventSeq,
  readThreadHistory,
  reserveTurnEventSeq,
  type ThreadMessageInput,
} from "../thread-transcript.js";
import type { BuildSessionInternals } from "./host.js";
import {
  AGENT_CONTAINER_LARGE_KEY,
  AGENT_CONTAINER_SIZE_KEY,
  CONTAINER_OOM_BASELINE_KEY,
  BACKUP_ID_PATTERN,
  OWNER_EVENT_DEBT_KEY,
  OWNER_EVENT_DEBT_MAX,
  OWNER_EVENT_DEBT_RETRY_MS,
  R2_SWEEP_MAX_PAGES,
  TERMINAL_EVENT_STATUS,
  agentExecutionMarkerKey,
  buildOwnerFenceLeaseReceiptKey,
  builderFallbackTranscriptKey,
  errorMessage,
  exactTurnIdentityMatches,
  isBuildOwnerFenceDurabilityKey,
  log,
  nativeBackupDebtKey,
  nativeTransientBackupKey,
  sweepR2Prefix,
} from "./shared/keys.js";
import {
  AgentTurnAuthorityLostError,
  OwnerPurgeFenceError,
  TurnStateOwnerCallError,
} from "./shared/errors.js";
import type {
  AgentExecutionMarker,
  BuildOwnerFenceLeaseReceipt,
  BuilderFallbackTranscript,
  NativeTransientBackup,
  PendingTerminal,
  TurnRequest,
  WorkspaceBackupDebt,
} from "./shared/types.js";
import type { TurnExecutionContext } from "../turn-cancellation.js";
import {
  OWNER_EVENT_VERSION,
  type OwnerEvent,
  type TurnEventEvent,
} from "@stella/contracts/turn-plane/owner-events";
import type { AgentHistoryRow } from "@stella/executor-cloud/agent-history";
import { ownerGateStub } from "../rpc-release.js";
import { writeThreadToAgentLog } from "./agent-log-bridge.js";

export type SessionCoreHost = Pick<
  BuildSessionInternals,
  | "ctx"
  | "env"
  | "runningTurns"
  | "armOwnerFenceLeaseReconciliationAlarm"
  | "assertAgentTurnIdentity"
  | "assertTurnWritable"
  | "appendThreadTranscript"
  | "ownerFence"
  | "cleanupTransientWrites"
  | "deleteTurnStoragePreservingExactCancellations"
  | "deliverTerminal"
  | "emitTurnEvent"
  | "deliverOwnerEventsDurable"
  | "fetchCanonicalAgentHistory"
  | "hasOwnerFenceLeaseRetirementDebt"
  | "mutateExactTurn"
  | "ownerEventBase"
  | "ownerFenceLeaseSlotKey"
  | "ownerFenceReceiptMatches"
  | "ownerGateFor"
  | "ownsExactTurn"
  | "registerBuildOwnerFenceLease"
  | "registerTurn"
  | "retireBuildOwnerFenceLease"
  | "scheduleDurabilityAlarm"
  | "scheduleSandboxDestroyDebtAlarm"
  | "settleTerminalTransientWrites"
  | "unregisterTurn"
  | "unregisterTurnLease"
>;

export const deleteTurnStoragePreservingExactCancellations = async (
  host: SessionCoreHost,
  expectedTurn?: TurnRequest,
  deleteAlarm = false,
): Promise<boolean> => {
  const deleted = await host.ctx.blockConcurrencyWhile(async () => {
    if (
      expectedTurn &&
      !exactTurnIdentityMatches(
        await host.ctx.storage.get<TurnRequest>("turn"),
        expectedTurn,
      )
    ) {
      return false;
    }
    const listed = [...(await host.ctx.storage.list<unknown>()).keys()];
    const hasDestroyDebt = listed.some(isSandboxDestroyDebtKey);
    const hasOwnerFenceDebt = listed.some(isBuildOwnerFenceDurabilityKey);
    const hasOwnerEventDebt = listed.includes(OWNER_EVENT_DEBT_KEY);
    const keys = listed.filter(
      (key) =>
        key !== EXACT_TURN_CANCELLATIONS_KEY &&
        key !== OWNER_EVENT_DEBT_KEY &&
        key !== AGENT_CONTAINER_LARGE_KEY &&
        key !== AGENT_CONTAINER_SIZE_KEY &&
        key !== CONTAINER_OOM_BASELINE_KEY &&
        !isSandboxDestroyDebtKey(key) &&
        !isBuildOwnerFenceDurabilityKey(key),
    );
    let deleted = false;
    await host.ctx.storage.transaction(async (txn) => {
      if (
        expectedTurn &&
        !exactTurnIdentityMatches(
          await txn.get<TurnRequest>("turn"),
          expectedTurn,
        )
      ) {
        return;
      }
      if (keys.length > 0) await txn.delete(keys);
      if (
        deleteAlarm &&
        !hasDestroyDebt &&
        !hasOwnerFenceDebt &&
        !hasOwnerEventDebt
      ) {
        await txn.deleteAlarm();
      }
      deleted = true;
    });
    return deleted;
  });
  if (deleted) await host.scheduleDurabilityAlarm();
  return deleted;
};

export const ownerGateFor = (host: SessionCoreHost, ownerId: string) => {
  return ownerGateStub(host.env.OWNER_GATES, ownerId);
};

export const releaseOwnerGate = async (
  host: SessionCoreHost,
  turn: TurnRequest,
): Promise<void> => {
  if (!turn.ownerId || turn.agentRole === "orchestrator") return;
  try {
    await host.ownerGateFor(turn.ownerId).release({ turnId: turn.turnId });
  } catch (error) {
    log("error", "owner_gate_release_failed", {
      turnId: turn.turnId,
      message: errorMessage(error),
    });
  }
};

export const ownerEventBase = (
  host: SessionCoreHost,
  turn: TurnRequest,
  key: string,
) => {
  return {
    v: OWNER_EVENT_VERSION,
    key,
    ownerId: turn.ownerId,
    ownerGeneration: turn.ownerGeneration,
    emittedAt: Date.now(),
  } as const;
};

const finishesAttempt = (event: OwnerEvent): boolean =>
  event.kind === "thread.completed" || (event.kind === "turn.event" && event.terminal === true);

/** Drops the oldest progress events past the cap; an attempt's finish is never dropped. */
const capOwnerEventDebt = (events: OwnerEvent[]): OwnerEvent[] => {
  let excess = events.length - OWNER_EVENT_DEBT_MAX;
  if (excess <= 0) return events;
  const kept = events.filter((event) => {
    if (excess <= 0 || finishesAttempt(event)) return true;
    excess -= 1;
    return false;
  });
  log("error", "owner_event_debt_trimmed", { dropped: events.length - kept.length, kept: kept.length });
  return kept;
};

export const deliverOwnerEventsDurable = async (
  host: SessionCoreHost,
  events: OwnerEvent[],
): Promise<void> => {
  if (events.length === 0) return;
  try {
    await deliverOwnerEvents(host.env, events);
    return;
  } catch (error) {
    log("error", "owner_events_deferred", {
      events: events.map((event) => `${event.kind}:${event.key}`),
      message: errorMessage(error),
    });
  }
  await host.ctx.blockConcurrencyWhile(async () => {
    const debt =
      (await host.ctx.storage.get<OwnerEvent[]>(OWNER_EVENT_DEBT_KEY)) ?? [];
    await host.ctx.storage.put(OWNER_EVENT_DEBT_KEY, capOwnerEventDebt([...debt, ...events]));
    const retryAt = Date.now() + OWNER_EVENT_DEBT_RETRY_MS;
    const current = await host.ctx.storage.getAlarm();
    if (current === null || current > retryAt) {
      await host.ctx.storage.setAlarm(retryAt);
    }
  });
};

export const retryOwnerEventDebt = async (host: SessionCoreHost): Promise<void> => {
  const debt = await host.ctx.storage.get<OwnerEvent[]>(OWNER_EVENT_DEBT_KEY);
  if (!debt || debt.length === 0) return;
  try {
    await deliverOwnerEvents(host.env, debt);
    await host.ctx.storage.delete(OWNER_EVENT_DEBT_KEY);
  } catch (error) {
    log("error", "owner_events_retry_failed", {
      events: debt.length,
      message: errorMessage(error),
    });
    const retryAt = Date.now() + OWNER_EVENT_DEBT_RETRY_MS;
    const current = await host.ctx.storage.getAlarm();
    if (current === null || current > retryAt) {
      await host.ctx.storage.setAlarm(retryAt);
    }
  }
};

export const emitTurnEvent = async (
  host: SessionCoreHost,
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
): Promise<number> => {
  options.signal?.throwIfAborted();
  await host.assertTurnWritable(turn);
  options.signal?.throwIfAborted();
  const attemptGeneration = turn.attemptGeneration ?? 1;
  let eventSeq: number;
  if (options.eventSeq === undefined) {
    eventSeq = nextTurnEventSeq(
      host.ctx.storage.sql,
      turn.turnId,
      attemptGeneration,
    );
  } else {
    eventSeq = options.eventSeq;
    reserveTurnEventSeq(
      host.ctx.storage.sql,
      turn.turnId,
      attemptGeneration,
      eventSeq,
    );
  }
  const terminal = options.terminal === true;
  const event: TurnEventEvent = {
    ...host.ownerEventBase(turn, `${turn.turnId}:${attemptGeneration}:${eventSeq}`),
    kind: "turn.event",
    turnId: turn.turnId,
    attemptGeneration,
    sessionId: turn.threadId ?? turn.sessionId ?? host.ctx.id.toString(),
    eventSeq,
    eventKind,
    payload,
    terminal,
    ...(terminal
      ? { terminalStatus: TERMINAL_EVENT_STATUS[eventKind] ?? "failed" }
      : {}),
    ...(options.errorMessage ? { errorMessage: options.errorMessage } : {}),
    ...(options.resultJson ? { resultJson: options.resultJson } : {}),
    createdAt: Date.now(),
  };
  if (turn.agentRole !== "orchestrator") {
    await host.deliverOwnerEventsDurable([event]);
  }
  return eventSeq;
};

export const appendThreadTranscript = async (
  host: SessionCoreHost,
  turn: TurnRequest,
  messages: readonly ThreadMessageInput[],
): Promise<void> => {
  if (!turn.threadId) {
    throw new AgentTurnAuthorityLostError();
  }
  const attemptGeneration = turn.attemptGeneration ?? 1;
  appendThreadMessages(host.ctx.storage.sql, {
    turnId: turn.turnId,
    attemptGeneration,
    messages,
    now: Date.now(),
  });
  await writeThreadToAgentLog(host, turn, messages);
};

export const trackTurn = <T>(
  host: SessionCoreHost,
  turnId: string,
  work: Promise<T>,
): Promise<T> => {
  const active = host.runningTurns.get(turnId) ?? new Set<Promise<unknown>>();
  const tracked = work.finally(() => {
    active.delete(tracked);
    if (active.size === 0) {
      host.runningTurns.delete(turnId);
    }
  });
  active.add(tracked);
  host.runningTurns.set(turnId, active);
  return tracked;
};

const ownerTurnStateEnvelope = (
  host: SessionCoreHost,
  turn: TurnRequest,
): {
  schemaVersion: 1;
  ownerId: string;
  ownerGeneration: string;
  generation: string;
  leaseId: string;
  sessionId: string;
  turnId: string;
} => {
  if (
    !turn.ownerPurgeGeneration ||
    !turn.ownerPurgeLeaseId ||
    !turn.ownerGeneration
  ) {
    throw new OwnerPurgeFenceError();
  }
  return {
    schemaVersion: 1,
    ownerId: turn.ownerId,
    ownerGeneration: turn.ownerGeneration,
    generation: turn.ownerPurgeGeneration,
    leaseId: turn.ownerPurgeLeaseId,
    sessionId: host.ctx.id.toString(),
    turnId: turn.turnId,
  };
};

export const callOwnerTurnState = async <T>(
  host: SessionCoreHost,
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
): Promise<T> => {
  const result = await host
    .ownerFence(turn.ownerId)
    .turnState(path, { ...body, ...ownerTurnStateEnvelope(host, turn) });
  if (!result.ok) throw new TurnStateOwnerCallError(result.status, result.code);
  if (
    new TextEncoder().encode(JSON.stringify(result.value ?? null)).byteLength >
    256 * 1024
  ) {
    throw new Error("Turn state owner response exceeded its bound.");
  }
  return result.value as T;
};

export const registerTurn = async (
  host: SessionCoreHost,
  turn: TurnRequest,
  freshLease = false,
): Promise<string> => {
  const kind = freshLease ? "aux" : "run";
  const slotKey = await host.ownerFenceLeaseSlotKey(turn, kind);
  const grant = await host.registerBuildOwnerFenceLease({
    turn,
    kind,
    slotKey,
    role: kind,
    mutateTurn: true,
  });
  return grant.generation;
};

export const unregisterTurn = async (
  host: SessionCoreHost,
  turn: TurnRequest,
): Promise<void> => {
  if (!turn.ownerPurgeLeaseId) return;
  const hasTransientWrites =
    Boolean(
      await host.ctx.storage.get<NativeTransientBackup>(
        nativeTransientBackupKey(turn.turnId),
      ),
    ) ||
    Boolean(
      await host.ctx.storage.get<AgentExecutionMarker>(
        agentExecutionMarkerKey(turn.turnId, turn.attemptGeneration!),
      ),
    ) ||
    Boolean(
      await host.ctx.storage.get<BuilderFallbackTranscript>(
        builderFallbackTranscriptKey(turn.turnId, turn.attemptGeneration!),
      ),
    );
  if (hasTransientWrites) {
    try {
      await host.assertTurnWritable(turn);
      return;
    } catch (error) {
      if (!(error instanceof OwnerPurgeFenceError)) return;
      try {
        await host.cleanupTransientWrites(turn);
      } catch (cleanupError) {
        log("error", "owner_purge_transient_cleanup_failed", {
          turnId: turn.turnId,
          message: errorMessage(cleanupError),
        });
        return;
      }
    }
  }
  await host.unregisterTurnLease(
    turn,
    turn.ownerPurgeLeaseId,
    turn.ownerPurgeGeneration,
  );
};

export const unregisterTurnLease = async (
  host: SessionCoreHost,
  turn: TurnRequest,
  leaseId: string,
  generation?: string,
): Promise<boolean> => {
  const key = buildOwnerFenceLeaseReceiptKey(leaseId);
  let receipt = await host.ctx.storage.get<BuildOwnerFenceLeaseReceipt>(key);
  if (receipt && !host.ownerFenceReceiptMatches(receipt, turn, leaseId)) {
    throw new OwnerPurgeFenceError();
  }
  if (!receipt) {
    const now = Date.now();
    receipt = {
      schemaVersion: 1,
      ownerId: turn.ownerId,
      ownerGeneration: turn.ownerGeneration,
      turnId: turn.turnId,
      leaseId,
      kind: "run",
      phase: "unregister_pending",
      ...(generation ? { registrationGeneration: generation } : {}),
      createdAt: now,
      updatedAt: now,
    };
    await host.ctx.storage.put(key, receipt);
  }
  return await host.retireBuildOwnerFenceLease(receipt, generation);
};

const appendNativeBackupDebt = async (
  host: SessionCoreHost,
  workspaceKey: string,
  backupId: string,
): Promise<void> => {
  if (!BACKUP_ID_PATTERN.test(backupId)) {
    throw new Error("Invalid transient native backup id.");
  }
  const debtKey = nativeBackupDebtKey(workspaceKey);
  const existing = (await host.env.APP_ROUTES.get<WorkspaceBackupDebt>(
    debtKey,
    "json",
  )) ?? { backupIds: [] };
  const backupIds = [...new Set([...existing.backupIds, backupId])];
  if (backupIds.length > 100) {
    throw new Error("Native backup cleanup debt is too large.");
  }
  await host.env.APP_ROUTES.put(
    debtKey,
    JSON.stringify({ backupIds } satisfies WorkspaceBackupDebt),
  );
};

export const sweepNativeBackupDebt = async (
  host: SessionCoreHost,
  workspaceKey: string,
): Promise<void> => {
  const debtKey = nativeBackupDebtKey(workspaceKey);
  const debt = await host.env.APP_ROUTES.get<WorkspaceBackupDebt>(
    debtKey,
    "json",
  );
  if (!debt?.backupIds.length) return;
  const referenced = new Set<string>();
  let cursor: string | undefined;
  let listingComplete = false;
  for (let page = 0; page < R2_SWEEP_MAX_PAGES; page += 1) {
    const listing = await host.env.APP_ROUTES.list({
      prefix: nativeStateCheckpointPrefix(workspaceKey),
      limit: 1_000,
      ...(cursor ? { cursor } : {}),
    });
    for (const entry of listing.keys) {
      const raw = await host.env.APP_ROUTES.get<unknown>(entry.name, "json");
      const record = raw ? parseNativeStateCheckpointRecord(raw) : null;
      if (!record) continue;
      for (const version of [
        ...(record.committed ? [record.committed] : []),
        ...record.candidates,
      ]) {
        referenced.add(version.descriptor.id);
      }
    }
    if (listing.list_complete) {
      listingComplete = true;
      break;
    }
    cursor = listing.cursor;
    if (!cursor) break;
  }
  if (!listingComplete) {
    throw new Error("Native checkpoint reference listing was truncated.");
  }

  const remaining: string[] = [];
  for (const backupId of debt.backupIds) {
    if (!BACKUP_ID_PATTERN.test(backupId) || referenced.has(backupId)) {
      remaining.push(backupId);
      continue;
    }
    try {
      const swept = await sweepR2Prefix(
        host.env.BACKUP_BUCKET,
        `backups/${backupId}/`,
      );
      if (!swept.done) remaining.push(backupId);
    } catch {
      remaining.push(backupId);
    }
  }
  if (remaining.length > 0) {
    await host.env.APP_ROUTES.put(
      debtKey,
      JSON.stringify({ backupIds: remaining } satisfies WorkspaceBackupDebt),
    );
  } else {
    await host.env.APP_ROUTES.delete(debtKey);
  }
};

const settleNativeTransientBackup = async (
  host: SessionCoreHost,
  turn: TurnRequest,
): Promise<boolean> => {
  const markerKey = nativeTransientBackupKey(turn.turnId);
  const marker = await host.ctx.storage.get<NativeTransientBackup>(markerKey);
  if (!marker) return true;
  if (
    !BACKUP_ID_PATTERN.test(marker.backupId) ||
    !marker.checkpointKey.startsWith(
      nativeStateCheckpointPrefix(marker.workspaceKey),
    )
  ) {
    log("error", "native_transient_backup_marker_invalid", {
      turnId: turn.turnId,
    });
    return false;
  }
  const raw = await host.env.APP_ROUTES.get<unknown>(
    marker.checkpointKey,
    "json",
  );
  const record = raw ? parseNativeStateCheckpointRecord(raw) : null;
  const referenced = record
    ? [
        ...(record.committed ? [record.committed] : []),
        ...record.candidates,
      ].some((version) => version.descriptor.id === marker.backupId)
    : false;
  try {
    if (!referenced) {
      await appendNativeBackupDebt(host, marker.workspaceKey, marker.backupId);
    }
    await host.ctx.storage.delete(markerKey);
    return true;
  } catch (error) {
    log("error", "native_transient_backup_settlement_failed", {
      turnId: turn.turnId,
      message: errorMessage(error),
    });
    return false;
  }
};

export const cleanupTransientWrites = async (
  host: SessionCoreHost,
  turn: TurnRequest,
): Promise<void> => {
  const nativeMarker = await host.ctx.storage.get<NativeTransientBackup>(
    nativeTransientBackupKey(turn.turnId),
  );
  if (nativeMarker) {
    if (!BACKUP_ID_PATTERN.test(nativeMarker.backupId)) {
      throw new Error("Transient native backup descriptor is invalid.");
    }
    const swept = await sweepR2Prefix(
      host.env.BACKUP_BUCKET,
      `backups/${nativeMarker.backupId}/`,
    );
    if (!swept.done) {
      throw new Error("Transient native backup cleanup was truncated.");
    }
    await host.ctx.storage.delete(nativeTransientBackupKey(turn.turnId));
  }
};

export const cleanupOwnerPurgedTurnStorage = async (
  host: SessionCoreHost,
  turn: TurnRequest,
): Promise<boolean> => {
  await host.cleanupTransientWrites(turn);
  if (!(await host.ownsExactTurn(turn))) return false;
  return await host.deleteTurnStoragePreservingExactCancellations(turn, true);
};

export const settleTerminalTransientWrites = async (
  host: SessionCoreHost,
  turn: TurnRequest,
): Promise<boolean> => await settleNativeTransientBackup(host, turn);

/**
 * A turn stored before app builds left BuildSession (1a6b6092e, 2026-09-11)
 * has no live path left: retire its owner lease and storage so its alarm
 * ends instead of entering agent recovery with an app turn's identity.
 */
export const retireLegacyAppTurn = async (
  host: Pick<
    SessionCoreHost,
    "deleteTurnStoragePreservingExactCancellations" | "unregisterTurnLease"
  >,
  turn: TurnRequest,
): Promise<void> => {
  log("info", "legacy_app_turn_retired", { turnId: turn.turnId });
  if (turn.ownerPurgeLeaseId) {
    await host
      .unregisterTurnLease(turn, turn.ownerPurgeLeaseId, turn.ownerPurgeGeneration)
      .catch((error: unknown) => {
        log("error", "legacy_app_turn_lease_retire_failed", {
          turnId: turn.turnId,
          message: errorMessage(error),
        });
      });
  }
  await host.deleteTurnStoragePreservingExactCancellations(turn, true);
};

export const redeliverOrphan = async (
  host: SessionCoreHost,
  turn: TurnRequest,
  pending: PendingTerminal,
): Promise<void> => {
  try {
    turn.ownerPurgeGeneration = await host.registerTurn(turn, true);
    await host.assertTurnWritable(turn);
    await host.deliverTerminal(turn, pending);
  } catch (error) {
    if (!(error instanceof OwnerPurgeFenceError)) throw error;
  } finally {
    await host.unregisterTurn(turn);
  }
};

export const assertTurnWritable = async (
  host: SessionCoreHost,
  turn: TurnRequest,
): Promise<void> => {
  if (
    !turn.ownerGeneration ||
    !turn.ownerPurgeGeneration ||
    !turn.ownerPurgeLeaseId
  ) {
    throw new OwnerPurgeFenceError();
  }
  const result = await host.ownerFence(turn.ownerId).assert({
    ownerGeneration: turn.ownerGeneration,
    generation: turn.ownerPurgeGeneration,
    leaseId: turn.ownerPurgeLeaseId,
  });
  if (!result.ok) throw new OwnerPurgeFenceError();
};

const assertAgentTurnActive = async (
  host: SessionCoreHost,
  turn: TurnRequest,
): Promise<void> => {
  await host.assertTurnWritable(turn);
  if (
    !(await host.ownsExactTurn(turn)) ||
    (await host.ctx.storage.get<boolean>("terminal"))
  ) {
    throw new Error("The agent turn is no longer active.");
  }
};

export const assertAgentTurnIdentity = (
  host: SessionCoreHost,
  turn: TurnRequest,
): void => {
  if (
    !turn.threadId ||
    !turn.conversationId ||
    !Number.isSafeInteger(turn.attemptGeneration) ||
    turn.attemptGeneration! < 1
  ) {
    throw new AgentTurnAuthorityLostError();
  }
};

export const fetchCanonicalAgentHistory = (
  host: SessionCoreHost,
  turn: TurnRequest,
  options: { excludeCurrentTurn: boolean; signal?: AbortSignal },
): AgentHistoryRow[] => {
  options.signal?.throwIfAborted();
  if (!turn.threadId) return [];
  return readThreadHistory(host.ctx.storage.sql, {
    ...(options.excludeCurrentTurn ? { excludeTurnId: turn.turnId } : {}),
  });
};

export const assertAgentExecutionActive = async (
  host: SessionCoreHost,
  turn: TurnRequest,
  execution: TurnExecutionContext,
): Promise<void> => {
  execution.assertActive();
  await assertAgentTurnActive(host, turn);
  host.assertAgentTurnIdentity(turn);
  execution.assertActive();
};

export const scheduleDurabilityAlarm = async (
  host: SessionCoreHost,
): Promise<void> => {
  await host.scheduleSandboxDestroyDebtAlarm();
  if (await host.hasOwnerFenceLeaseRetirementDebt()) {
    await host.armOwnerFenceLeaseReconciliationAlarm();
  }
  const ownerEventDebt = await host.ctx.storage.get<OwnerEvent[]>(OWNER_EVENT_DEBT_KEY);
  if (ownerEventDebt && ownerEventDebt.length > 0) {
    const retryAt = Date.now() + OWNER_EVENT_DEBT_RETRY_MS;
    const current = await host.ctx.storage.getAlarm();
    if (current === null || current > retryAt) {
      await host.ctx.storage.setAlarm(retryAt);
    }
  }
};

export const ownsExactTurn = async (
  host: SessionCoreHost,
  turn: TurnRequest,
): Promise<boolean> => {
  return exactTurnIdentityMatches(
    await host.ctx.storage.get<TurnRequest>("turn"),
    turn,
  );
};

export const mutateExactTurn = async (
  host: SessionCoreHost,
  turn: TurnRequest,
  operation: (txn: DurableObjectTransaction) => Promise<void>,
): Promise<boolean> => {
  return await host.ctx.storage.transaction(async (txn) => {
    if (!exactTurnIdentityMatches(await txn.get<TurnRequest>("turn"), turn)) {
      return false;
    }
    await operation(txn);
    return true;
  });
};

export const setExactTurnAlarm = async (
  host: SessionCoreHost,
  turn: TurnRequest,
  scheduledTime: number,
): Promise<boolean> => {
  return await host.mutateExactTurn(turn, async (txn) => {
    await txn.setAlarm(scheduledTime);
  });
};

export const event = (
  host: SessionCoreHost,
  turn: TurnRequest,
  seq: number | "auto",
  kind: string,
  payload: unknown,
  terminal = false,
  executionSignal?: AbortSignal,
): Promise<number> => {
  return host.emitTurnEvent(turn, kind, payload, {
    terminal,
    ...(seq === "auto" ? {} : { eventSeq: seq }),
    ...(executionSignal ? { signal: executionSignal } : {}),
  });
};
