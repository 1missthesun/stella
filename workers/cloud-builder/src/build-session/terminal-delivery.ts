import { isAgentStopReason } from "@stella/contracts/agent-status";
import { agentAttemptOutcomeOf } from "@stella/contracts/agent-status";
import { Effect } from "effect";
import type { ThreadCompletedEvent } from "@stella/contracts/turn-plane/owner-events";
import { runToolEffect } from "@stella/runtime/kernel/tools/effect-runtime.js";
import {
  CLOUD_CLI_TURN_DO_PATHS,
  type CloudCliTurnTerminal,
} from "@stella/contracts/cloud-orchestrator-cli";
import {
  purgeOrchestratorCliTurnStore,
  readOrchestratorCliTerminal,
  recordOrchestratorCliTerminal,
} from "../orchestrator-cli-turn-store.js";
import type {
  ExactTurnCancellation,
  ExactTurnCancellationRequest,
} from "../execution-placement-turn-cancellation.js";
import {
  SandboxLifecycleDeferredError,
  sandboxLifecycleFailureFields,
} from "../sandbox-lifecycle.js";
import {
  nextTurnEventSeq,
  purgeThreadTranscript,
} from "../thread-transcript.js";
import type { BuildSessionInternals } from "./host.js";
import {
  AGENT_WATCHDOG_DEADLINE_KEY,
  OWNER_PURGE_STALE_LEASE_GRACE_MS,
  callOrchestratorCliTurnRoute,
  errorMessage,
  exactTurnIdentityMatches,
  json,
  log,
} from "./shared/keys.js";
import { OwnerPurgeFenceError } from "./shared/errors.js";
import type {
  PendingTerminal,
  TurnRequest,
} from "./shared/types.js";

export type TerminalDeliveryHost = Pick<
  BuildSessionInternals,
  | "ctx"
  | "env"
  | "runningTurns"
  | "appTurnExecutions"
  | "agentTurnExecutions"
  | "exactTurnCancellations"
  | "acknowledgeExactAgentTurnCancellation"
  | "assertTurnWritable"
  | "claimTerminalDecision"
  | "cleanupTransientWrites"
  | "currentSandboxTarget"
  | "deleteTurnStoragePreservingExactCancellations"
  | "deliverTerminal"
  | "destroySandboxDurably"
  | "deliverOwnerEventsDurable"
  | "event"
  | "mutateExactTurn"
  | "ownerEventBase"
  | "ownsExactTurn"
  | "registerTurn"
  | "releaseOwnerGate"
  | "runAlarmWithLease"
  | "setExactTurnAlarm"
  | "settleAgentTransientBackup"
  | "terminateCurrentAgentSession"
  | "unregisterTurnLease"
>;

export const claimTerminalDecision = async (
  host: TerminalDeliveryHost,
  turn: TurnRequest,
  pending: PendingTerminal,
  alarmAt?: number,
): Promise<boolean> => {
  return await host.ctx.storage.transaction(async (txn) => {
    const [currentTurn, terminalAlreadyDecided, decided] = await Promise.all([
      txn.get<TurnRequest>("turn"),
      txn.get<boolean>("terminal"),
      txn.get<PendingTerminal>("pendingTerminal"),
    ]);
    if (!exactTurnIdentityMatches(currentTurn, turn)) return false;
    if (
      terminalAlreadyDecided &&
      (!decided ||
        decided.turnId !== pending.turnId ||
        decided.kind !== pending.kind ||
        decided.eventKind !== pending.eventKind)
    ) {
      return false;
    }
    await txn.put({
      terminal: true,
      pendingTerminal: pending,
      alarmAttempts: 0,
    });
    if (alarmAt !== undefined) {
      await txn.setAlarm(alarmAt);
    }
    return true;
  });
};

