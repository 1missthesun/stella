import {
  BILLING_UNAVAILABLE_CODE,
  BILLING_UNAVAILABLE_MESSAGE,
  STELLA_USAGE_LIMIT_CODE,
  STELLA_USAGE_LIMIT_MESSAGES,
  type StellaUsageLimitReason,
} from "@stella/contracts/stella-usage-limit";
import type { DevicesResponse } from "@stella/contracts/turn-plane/placement";
import { claudeUsageLimitOf } from "@stella/contracts/claude-usage-limit";
import { formatTurnClock } from "@stella/contracts/schedule-zone";
import { attachedFilesText } from "../prompt-context.js";
import { formatMessageRefTag } from "@stella/contracts/reply-refs";
import { buildCloudSkillsBlock } from "../cloud-skills.js";
import { unwrapRpc } from "../owner-store/errors.js";
import {
  isSlackConversationId,
  renderSlackSystemPrompt,
  slackSkillCatalog,
} from "../slack/workspace.js";
import { crewScopeForConversation, ownerCallFor } from "../slack/scope.js";
import type { AgentMessage } from "@stella/runtime/kernel/agent-core/types.js";
import {
  assertTurnExecutionActive,
  type TurnRetryCancellation,
} from "../turn-cancellation.js";
import { guardedModelFetch } from "../guarded-model-fetch.js";
import {
  fetchWithManagedCancellation,
  type ModelGatewayControl,
} from "../managed-request-cancellation.js";
import {
  type LocalOwnerModelGrantExpectation,
  releaseOwnerModelGrantAfterBody,
} from "../local-owner-model-grants.js";
import {
  GATEWAY_PREPARE_PATH,
  GATEWAY_RESOLVE_PATH,
  GATEWAY_SUBSCRIPTION_LIMIT_HEADER,
  nativeSubscriptionLimitNotice,
  byokRejectionNotice,
  GATEWAY_BYOK_REJECTION_HEADER,
} from "@stella/contracts/gateway/api";
import type { CloudExecutionSelection } from "@stella/contracts/agent-engine";
import { getProviderDisplayName } from "@stella/contracts/provider-display";
import type { CanonicalPrompts } from "../cloud-prompt.js";
import type { ExactTurnCancellation } from "../execution-placement-turn-cancellation.js";
import type {
  ChatTurnRequest,
  LocalTurnLease,
  PersistedChatTurnModelCapability,
  OwedTerminal,
} from "./types.js";
import {
  CHAT_WATCHDOG_MS,
  PI_JOURNAL_IMPORT_BATCH,
  PI_MIRRORED_KEY,
  CHECKPOINT_TURN_SCAN,
  CHAT_TURN_HEARTBEAT_MS,
  CHAT_TURN_RESUME_KEY,
  CHAT_TURN_STARTED_AT_KEY,
  CHAT_TURN_MODEL_CAPABILITY_KEY,
  LOCAL_TURN_LEASE_KEY,
  TERMINAL_NOTICE,
  CLOUD_CONTEXT_NOTICE,
} from "./constants.js";
import {
  OwnerPurgeFenceError,
  mintOrchestratorTurnCapability,
  CliTurnFailedError,
  cloudExecutionContext,
  piModelSpec,
  ChatTurnNotResumableError,
  measureInto,
  localTurnRetirementDeadline,
  json,
  errorMessage,
  log,
  requireCloudContext,
  cloudContextFailure,
} from "./support.js";
import { OrchestratorCliTurn } from "./cli-turn.js";
import type { OrchestratorOwner } from "./owner.js";

const isUsageLimitReply = (message: unknown): boolean => {
  const reply = message as { role?: unknown; stopReason?: unknown; errorMessage?: unknown };
  return (
    reply.role === "assistant" &&
    reply.stopReason === "error" &&
    typeof reply.errorMessage === "string" &&
    claudeUsageLimitOf(reply.errorMessage) !== null
  );
};

type GatewayPlanRefusal = "budget_exhausted" | "usage_limit" | "tier_paused";

const gatewayPlanRefusalOf = async (
  response: Response,
): Promise<GatewayPlanRefusal | undefined> => {
  if (response.status !== 402 && response.status !== 429) return undefined;
  try {
    const body = (await response.clone().json()) as {
      error?: { code?: unknown };
    } | null;
    const code = body?.error?.code;
    return code === "budget_exhausted" ||
      code === "usage_limit" ||
      code === "tier_paused"
      ? code
      : undefined;
  } catch {
    return undefined;
  }
};

type PlanRefusalNotice = {
  message: string;
  code?: typeof STELLA_USAGE_LIMIT_CODE | typeof BILLING_UNAVAILABLE_CODE;
  reason?: StellaUsageLimitReason;
};

const TIER_PAUSED_NOTICE =
  "Stella's models are paused for your plan right now. Upgrade to keep going, or try again later.";
const TURN_BUDGET_SPENT_NOTICE =
  "This reply reached its spending limit before it finished. Send a message to continue.";