export const deliverTerminal = async (
  host: TerminalDeliveryHost,
  turn: TurnRequest,
  pendingInput: PendingTerminal,
  options: { preservePendingTerminal?: boolean } = {},
): Promise<boolean> => {
  let pending = pendingInput;
  const owns = await host.ownsExactTurn(turn);
  if (
    (turn.kind === "agent" &&
      (!Number.isSafeInteger(turn.attemptGeneration) ||
        pending.attemptGeneration !== turn.attemptGeneration)) ||
    (turn.kind !== "agent" && pending.attemptGeneration !== 1)
  ) {
    log("error", "terminal_attempt_generation_mismatch", {
      turnId: turn.turnId,
      pendingAttemptGeneration: pending.attemptGeneration,
      turnAttemptGeneration: turn.attemptGeneration,
    });
    return false;
  }
  const decided: PendingTerminal = {
    ...pending,
    eventSeq:
      pending.eventSeq ??
      nextTurnEventSeq(
        host.ctx.storage.sql,
        turn.turnId,
        turn.attemptGeneration ?? 1,
      ),
    completedAt: pending.completedAt ?? Date.now(),
  };
  pending = decided;
  if (owns) {
    if (!(await host.claimTerminalDecision(turn, decided))) {
      const current =
        await host.ctx.storage.get<PendingTerminal>("pendingTerminal");
      log("info", "terminal_decision_superseded", {
        turnId: turn.turnId,
        attemptedKind: pending.kind,
        decidedKind: current?.kind,
      });
      return false;
    }
  }
  try {
    await host.event(
      turn,
      pending.eventSeq ?? "auto",
      pending.eventKind ?? pending.kind,
      pending.payload,
      true,
    );
    if (turn.agentRole === "orchestrator") {
      await deliverOrchestratorCliTerminal(host, turn, pending);
    } else if (turn.kind === "agent" && turn.threadId) {
      const finalText =
        typeof pending.payload.finalText === "string"
          ? pending.payload.finalText
          : "";
      const completedAt = pending.completedAt ?? Date.now();
      const resultJson =
        pending.kind === "completed"
          ? JSON.stringify({ finalText })
          : undefined;
      const errorMessage =
        pending.kind === "completed"
          ? undefined
          : (pending.threadError ?? "The agent stopped.");
      await host.deliverOwnerEventsDurable([
        {
          ...host.ownerEventBase(
            turn,
            `${turn.threadId}:${turn.turnId}:${turn.attemptGeneration ?? 1}`,
          ),
          kind: "thread.completed",
          threadId: turn.threadId,
          turnId: turn.turnId,
          attemptGeneration: turn.attemptGeneration ?? 1,
          status: agentAttemptOutcomeOf({ status: pending.kind }),
          ...(resultJson ? { resultJson } : {}),
          ...(errorMessage ? { errorMessage } : {}),
          completedAt,
        } satisfies ThreadCompletedEvent,
      ]);
    }
    if (owns) {
      await host.ctx.storage.transaction(async (txn) => {
        if (
          !exactTurnIdentityMatches(await txn.get<TurnRequest>("turn"), turn)
        ) {
          return;
        }
        await txn.put("terminalDelivered", true);
        if (!options.preservePendingTerminal) {
          await txn.delete("pendingTerminal");
        }
      });
    }
    await host.releaseOwnerGate(turn);
    return true;
  } catch (error) {
    log("error", "terminal_delivery_failed", {
      turnId: turn.turnId,
      threadId: turn.threadId,
      kind: pending.kind,
      message: errorMessage(error),
    });
    if (!owns) return false;
    // No exponential ladder any more: delivery is an owner event plus a
    // Durable Object call, both of which fail fast and locally. The one
    // fixed retry exists so an unreachable owner or a parent object that is
    // briefly unavailable does not strand a decided terminal.
    let attempts = 0;
    const retained = await host.ctx.storage.transaction(async (txn) => {
      if (!exactTurnIdentityMatches(await txn.get<TurnRequest>("turn"), turn)) {
        return false;
      }
      attempts = ((await txn.get<number>("alarmAttempts")) ?? 0) + 1;
      await txn.put("alarmAttempts", attempts);
      await txn.setAlarm(
        Date.now() +
          (turn.agentRole === "orchestrator" && attempts <= 5 ? 2_000 : 30_000),
      );
      return true;
    });
    if (!retained) return false;
    if (attempts === 6 || attempts % 20 === 0) {
      log("error", "terminal_delivery_still_retrying", {
        turnId: turn.turnId,
        attempts,
        message: errorMessage(error),
      });
    }
    return false;
  }
};

const usageCount = (value: unknown): number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : 0;

export const orchestratorCliTerminal = (
  turn: TurnRequest,
  pending: PendingTerminal,
): CloudCliTurnTerminal => {
  const usage =
    pending.payload.usage && typeof pending.payload.usage === "object"
      ? (pending.payload.usage as Record<string, unknown>)
      : {};
  const message =
    typeof pending.payload.message === "string" && pending.payload.message
      ? pending.payload.message
      : (pending.threadError ?? "Stella hit a problem and stopped. Try again.");
  return {
    conversationId: turn.conversationId ?? "",
    threadId: turn.threadId ?? "",
    turnId: turn.turnId,
    attemptGeneration: turn.attemptGeneration ?? 1,
    outcome: pending.kind,
    finalText:
      pending.kind === "completed" &&
      typeof pending.payload.finalText === "string"
        ? pending.payload.finalText
        : "",
    ...(pending.kind === "failed" ? { error: message } : {}),
    usage: {
      inputTokens: usageCount(usage.inputTokens),
      outputTokens: usageCount(usage.outputTokens),
      llmCalls: usageCount(usage.llmCalls),
    },
  };
};

export const deliverOrchestratorCliTerminal = async (
  host: TerminalDeliveryHost,
  turn: TurnRequest,
  pending: PendingTerminal,
): Promise<void> => {
  const terminal = orchestratorCliTerminal(turn, pending);
  recordOrchestratorCliTerminal(
    host.ctx.storage.sql,
    terminal,
    pending.completedAt ?? Date.now(),
  );
  const response = await callOrchestratorCliTurnRoute(
    host.env,
    turn,
    CLOUD_CLI_TURN_DO_PATHS.terminal,
    terminal,
  );
  if (response.ok) return;
  const transient =
    response.status >= 500 ||
    response.status === 408 ||
    response.status === 429;
  if (transient) {
    throw new Error(
      `Orchestrator CLI terminal was not taken (${response.status}).`,
    );
  }
  log("error", "orchestrator_cli_terminal_refused", {
    turnId: turn.turnId,
    threadId: turn.threadId,
    attemptGeneration: turn.attemptGeneration,
    status: response.status,
  });
};

export const handleOrchestratorTurnStatus = async (
  host: TerminalDeliveryHost,
  request: Request,
): Promise<Response> => {
  const raw = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  const threadId = typeof raw?.threadId === "string" ? raw.threadId : "";
  const turnId = typeof raw?.turnId === "string" ? raw.turnId : "";
  const attemptGeneration = raw?.attemptGeneration;
  if (
    !threadId ||
    !turnId ||
    typeof attemptGeneration !== "number" ||
    !Number.isSafeInteger(attemptGeneration) ||
    attemptGeneration < 1
  ) {
    return json({ error: "threadId, turnId and attemptGeneration are required." }, 400);
  }
  const [stored, terminal, pending] = await Promise.all([
    host.ctx.storage.get<TurnRequest>("turn"),
    host.ctx.storage.get<boolean>("terminal"),
    host.ctx.storage.get<PendingTerminal>("pendingTerminal"),
  ]);
  if (
    stored?.agentRole === "orchestrator" &&
    stored.threadId === threadId &&
    stored.turnId === turnId &&
    stored.attemptGeneration === attemptGeneration
  ) {
    if (terminal !== true) return json({ state: "running" });
    if (
      pending &&
      pending.turnId === turnId &&
      pending.attemptGeneration === attemptGeneration
    ) {
      await host.setExactTurnAlarm(stored, Date.now());
      return json({
        state: "terminal",
        terminal: orchestratorCliTerminal(stored, pending),
      });
    }
  }
  const recorded = readOrchestratorCliTerminal(host.ctx.storage.sql, {
    turnId,
    attemptGeneration,
  });
  if (recorded && recorded.threadId === threadId) {
    return json({ state: "terminal", terminal: recorded });
  }
  return json({ state: "unknown" });
};