export abstract class OrchestratorRunTurn extends OrchestratorCliTurn {
  protected async planRefusalNotice(
    turn: ChatTurnRequest,
    refusal: GatewayPlanRefusal,
  ): Promise<PlanRefusalNotice> {
    const snapshot = await this.ownerGateSnapshot(turn.ownerId).catch(
      (error: unknown) => {
        log("error", "plan_refusal_snapshot_failed", {
          turnId: turn.turnId,
          message: errorMessage(error),
        });
        return undefined;
      },
    );
    log("info", "chat_turn_plan_refused", {
      turnId: turn.turnId,
      conversationId: turn.conversationId,
      refusal,
      usageLimit: snapshot?.usageLimit?.reason ?? null,
      billingUnavailable: snapshot?.billingUnavailable === true,
    });
    if (snapshot?.billingUnavailable) {
      return { message: BILLING_UNAVAILABLE_MESSAGE, code: BILLING_UNAVAILABLE_CODE };
    }
    if (snapshot?.usageLimit) {
      return {
        message: snapshot.usageLimit.message,
        code: STELLA_USAGE_LIMIT_CODE,
        reason: snapshot.usageLimit.reason,
      };
    }
    if (refusal === "tier_paused") {
      return {
        message: TIER_PAUSED_NOTICE,
        code: STELLA_USAGE_LIMIT_CODE,
        reason: "plan_limit",
      };
    }
    if (refusal === "usage_limit") {
      return {
        message: STELLA_USAGE_LIMIT_MESSAGES.plan_limit,
        code: STELLA_USAGE_LIMIT_CODE,
        reason: "plan_limit",
      };
    }
    return { message: TURN_BUDGET_SPENT_NOTICE };
  }

  protected async journalStoppedPrompt(turn: ChatTurnRequest): Promise<void> {
    if (this.journal.hasRow(`turn:${turn.turnId}:prompt`)) return;
    const now = Date.now();
    const report = await this.wakeReport(turn);
    const promptMessage = {
      role: "user",
      content: [{ type: "text", text: report.prompt }],
      timestamp: now,
      ...(turn.originUserMessageId
        ? { originUserMessageId: turn.originUserMessageId }
        : {}),
      ...(turn.source ? { source: turn.source } : {}),
      ...(turn.context?.display
        ? { metadata: { context: turn.context.display } }
        : {}),
    } as AgentMessage;
    const promptPayload = await this.spillOversizePrompt(
      turn.turnId,
      promptMessage,
    );
    this.bindConversation(turn);
    const prompt = this.journal.appendMessage({
      turnId: turn.turnId,
      writer: "orchestrator",
      writerKey: `turn:${turn.turnId}:prompt`,
      role: "user",
      hidden: turn.hiddenMessage === true,
      clientMsgId: turn.clientMsgId,
      createdAt: now,
      message: promptMessage,
      ...promptPayload,
    });
    this.journal.setTurnSpan(turn.turnId, prompt.seq);
    this.publish(prompt.record);
    this.publishAgentTerminal(turn, report);
    await this.publishStagedWakeCards(turn.turnId);
  }

  protected async finishPreCanceledTurn(
    turn: ChatTurnRequest,
    cancellation: ExactTurnCancellation,
  ): Promise<Response> {
    try {
      const now = Date.now();
      const owed: OwedTerminal = {
        kind: "canceled",
        message: TERMINAL_NOTICE.canceled,
        eventSeq: await this.nextTurnEventSeq(turn.turnId),
      };
      await this.ctx.storage.put({
        turn,
        terminal: true,
        terminalDelivered: false,
        terminalOwed: owed,
        alarmAttempts: 0,
      });
      await this.ctx.storage.delete(`queued:${turn.turnId}`);
      this.ownerGeneration = turn.ownerGeneration;
      this.journal.upsertTurn({
        turnId: turn.turnId,
        sessionId: turn.sessionId,
        ownerId: turn.ownerId,
        lane: turn.lane,
        source: turn.source,
        clientMsgId: turn.clientMsgId,
        state: "running",
        now,
      });
      await this.journalStoppedPrompt(turn);
      this.recordTerminal(turn, "canceled", TERMINAL_NOTICE.canceled);
      try {
        await this.emitTurnEvent(
          turn,
          "canceled",
          { message: TERMINAL_NOTICE.canceled },
          {
            terminal: true,
            eventSeq: owed.eventSeq,
            errorMessage: TERMINAL_NOTICE.canceled,
          },
        );
        await this.ctx.storage.put("terminalDelivered", true);
      } catch {
        await this.ctx.storage.setAlarm(Date.now() + 30_000);
      }
      await this.afterTerminal(turn);
      if (!(await this.acknowledgeExactTurnCancellation(cancellation))) {
        throw new Error("Pre-admission cancellation acknowledgement was lost.");
      }
      log("info", "chat_turn_pre_admission_canceled", {
        turnId: turn.turnId,
        conversationId: turn.conversationId,
      });
      return json({ ok: false, canceled: true, preAdmission: true });
    } finally {
      await this.unregisterOwnerTurn(turn);
      await this.releaseOwnerGate(turn);
    }
  }