export const deliverExecutorLossTerminal = async (
  host: TerminalDeliveryHost,
  turn: TurnRequest,
  text: { message: string; threadError: string },
): Promise<void> => {
  const recoveredPending: PendingTerminal = {
    turnId: turn.turnId,
    attemptGeneration: turn.attemptGeneration!,
    kind: "failed",
    payload: { message: text.message, reason: "executor_recovered" },
    threadError: text.threadError,
    terminateSandbox: true,
  };
  if (
    !(await host.claimTerminalDecision(
      turn,
      recoveredPending,
      Date.now() + 30_000,
    ))
  ) {
    await host.setExactTurnAlarm(turn, Date.now() + 1_000);
    return;
  }
  try {
    await host.terminateCurrentAgentSession(turn);
  } catch (error) {
    if (!(error instanceof SandboxLifecycleDeferredError)) {
      log("error", "recovered_agent_sandbox_termination_deferred", {
        turnId: turn.turnId,
        threadId: turn.threadId,
        message: errorMessage(error),
      });
      return;
    }
    log("error", "recovered_agent_sandbox_termination_deferred", {
      turnId: turn.turnId,
      threadId: turn.threadId,
      ...sandboxLifecycleFailureFields(error),
    });
  }
  const delivered = await host.deliverTerminal(turn, {
    ...recoveredPending,
    terminateSandbox: false,
  });
  if (delivered && (await host.ownsExactTurn(turn))) {
    if (await host.settleAgentTransientBackup(turn)) {
      await host.deleteTurnStoragePreservingExactCancellations(turn, true);
    } else {
      await host.setExactTurnAlarm(turn, Date.now() + 30_000);
    }
  }
};

export const expireCurrentAgentTurn = async (
  host: TerminalDeliveryHost,
  request: Request,
): Promise<Response> => {
  const raw = (await request.json().catch(() => null)) as unknown;
  const body =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const turn = await host.ctx.storage.get<TurnRequest>("turn");
  if (
    !turn ||
    turn.kind !== "agent" ||
    !Number.isSafeInteger(turn.attemptGeneration) ||
    turn.attemptGeneration! < 1
  ) {
    return json({ expired: false, reason: "no_agent_turn" }, 404);
  }
  if (
    (body.turnId !== undefined && body.turnId !== turn.turnId) ||
    (body.attemptGeneration !== undefined &&
      body.attemptGeneration !== turn.attemptGeneration)
  ) {
    return json(
      {
        expired: false,
        reason: "stale_turn",
        turnId: turn.turnId,
        attemptGeneration: turn.attemptGeneration,
      },
      409,
    );
  }
  if (await host.ctx.storage.get<boolean>("terminalDelivered")) {
    return json(
      {
        expired: false,
        reason: "already_terminal",
        turnId: turn.turnId,
        attemptGeneration: turn.attemptGeneration,
      },
      409,
    );
  }
  const now = Date.now();
  await host.ctx.storage.put(AGENT_WATCHDOG_DEADLINE_KEY, now);
  const running = host.agentTurnExecutions.get(turn.turnId);
  if (running) {
    await running
      .interrupt(new Error("The agent turn was expired by an operator."))
      .catch((error) => {
        log("error", "agent_turn_expire_interrupt_failed", {
          turnId: turn.turnId,
          message: errorMessage(error),
        });
      });
    if (host.agentTurnExecutions.get(turn.turnId) === running) {
      host.agentTurnExecutions.delete(turn.turnId);
    }
  }
  await host.setExactTurnAlarm(turn, now);
  log("info", "agent_turn_expired_by_operator", {
    turnId: turn.turnId,
    threadId: turn.threadId,
    attemptGeneration: turn.attemptGeneration,
    interruptedLocalExecution: Boolean(running),
  });
  return json({
    expired: true,
    turnId: turn.turnId,
    attemptGeneration: turn.attemptGeneration,
    interruptedLocalExecution: Boolean(running),
  });
};

export const cancelExactAgentTurn = async (
  host: TerminalDeliveryHost,
  request: ExactTurnCancellationRequest,
  reason: string,
): Promise<Response> => {
  type Admission =
    | { response: Response }
    | {
        cancellation: ExactTurnCancellation;
        turn: TurnRequest;
        pending?: PendingTerminal;
      };
  const admission = await host.ctx.blockConcurrencyWhile(
    async (): Promise<Admission> => {
      const stored = await host.ctx.storage.get<TurnRequest>("turn");
      const exact = stored?.turnId === request.turnId ? stored : undefined;
      if (
        exact &&
        (exact.ownerId !== request.ownerId ||
          exact.ownerGeneration !== request.ownerGeneration ||
          exact.attemptGeneration !== request.attemptGeneration)
      ) {
        return {
          response: json(
            {
              canceled: false,
              reason: "stale_owner_generation",
              turnId: request.turnId,
            },
            409,
          ),
        };
      }
      const existing = await host.exactTurnCancellations.matching({
        turnId: request.turnId,
        ownerId: request.ownerId,
        ownerGeneration: request.ownerGeneration,
        attemptGeneration: request.attemptGeneration,
      });
      if (existing && existing.cancelRequestId !== request.cancelRequestId) {
        return {
          response: json(
            {
              canceled: false,
              reason: "cancellation_identity_conflict",
              turnId: request.turnId,
            },
            409,
          ),
        };
      }
      if (existing?.state === "acknowledged") {
        return {
          response: json({
            canceled: true,
            turnId: request.turnId,
            replayed: true,
          }),
        };
      }
      let pending: PendingTerminal | undefined;
      if (exact && (await host.ctx.storage.get<boolean>("terminal"))) {
        pending =
          await host.ctx.storage.get<PendingTerminal>("pendingTerminal");
        if (
          !pending ||
          pending.turnId !== request.turnId ||
          pending.kind !== "canceled"
        ) {
          await host.ctx.storage.setAlarm(Date.now());
          return {
            response: json(
              {
                canceled: false,
                reason: "terminal_already_decided",
                turnId: request.turnId,
              },
              409,
            ),
          };
        }
      }
      const staged = await host.exactTurnCancellations.stage(request);
      if (staged.status === "conflict") {
        return {
          response: json(
            {
              canceled: false,
              reason: "cancellation_identity_conflict",
              turnId: request.turnId,
            },
            409,
          ),
        };
      }
      if (staged.status === "saturated") {
        return {
          response: json(
            {
              canceled: false,
              reason: "cancellation_ledger_saturated",
              turnId: request.turnId,
            },
            503,
          ),
        };
      }
      if (!("cancellation" in staged)) {
        return {
          response: json(
            { canceled: false, reason: "cancellation_not_staged" },
            503,
          ),
        };
      }
      if (staged.cancellation.state === "acknowledged") {
        return {
          response: json({
            canceled: true,
            turnId: request.turnId,
            replayed: true,
          }),
        };
      }
      if (!exact) {
        return {
          response: json(
            {
              canceled: true,
              turnId: request.turnId,
              pending: true,
              durable: true,
            },
            202,
          ),
        };
      }
      return { cancellation: staged.cancellation, turn: exact, pending };
    },
  );
  if ("response" in admission) return admission.response;

  const turn = { ...admission.turn };
  let pending = admission.pending ?? {
    turnId: turn.turnId,
    attemptGeneration: turn.attemptGeneration!,
    kind: "canceled" as const,
    payload: { message: "Stopped. Nothing was changed." },
    threadError: isAgentStopReason(reason) ? reason : "The agent was stopped.",
    terminateSandbox: true,
  };
  if (!admission.pending) {
    if (!(await host.claimTerminalDecision(turn, pending))) {
      const decided =
        await host.ctx.storage.get<PendingTerminal>("pendingTerminal");
      if (
        !decided ||
        decided.turnId !== turn.turnId ||
        decided.kind !== "canceled"
      ) {
        return json(
          {
            canceled: false,
            reason: "stale_turn",
            turnId: request.turnId,
          },
          409,
        );
      }
      pending = decided;
    }
  }

  const agentExecution = host.agentTurnExecutions.get(turn.turnId);
  try {
    // Interrupt first: this closes the exact turn's local admission latch
    // before sandbox teardown starts, so setup cannot recreate a session
    // after Stop destroyed the pre-existing/current container.
    if (agentExecution) {
      await agentExecution.interrupt(
        new Error(
          isAgentStopReason(reason)
            ? reason
            : "The agent turn was stopped.",
        ),
      );
    }
    if (pending.terminateSandbox) {
      if (!agentExecution) {
        await host.terminateCurrentAgentSession(turn);
      }
      pending = { ...pending, terminateSandbox: false };
      if (
        !(await host.mutateExactTurn(turn, async (txn) => {
          await txn.put("pendingTerminal", pending);
        }))
      ) {
        return json(
          { canceled: false, reason: "stale_turn", turnId: turn.turnId },
          409,
        );
      }
    }
  } catch (error) {
    log("error", "cancel_sandbox_termination_failed", {
      turnId: turn.turnId,
      ...sandboxLifecycleFailureFields(error),
    });
    await host.setExactTurnAlarm(turn, Date.now() + 30_000);
    return json(
      {
        canceled: false,
        reason: "sandbox_termination_failed",
        turnId: turn.turnId,
      },
      502,
    );
  }

  let auxiliaryLeaseId: string | undefined;
  let auxiliaryGeneration: string | undefined;
  let terminalDelivered = false;
  try {
    turn.ownerPurgeGeneration = await host.registerTurn(turn, true);
    auxiliaryLeaseId = turn.ownerPurgeLeaseId;
    auxiliaryGeneration = turn.ownerPurgeGeneration;
    await host.assertTurnWritable(turn);
    log("info", "turn_canceled", {
      turnId: turn.turnId,
      appId: turn.appId,
    });
    terminalDelivered = await host.deliverTerminal(turn, pending, {
      preservePendingTerminal: true,
    });
  } catch (error) {
    if (!(error instanceof OwnerPurgeFenceError)) throw error;
  } finally {
    if (auxiliaryLeaseId && auxiliaryGeneration) {
      await host.unregisterTurnLease(
        turn,
        auxiliaryLeaseId,
        auxiliaryGeneration,
      );
    }
  }

  if (agentExecution) await agentExecution.join();
  if (!(await host.acknowledgeExactAgentTurnCancellation(request))) {
    return json(
      {
        canceled: false,
        reason: "cancellation_acknowledgement_lost",
        turnId: turn.turnId,
      },
      503,
    );
  }
  if (terminalDelivered) {
    const cleanupTurn = await host.ctx.storage.get<TurnRequest>("turn");
    if (cleanupTurn && exactTurnIdentityMatches(cleanupTurn, turn)) {
      try {
        await host.runAlarmWithLease({ ...cleanupTurn });
      } catch (error) {
        log("error", "cancel_terminal_cleanup_deferred", {
          turnId: turn.turnId,
          message: errorMessage(error),
        });
        await host.setExactTurnAlarm(cleanupTurn, Date.now() + 30_000);
      }
    }
  }
  return json({
    canceled: true,
    turnId: turn.turnId,
    joined: true,
  });
};