  protected async runTurn(
    turn: ChatTurnRequest,
    turnCancellation: TurnRetryCancellation,
    executionSignal: AbortSignal,
    enqueuedAt = performance.now(),
    admission?: {
      leaseId: string | undefined;
      generation: string | undefined;
      at: number;
    },
    resumeTurn = false,
  ): Promise<Response> {
    const enteredAt = performance.now();
    const startupTimings: Record<string, number> = {
      queueWaitMs: Math.round(enteredAt - enqueuedAt),
    };
    if (this.journal.turnState(turn.turnId)?.state === "terminal") {
      log("info", "chat_turn_duplicate_ignored", { turnId: turn.turnId });
      await this.ctx.storage.delete(`queued:${turn.turnId}`);
      return json({ ok: false, duplicate: true });
    }
    const localLease =
      await this.getTurnState<LocalTurnLease>(LOCAL_TURN_LEASE_KEY);
    if (localLease) {
      const retirementAt = localTurnRetirementDeadline(localLease);
      if (retirementAt <= Date.now()) {
        if (localLease.cancelRequested) {
          await this.cancelLocalTurn(localLease, true);
        } else {
          await this.expireLocalLease(localLease, false);
        }
      } else {
        await this.armLocalLeaseAlarm(retirementAt);
        log("info", "chat_turn_waiting_for_local_turn", {
          turnId: turn.turnId,
          localTurnId: localLease.turnId,
          conversationId: turn.conversationId,
        });
        return json({ ok: false, queued: true }, 202);
      }
    }
    // Queued turns survive DO eviction and may predate the worker generation
    // that introduced owner leases. Acquire (or re-acquire) before touching
    // the journal; a blocked owner drops the queued turn without callbacks,
    // because the reset/account purge is about to delete its owner row too.
    try {
      const registrationAt = performance.now();
      turn.ownerPurgeGeneration = await this.registerOwnerTurn(turn);
      startupTimings.registrationMs = Math.round(
        performance.now() - registrationAt,
      );
      const assertionAt = performance.now();
      if (
        admission?.leaseId &&
        admission.generation &&
        admission.leaseId === turn.ownerPurgeLeaseId &&
        admission.generation === turn.ownerPurgeGeneration &&
        performance.now() - admission.at < 1_000
      ) {
        assertTurnExecutionActive(turnCancellation, executionSignal);
        await this.assertOwnerFenceLeaseReceiptActive(turn);
        startupTimings.admissionReused = 1;
      } else {
        await this.assertOwnerTurn(turn);
      }
      startupTimings.ownerAssertionMs = Math.round(
        performance.now() - assertionAt,
      );
      if (turn.agentThreadControl) {
        await this.rememberCloudAgentControlReceipt(turn.agentThreadControl);
      }
    } catch (error) {
      await this.ctx.storage.delete(`queued:${turn.turnId}`);
      await this.unregisterOwnerTurn(turn);
      await this.releaseOwnerGate(turn);
      if (error instanceof OwnerPurgeFenceError) {
        log("info", "chat_turn_dropped_owner_purge", {
          turnId: turn.turnId,
          ownerId: turn.ownerId,
        });
        return json({ ok: false, purging: true });
      }
      throw error;
    }
    if (this.purged()) {
      await this.ctx.storage.delete(`queued:${turn.turnId}`);
      await this.unregisterOwnerTurn(turn);
      await this.releaseOwnerGate(turn);
      log("info", "chat_turn_dropped_deleted", { turnId: turn.turnId });
      return json({ ok: false, deleted: true });
    }
    if (this.journal.turnState(turn.turnId)?.state === "terminal") {
      log("info", "chat_turn_duplicate_ignored", { turnId: turn.turnId });
      await this.ctx.storage.delete(`queued:${turn.turnId}`);
      await this.unregisterOwnerTurn(turn);
      await this.releaseOwnerGate(turn);
      return json({ ok: false, duplicate: true });
    }
    const stale = await this.getTurnState<ChatTurnRequest>("turn");
    if (
      stale &&
      stale.turnId !== turn.turnId &&
      !(await this.getTurnState<boolean>("terminalDelivered"))
    ) {
      const interrupted = "Stella was interrupted answering this. Try again.";
      await this.emitTurnEvent(
        stale,
        "failed",
        { message: interrupted },
        { terminal: true, errorMessage: interrupted },
      ).catch(() => undefined);
      await this.releaseOwnerGate(stale);
      this.recordTerminal(stale, "failed", interrupted);
    }
    const reclaimed = stale?.turnId === turn.turnId;
    const [storedWatchdogAt, storedStartedAt] = reclaimed
      ? await Promise.all([
          this.getTurnState<number>("turnWatchdogAt"),
          this.getTurnState<number>(CHAT_TURN_STARTED_AT_KEY),
        ])
      : [undefined, undefined];
    const watchdogAt =
      reclaimed && typeof storedWatchdogAt === "number"
        ? storedWatchdogAt
        : Date.now() + Math.max(1_000, turn.watchdogMs ?? CHAT_WATCHDOG_MS);
    let preCanceled: ExactTurnCancellation | null = null;
    const claimAt = performance.now();
    await this.ctx.blockConcurrencyWhile(async () => {
      preCanceled = await this.exactTurnCancellations.matching({
        turnId: turn.turnId,
        ownerId: turn.ownerId,
        ownerGeneration: turn.ownerGeneration,
      });
      if (preCanceled) return;
      await this.armAlarmNoLaterThan(
        Math.min(watchdogAt, Date.now() + CHAT_TURN_HEARTBEAT_MS),
      );
      await this.putTurnState({
        turn,
        turnWatchdogAt: watchdogAt,
        [CHAT_TURN_STARTED_AT_KEY]:
          reclaimed && typeof storedStartedAt === "number"
            ? storedStartedAt
            : Date.now(),
        ...(reclaimed
          ? {}
          : {
              [CHAT_TURN_RESUME_KEY]: null,
              [CHAT_TURN_MODEL_CAPABILITY_KEY]: null,
            }),
        terminal: false,
        terminalDelivered: false,
        terminalOwed: null,
        alarmAttempts: 0,
      }, [`queued:${turn.turnId}`]);
    });
    if (preCanceled) {
      return await this.finishPreCanceledTurn(turn, preCanceled);
    }
    startupTimings.claimMs = Math.round(performance.now() - claimAt);
    this.ownerGeneration = turn.ownerGeneration;
    this.journal.upsertTurn({
      turnId: turn.turnId,
      sessionId: turn.sessionId,
      ownerId: turn.ownerId,
      lane: turn.lane,
      source: turn.source,
      clientMsgId: turn.clientMsgId,
      state: "running",
      now: Date.now(),
    });
    const started = performance.now();
    const preparationTimings: Record<string, number> = {};
    const measurePreparation = measureInto(preparationTimings);
    log("info", "chat_turn_started", {
      turnId: turn.turnId,
      conversationId: turn.conversationId,
      sessionId: turn.sessionId,
      startupMs: Math.round(performance.now() - enteredAt),
      startupTimings,
      firstChatInIsolate: this.firstChatInIsolate,
      isolateId: this.isolateId,
      ...(this.firstChatInIsolate ? { wakeTiming: this.wakeTiming } : {}),
    });
    this.firstChatInIsolate = false;
    const assertExactTurnActive = async (): Promise<void> => {
      assertTurnExecutionActive(turnCancellation, executionSignal);
      const [stored, terminal] = await Promise.all([
        this.getTurnState<ChatTurnRequest>("turn"),
        this.getTurnState<boolean>("terminal"),
      ]);
      assertTurnExecutionActive(turnCancellation, executionSignal);
      if (
        terminal ||
        stored?.turnId !== turn.turnId ||
        stored.ownerId !== turn.ownerId ||
        stored.ownerGeneration !== turn.ownerGeneration
      ) {
        throw new Error("The chat turn is no longer active.");
      }
    };
    this.currentTurnCancellation = turnCancellation;
    let subscriptionLimitNotice: string | undefined;
    // The owner's provider refused the latest model request itself (its key,
    // its model or the request); the user reads the provider's reason.
    let providerRejection: string | undefined;
    let gatewayRefusal: GatewayPlanRefusal | undefined;
    try {
      await assertExactTurnActive();
      this.activeTurnId = turn.turnId;
      const harnessExecution =
        turn.execution.engine === "anthropic" ? undefined : turn.execution;
      this.bindConversation(turn);
      if (!resumeTurn) {
        await this.emitTurnEvent(turn, "started", {}, { deferred: true });
      }
      await assertExactTurnActive();

      const canonicalPromptsWork = measurePreparation(
        "canonicalPromptsMs",
        () =>
          requireCloudContext(
            "canonical_prompt",
            this.loadCanonicalPromptsForTurn(executionSignal),
          ),
      );
      void canonicalPromptsWork.catch(() => undefined);
      const destinationsWork = measurePreparation(
        "devicesMs",
        () =>
          this.cloudHomePreparations.get(turn.turnId)?.destinations ??
          this.ownerGate(turn.ownerId)
            .devices()
            .catch(() => null),
      );
      if (!harnessExecution) {
        const execution = turn.execution;
        return await this.runPiTurn({
          turn,
          turnCancellation,
          executionSignal,
          resumeTurn,
          started,
          execution,
          capability: "",
          relayFetch: async () => {
            throw new Error("A Claude Code turn sends no model request through the gateway.");
          },
          gatewayOrigin: this.env.MODEL_GATEWAY_URL?.trim() ?? "",
          homeWork: (() => {
            const prefetched = this.cloudHomePreparations.get(turn.turnId)?.home;
            this.cloudHomePreparations.delete(turn.turnId);
            const loadHome = () => this.prepareCloudHomeContext(turn);
            return (prefetched ? prefetched.catch(loadHome) : loadHome()).then(
              (context) => {
                Object.assign(preparationTimings, context.timings);
                return context;
              },
            );
          })(),
          canonicalPromptsWork,
          destinationsWork,
          measurePreparation,
          preparationTimings,
          assertExactTurnActive,
        });
      }
      const minted = await measurePreparation("capabilitiesMs", () =>
        mintOrchestratorTurnCapability(this.env, turn, harnessExecution),
      );
      const persistedModel = resumeTurn
        ? await this.getTurnState<PersistedChatTurnModelCapability>(
            CHAT_TURN_MODEL_CAPABILITY_KEY,
          )
        : undefined;
      const reusedModel =
        persistedModel?.turnId === turn.turnId &&
        persistedModel.capability.expiresAt > watchdogAt + 60_000
          ? persistedModel.capability
          : undefined;
      const turnCapability = reusedModel ?? minted;
      if (!reusedModel) {
        await this.putTurnState({
          [CHAT_TURN_MODEL_CAPABILITY_KEY]: {
            turnId: turn.turnId,
            capability: minted,
          } satisfies PersistedChatTurnModelCapability,
        });
      }
      if (resumeTurn) {
        log("info", "chat_turn_resume_capability", {
          turnId: turn.turnId,
          modelCapabilityReused: Boolean(reusedModel),
        });
      }
      await assertExactTurnActive();

      const executionSelection = harnessExecution;
      const modelGatewayOrigin = this.env.MODEL_GATEWAY_URL?.trim() ?? "";
      const modelGateway = this.env.MODEL_GATEWAY;
      if (!modelGatewayOrigin || !modelGateway) {
        throw new Error("Model gateway is not configured.");
      }

      if (
        executionSelection.engine === "stella" &&
        !this.gatewayPreparedInInstance &&
        !this.admittedOwnerModelGrants.has(turn.turnId)
      ) {
        this.gatewayPreparedInInstance = true;
        const gatewayPreparationStartedAt = performance.now();
        this.ctx.waitUntil(
          modelGateway
            .fetch(
              new Request(new URL(GATEWAY_PREPARE_PATH, modelGatewayOrigin), {
                method: "POST",
                headers: {
                  authorization: `Bearer ${turnCapability.token}`,
                  "content-type": "application/json",
                },
                body: JSON.stringify({
                  model: executionSelection.model,
                  agentType: "orchestrator",
                }),
                signal: AbortSignal.any([
                  executionSignal,
                  AbortSignal.timeout(10_000),
                ]),
              }),
            )
            .then(async (response) => {
              await response.arrayBuffer();
              log("info", "chat_gateway_prepared", {
                turnId: turn.turnId,
                status: response.status,
                totalMs: Math.round(
                  performance.now() - gatewayPreparationStartedAt,
                ),
              });
            })
            .catch((error: unknown) => {
              log("info", "chat_gateway_preparation_failed", {
                turnId: turn.turnId,
                message: errorMessage(error),
              });
            }),
        );
      }
      const prefetchedHome = this.cloudHomePreparations.get(turn.turnId)?.home;
      const loadHome = () => this.prepareCloudHomeContext(turn);
      const homePreparation = prefetchedHome
        ? prefetchedHome.catch(loadHome)
        : loadHome();
      this.cloudHomePreparations.delete(turn.turnId);
      const measuredHomePreparation = homePreparation.then((context) => {
        Object.assign(preparationTimings, context.timings);
        return context;
      });
      void measuredHomePreparation.catch(() => undefined);
      const acquireModelGrant = (expected: LocalOwnerModelGrantExpectation) =>
        this.acquireOwnerModelGrant(expected);
      let modelGrantWork =
        executionSelection.engine === "stella"
          ? measuredHomePreparation.then(async ({ memoryPreference }) => {
              const grantPreparationStartedAt = performance.now();
              if (!turn.ownerPurgeGeneration || !turn.ownerPurgeLeaseId)
                throw new OwnerPurgeFenceError();
              const expected: LocalOwnerModelGrantExpectation = {
                ownerId: turn.ownerId,
                ownerGeneration: turn.ownerGeneration,
                conversationId: turn.conversationId,
                turnId: turn.turnId,
                leaseId: turn.ownerPurgeLeaseId,
                fenceGeneration: turn.ownerPurgeGeneration,
                memoryPolicy: memoryPreference,
              };
              const admitted = this.admittedOwnerModelGrants.get(turn.turnId);
              this.admittedOwnerModelGrants.delete(turn.turnId);
              const local = this.localOwnerModelGrants.valid(
                admitted,
                expected,
              );
              if (local) {
                log("info", "chat_model_grant_prepared", {
                  turnId: turn.turnId,
                  source: "admitted",
                  elapsedMs: Math.round(
                    performance.now() - grantPreparationStartedAt,
                  ),
                });
                return { grant: local, expected };
              }
              const acquired = await acquireModelGrant(expected);
              log("info", "chat_model_grant_prepared", {
                turnId: turn.turnId,
                source: "owner_rpc",
                elapsedMs: Math.round(
                  performance.now() - grantPreparationStartedAt,
                ),
              });
              return acquired;
            })
          : undefined;
      void modelGrantWork?.catch(() => undefined);
      const modelGrantForPhysicalRequest = async () => {
        if (!modelGrantWork) return undefined;
        const current = await modelGrantWork;
        if (
          !this.localOwnerModelGrants.valid(current.grant, current.expected)
        ) {
          throw new OwnerPurgeFenceError();
        }
        if (current.grant.expiresAt - Date.now() > 60_000) return current;
        modelGrantWork = acquireModelGrant(current.expected);
        void modelGrantWork.catch(() => undefined);
        return await modelGrantWork;
      };
      const relayFetch = async (
        input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> => {
        const request = new Request(input, init);
        if (new URL(request.url).pathname === GATEWAY_RESOLVE_PATH) {
          return measurePreparation("modelResolutionTransportMs", () =>
            modelGateway.fetch(request),
          );
        }
        const execute = async (physicalRequest: Request) => {
          const localGrant = await modelGrantForPhysicalRequest();
          const activeGrant = localGrant
            ? this.localOwnerModelGrants.begin(
                localGrant.grant,
                localGrant.expected,
                physicalRequest.signal,
              )
            : undefined;
          const guardedRequest = activeGrant
            ? new Request(physicalRequest, {
                signal: activeGrant.requestSignal,
              })
            : physicalRequest;
          try {
            const relayOwners =
              executionSelection.engine === "stella" &&
              turnCapability.claims.ledgerScope === "owner-relay-v2"
                ? this.env.MODEL_GATEWAY_OWNERS
                : undefined;
            const guard = (requestToGuard: Request) =>
              guardedModelFetch({
                request: requestToGuard,
                fetch: (value) =>
                  relayOwners
                    ? relayOwners
                        .get(relayOwners.idFromName(turnCapability.claims.sub))
                        .fetch(value)
                    : modelGateway.fetch(value),
                mode: activeGrant ? "authorize-before-fetch" : "gate-body",
                authorize: async () => {
                  await assertExactTurnActive();
                  const { memoryPreference } = await measuredHomePreparation;
                  if (!turn.ownerPurgeGeneration || !turn.ownerPurgeLeaseId) {
                    throw new OwnerPurgeFenceError();
                  }
                  assertTurnExecutionActive(turnCancellation, executionSignal);
                  if (activeGrant) activeGrant.assertValid();
                  else {
                    const policyStartedAt = performance.now();
                    await requireCloudContext(
                      "agent_home_memory",
                      this.ownerGate(turn.ownerId).assertMemoryPolicy(
                        memoryPreference,
                        turn.ownerPurgeGeneration,
                        turn.ownerPurgeLeaseId,
                        turn.turnId,
                      ),
                    );
                    log("info", "chat_model_dispatch_prepared", {
                      turnId: turn.turnId,
                      memoryRevalidationMs: Math.round(
                        performance.now() - policyStartedAt,
                      ),
                    });
                  }
                  assertTurnExecutionActive(turnCancellation, executionSignal);
                  activeGrant?.assertValid();
                },
              });
            const response =
              executionSelection.engine === "stella"
                ? await (() => {
                    const control = this.env.MODEL_GATEWAY_CONTROL;
                    if (!control)
                      throw new Error(
                        "Model gateway cancellation is not configured.",
                      );
                    return fetchWithManagedCancellation({
                      request: guardedRequest,
                      capability: turnCapability.token,
                      control: control as ModelGatewayControl & Fetcher,
                      waitUntil: (work) => this.ctx.waitUntil(work),
                      fetch: guard,
                    });
                  })()
                : await guard(guardedRequest);
            providerRejection =
              executionSelection.engine === "provider" && !response.ok
                ? byokRejectionNotice(
                    getProviderDisplayName(executionSelection.provider),
                    response.headers.get(GATEWAY_BYOK_REJECTION_HEADER),
                  )
                : undefined;
            if (!response.ok) {
              subscriptionLimitNotice = nativeSubscriptionLimitNotice(
                response.headers.get(GATEWAY_SUBSCRIPTION_LIMIT_HEADER),
              );
              gatewayRefusal =
                (await gatewayPlanRefusalOf(response)) ?? gatewayRefusal;
            }
            return activeGrant
              ? releaseOwnerModelGrantAfterBody(response, activeGrant.release)
              : response;
          } catch (error) {
            activeGrant?.release();
            throw error;
          }
        };
        return execute(request);
      };
      return await this.runPiTurn({
        turn,
        turnCancellation,
        executionSignal,
        resumeTurn,
        started,
        execution: harnessExecution,
        capability: turnCapability.token,
        relayFetch,
        gatewayOrigin: modelGatewayOrigin,
        homeWork: measuredHomePreparation,
        canonicalPromptsWork,
        destinationsWork,
        measurePreparation,
        preparationTimings,
        assertExactTurnActive,
      });
    } catch (error) {
      const message = errorMessage(error);
      const contextFailure = cloudContextFailure(error);
      const planNotice =
        !contextFailure && gatewayRefusal
          ? await this.planRefusalNotice(turn, gatewayRefusal)
          : undefined;
      const terminalNotice = contextFailure
        ? CLOUD_CONTEXT_NOTICE
        : planNotice
          ? planNotice.message
          : error instanceof CliTurnFailedError && error.userMessage
            ? error.userMessage
            : (subscriptionLimitNotice ??
              providerRejection ??
              TERMINAL_NOTICE.failed);
      const terminalPayload = contextFailure
        ? {
            message: terminalNotice,
            code: contextFailure.code,
            component: contextFailure.component,
          }
        : planNotice
          ? planNotice
          : { message: terminalNotice };
      log("error", "chat_turn_failed", {
        turnId: turn.turnId,
        conversationId: turn.conversationId,
        message,
      });
      if (contextFailure) {
        log("error", "cloud_context_blocked", {
          turnId: turn.turnId,
          conversationId: turn.conversationId,
          code: contextFailure.code,
          component: contextFailure.component,
          ...(contextFailure.repairSeq !== undefined
            ? { corruptSeq: contextFailure.repairSeq }
            : {}),
        });
      }
      if (!(await this.getTurnState<boolean>("terminal"))) {
        const failedOwed: OwedTerminal = {
          kind: "failed",
          message: terminalNotice,
          payload: terminalPayload,
          eventSeq: await this.nextTurnEventSeq(turn.turnId),
        };
        await this.ctx.storage.put({
          terminal: true,
          terminalOwed: failedOwed,
        });
        this.recordTerminal(turn, "failed", terminalNotice);
        try {
          await this.emitTurnEvent(turn, "failed", terminalPayload, {
            terminal: true,
            eventSeq: failedOwed.eventSeq,
            errorMessage: terminalNotice,
          });
          await this.ctx.storage.put("terminalDelivered", true);
        } catch {
          await this.ctx.storage.setAlarm(Date.now() + 30_000);
        }
      }
      await this.afterTerminal(turn);
      return json(
        contextFailure
          ? {
              error: "Cloud chat turn failed.",
              code: contextFailure.code,
              component: contextFailure.component,
            }
          : { error: "Cloud chat turn failed.", detail: message },
        502,
      );
    } finally {
      this.live = null;
      this.hub.endTurn(turn.turnId);
      if (this.activeTurnId === turn.turnId) this.activeTurnId = null;
      if (this.currentTurnCancellation === turnCancellation) {
        this.currentTurnCancellation = undefined;
      }
      const unregisterAt = performance.now();
      await this.unregisterOwnerTurn(turn);
      const releaseAt = performance.now();
      await this.releaseOwnerGate(turn);
      log("info", "chat_turn_released", {
        turnId: turn.turnId,
        unregisterMs: Math.round(releaseAt - unregisterAt),
        releaseGateMs: Math.round(performance.now() - releaseAt),
      });
    }
  }

  protected async runPiTurn(args: {
    turn: ChatTurnRequest;
    turnCancellation: TurnRetryCancellation;
    executionSignal: AbortSignal;
    resumeTurn: boolean;
    started: number;
    execution: import("../pi-runtime.js").PiExecution;
    capability: string;
    relayFetch: typeof fetch;
    gatewayOrigin: string;
    homeWork: ReturnType<OrchestratorOwner["prepareCloudHomeContext"]>;
    canonicalPromptsWork: Promise<CanonicalPrompts>;
    destinationsWork: Promise<DevicesResponse | null>;
    measurePreparation: <T>(name: string, work: () => Promise<T>) => Promise<T>;
    preparationTimings: Record<string, number>;
    assertExactTurnActive: () => Promise<void>;
  }): Promise<Response> {
    const { turn, turnCancellation, executionSignal, assertExactTurnActive } =
      args;
    const [home, canonicalPrompts, destinations, pi] = await Promise.all([
      args.homeWork,
      args.canonicalPromptsWork,
      args.destinationsWork,
      import("../pi-runtime.js"),
    ]);
    await assertExactTurnActive();
    const slack = isSlackConversationId(turn.conversationId);
    const slackPrompt = slack
      ? await renderSlackSystemPrompt(
          await this.slack().workspace(),
          ownerCallFor(
            this.env,
            turn.ownerId,
            turn.ownerGeneration,
            await crewScopeForConversation(this.env, turn.conversationId),
          ),
        )
      : null;
    const skillCatalog = slack
      ? slackSkillCatalog(home.skillCatalog)
      : home.skillCatalog;
    const executionContext = cloudExecutionContext(
      turn,
      slack ? null : destinations,
    );
    const locale = await this.resolveTurnLocale(turn);
    const sources: import("../pi-runtime.js").PiTurnSources =
      slackPrompt !== null
        ? {
            orchestratorPrompt: slackPrompt,
            personality: undefined,
            memory: { enabled: false },
            history: true,
            skillsCatalog: buildCloudSkillsBlock(skillCatalog) || undefined,
            executionContext,
            locale,
          }
        : {
            orchestratorPrompt: canonicalPrompts.orchestratorBody,
            personality:
              home.personalityOverride ?? canonicalPrompts.personalityBody,
            memory: pi.memoryFromDocuments(
              home.memoryPreference.memoryEnabled,
              home.memoryDocuments,
            ),
            skillsCatalog: buildCloudSkillsBlock(skillCatalog) || undefined,
            executionContext,
            locale,
          };
    const modelSpec = (
      agentType: "orchestrator" | "general",
      execution: Extract<CloudExecutionSelection, { engine: "stella" }>,
    ) => piModelSpec(agentType, execution, turn.audience);
    const binding: import("../pi-runtime.js").PiTurnBinding = {
      turnId: turn.turnId,
      capability: args.capability,
      fetch: args.relayFetch,
      authority: {
        ownerId: turn.ownerId,
        ownerGeneration: turn.ownerGeneration,
        conversationId: turn.conversationId,
        audience: turn.audience,
        budgetMicroCents: turn.budgetMicroCents,
        execution: args.execution,
      },
      ...(args.execution.engine === "stella"
        ? {
            stellaModels: {
              model: modelSpec("orchestrator", args.execution),
              agentModel: modelSpec("general", args.execution),
            },
          }
        : {}),
      thinkingLevel: pi.thinkingLevelFor(args.execution.reasoningEffort),
      tools: async () =>
        (
          await this.createTools(
            turn,
            this.cloudAgentHome(turn),
            skillCatalog,
            home.memoryPreference.memoryEnabled,
          )
        ).catalog,
      sources,
    };
    const runtime = await this.openPiRuntime(args.gatewayOrigin);
    const unbind = await runtime.bind(binding);
    const context = pi.contextFor(executionSignal);
    let stream: Awaited<ReturnType<typeof runtime.follow>> | undefined;
    let mirrored = (await this.ctx.storage.get<number>(PI_MIRRORED_KEY)) ?? 0;
    try {
      const report = await this.wakeReport(turn);
      const promptKey = `turn:${turn.turnId}:prompt`;
      const promptSeq =
        args.resumeTurn && this.journal.hasRow(promptKey)
          ? this.journal.selectTurnMessages(turn.turnId).rows[0]?.seq
          : await this.journalCliPrompt(turn, executionContext, report, "pi");
      if (promptSeq === undefined) {
        throw new ChatTurnNotResumableError("prompt_row");
      }
      this.live = {
        turnId: turn.turnId,
        streamId: null,
        partialText: "",
        tools: [],
      };
      void this.index
        .flush({ activity: "running", updatedAt: Date.now() })
        .catch(() => undefined);
      await runtime.configureRoot(binding, context);
      let persistError: string | undefined;
      stream = await runtime.follow(
        mirrored,
        (entry) => {
          if (persistError !== undefined) return;
          const message = entry.model?.[0];
          if (
            message &&
            (entry.kind === "pi.assistant" ||
              entry.kind === "pi.tool-result") &&
            pi.journalSeqOf(entry) === undefined &&
            !isUsageLimitReply(message)
          ) {
            try {
              const appended = this.appendProduced(
                turn,
                message as unknown as AgentMessage,
                {
                  writer: "orchestrator",
                  writerKey: `pi:${entry.id}`,
                  streamId: null,
                },
              );
              if (appended) this.publish(appended.record);
            } catch (error) {
              persistError = errorMessage(error);
              this.currentPiRun?.abort();
              return;
            }
          }
          mirrored = Math.max(mirrored, entry.id);
        },
        context,
        (tool) =>
          this.noteTurnTool(
            turn,
            { toolCallId: tool.toolCallId, name: tool.name, args: tool.args },
            tool.phase,
            tool.isError,
          ),
      );
      await assertExactTurnActive();
      if (turn.piAgent) {
        await runtime.scheduledAgent(
          turn.piAgent,
          turn.prompt,
          turn.turnId,
          context,
        );
        log("info", "pi_scheduled_agent_started", {
          turnId: turn.turnId,
          conversationId: turn.conversationId,
          threadId: turn.piAgent.threadId,
        });
        return await this.completeChatTurn(turn, "", args.started);
      }
      const [, images] = await Promise.all([
        runtime.importJournal(
          (afterSeq) =>
            this.archive.readRange(
              afterSeq + 1,
              Number.MAX_SAFE_INTEGER,
              PI_JOURNAL_IMPORT_BATCH,
            ),
          turn.turnId,
          context,
        ),
        this.loadChatAttachmentImages(turn, executionSignal),
      ]);
      const { root } = await runtime.open();
      const clock = formatTurnClock(Date.now(), turn.timeZone);
      const text = turn.hiddenMessage
        ? report.prompt
        : `${report.prompt.replace(/\s+$/u, "")}\n\n${formatMessageRefTag(promptSeq)}`;
      const hidden = { stella: { hidden: true as const } };
      const submission = await root.submit(
        {
          type: "input",
          requestId: `turn:${turn.turnId}`,
          whenBusy: "followUp",
          content: [
            {
              type: "text",
              text: `<current-time>${clock}</current-time>`,
              ...hidden,
            },
            { type: "text", text, ...(turn.hiddenMessage ? hidden : {}) },
            ...(turn.context?.text
              ? [{ type: "text" as const, text: turn.context.text, ...hidden }]
              : []),
            ...(turn.attachments?.length
              ? [
                  {
                    type: "text" as const,
                    text: attachedFilesText(turn.attachments, {
                      readableHere: true,
                    }),
                  },
                ]
              : []),
            ...images,
          ],
        },
        context,
      );
      log("info", "pi_turn_submitted", {
        turnId: turn.turnId,
        conversationId: turn.conversationId,
        submissionId: submission.id,
        resumed: args.resumeTurn,
        preparationMs: Math.round(performance.now() - args.started),
        ...args.preparationTimings,
      });
      this.currentPiRun = {
        abort: () => {
          runtime.stopClaudeCode();
          void root.abort(pi.contextFor()).catch((error: unknown) => {
            log("error", "pi_turn_abort_failed", {
              turnId: turn.turnId,
              message: errorMessage(error),
            });
          });
        },
      };
      if (executionSignal.aborted || turnCancellation.aborted) {
        this.currentPiRun.abort();
      }
      let settled: Awaited<ReturnType<typeof submission.wait>>;
      try {
        settled = await submission.wait(context);
      } catch (error) {
        if (
          turnCancellation.aborted ||
          executionSignal.aborted ||
          (await this.getTurnState<boolean>("terminal"))
        ) {
          this.currentPiRun?.abort();
          await this.afterTerminal(turn);
          return json({ ok: false, canceled: true });
        }
        if (persistError !== undefined) {
          throw new Error(`Persisting the reply failed: ${persistError}`);
        }
        throw error;
      }
      if (persistError !== undefined) {
        throw new Error(`Persisting the reply failed: ${persistError}`);
      }
      if (await this.getTurnState<boolean>("terminal")) {
        await this.afterTerminal(turn);
        return json({ ok: false, canceled: true });
      }
      if (settled.status !== "done") {
        const claudeCodeFailure =
          args.execution.engine === "anthropic"
            ? this.claudeCodeTransport().takeFailure(turn.turnId)
            : undefined;
        const usageLimit = claudeCodeFailure ? claudeUsageLimitOf(claudeCodeFailure) : null;
        if (usageLimit && (await this.holdForClaudeUsageLimit(turn, usageLimit))) {
          return await this.completeChatTurn(turn, "", args.started);
        }
        throw claudeCodeFailure
          ? new CliTurnFailedError(
              `Claude Code turn failed: ${claudeCodeFailure}`,
              claudeCodeFailure,
            )
          : new Error(`Stella could not answer this turn (${settled.reason}).`);
      }
      const finalText = (await runtime.answer(settled, context)).trim();
      log("info", "pi_turn_answered", {
        turnId: turn.turnId,
        conversationId: turn.conversationId,
        wallClockMs: Math.round(performance.now() - args.started),
      });
      return await this.completeChatTurn(turn, finalText, args.started);
    } finally {
      this.currentPiRun = undefined;
      if (args.execution.engine === "anthropic") {
        this.claudeCodeTransport().takeFailure(turn.turnId);
      }
      unbind();
      await stream?.stop().catch(() => undefined);
      await this.ctx.storage
        .put(PI_MIRRORED_KEY, mirrored)
        .catch(() => undefined);
      await this.piHeartbeat().catch(() => undefined);
      await runtime
        .publishCheckpoint(
          () =>
            this.journal.recentTurnIds("orchestrator", CHECKPOINT_TURN_SCAN),
          (summary, firstKept) =>
            this.storeJournalCheckpoint(summary, firstKept),
          pi.contextFor(),
        )
        .catch((error: unknown) =>
          log("error", "journal_checkpoint_publish_failed", {
            message: errorMessage(error),
          }),
        );
      await this.placeBrainHandoff(
        turn.turnId,
        turnCancellation.aborted || executionSignal.aborted,
      );
    }
  }
}