export const cancelForOwnerPurge = async (
  host: TerminalDeliveryHost,
  request: Request,
): Promise<Response> => {
  const body = (await request.json().catch(() => ({}))) as {
    ownerId?: string;
    turnId?: string;
    generation?: string;
    leaseId?: string;
    ownerGeneration?: string;
  };
  const stored = await host.ctx.storage.get<TurnRequest>("turn");
  const turnId = body.turnId;
  const ownerId = body.ownerId;
  const generation = body.generation;
  const leaseId = body.leaseId;
  const ownerGeneration = body.ownerGeneration;
  if (!turnId || !ownerId || !generation || !leaseId || !ownerGeneration) {
    return json({ error: "Owner purge lease identity required." }, 400);
  }
  const leaseTurn: TurnRequest = {
    kind: "agent",
    ownerId,
    ownerGeneration,
    ownerPurgeGeneration: generation,
    ownerPurgeLeaseId: leaseId,
    appId: "agent",
    turnId,
    agentDepth: 1,
    prompt: "",
    audience: "free",
    budgetMicroCents: 0,
  };
  if (
    stored &&
    (stored.turnId !== turnId ||
      stored.ownerId !== ownerId ||
      stored.ownerGeneration !== ownerGeneration ||
      stored.ownerPurgeGeneration !== generation ||
      stored.ownerPurgeLeaseId !== leaseId)
  ) {
    if (!(await host.unregisterTurnLease(leaseTurn, leaseId, generation))) {
      return json(
        { canceled: false, reason: "stale_owner_purge_identity", turnId },
        409,
      );
    }
    return json({
      canceled: false,
      reason: "stale_owner_purge_identity",
      turnId,
      unregistered: true,
    });
  }
  if (!stored) {
    const retired = await host.unregisterTurnLease(
      leaseTurn,
      leaseId,
      generation,
    );
    return retired
      ? json({ canceled: true, turnId, unregistered: true, orphan: true })
      : json({ error: "Owner lease retirement is pending." }, 409);
  }
  const turn = stored;

  await host.ctx.storage.put("terminal", true);
  await host.ctx.storage.deleteAlarm().catch(() => undefined);
  const turnExecution =
    host.agentTurnExecutions.get(turnId) ?? host.appTurnExecutions.get(turnId);
  if (turnExecution) {
    try {
      // Close the local admission latch before teardown. Destroying only the
      // currently visible container is insufficient when createSession() is
      // still pending: that promise could resolve after destroy and recreate
      // executable work. interrupt() also boundedly joins that underlying
      // promise-native setup before purge can acknowledge the lease.
      await turnExecution.interrupt(
        new Error("Owner cloud activity is being purged."),
      );
    } catch {
      return json({ error: "Owner turn is still unwinding." }, 409);
    }
  } else {
    const target = await host.currentSandboxTarget();
    if (target) {
      try {
        if (turn.kind === "agent") {
          await host.terminateCurrentAgentSession(turn);
        } else {
          await host.destroySandboxDurably(target, "owner_purge");
        }
      } catch {
        return json({ error: "Owner turn is still unwinding." }, 409);
      }
    }
  }

  const running = [...(host.runningTurns.get(turnId) ?? [])];
  if (running.length > 0) {
    const settled = await Promise.race([
      Promise.allSettled(running).then(() => true),
      runToolEffect(
        Effect.sleep(OWNER_PURGE_STALE_LEASE_GRACE_MS).pipe(Effect.as(false)),
      ),
    ]);
    if (!settled) {
      return json({ error: "Owner turn is still unwinding." }, 409);
    }
  } else if (!turnExecution) {
    const key = `ownerPurgeCancelAt:${leaseId}`;
    const startedAt = (await host.ctx.storage.get<number>(key)) ?? Date.now();
    await host.ctx.storage.put(key, startedAt);
    if (Date.now() - startedAt < OWNER_PURGE_STALE_LEASE_GRACE_MS) {
      return json({ error: "Reconciling stale owner turn lease." }, 409);
    }
    await host.ctx.storage.delete(key);
  }

  await host.cleanupTransientWrites(turn);
  await host.deleteTurnStoragePreservingExactCancellations(turn, true);
  purgeThreadTranscript(host.ctx.storage.sql);
  purgeOrchestratorCliTurnStore(host.ctx.storage.sql);
  await host.releaseOwnerGate(turn);
  return (await host.unregisterTurnLease(turn, leaseId, generation))
    ? json({ canceled: true, turnId, unregistered: true })
    : json({ error: "Owner lease retirement is pending." }, 409);
};

export const acknowledgeExactAgentTurnCancellation = async (
  host: TerminalDeliveryHost,
  request: ExactTurnCancellationRequest,
): Promise<boolean> => {
  return await host.ctx.blockConcurrencyWhile(
    async () => await host.exactTurnCancellations.acknowledge(request),
  );
};

export const acknowledgeExactCancellationFromAlarm = async (
  host: TerminalDeliveryHost,
  turn: TurnRequest,
  cancellation: ExactTurnCancellation,
): Promise<boolean> => {
  if (cancellation.state === "acknowledged") return true;
  const active = host.runningTurns.get(cancellation.turnId)?.size ?? 0;
  if (active > 1) {
    await host.setExactTurnAlarm(turn, Date.now() + 30_000);
    return false;
  }
  if (await host.acknowledgeExactAgentTurnCancellation(cancellation)) {
    return true;
  }
  await host.setExactTurnAlarm(turn, Date.now() + 30_000);
  return false;
};
