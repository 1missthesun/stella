import { BILLING_UNAVAILABLE_MESSAGE } from "@stella/contracts/stella-usage-limit";
import {
  type AdmittedCloudChat,
  chatTurnFingerprintSource,
  type CloudChatPreparation,
} from "../cloud-chat-admission.js";
import type { CloudExecutionSelection } from "@stella/contracts/agent-engine";
import type { PiBrainRecord } from "@stella/contracts/turn-plane/pi-brain";
import { TERMINAL_DISPATCH_STATES } from "@stella/contracts/turn-plane/placement";
import type {
  ConversationCreatedEvent,
  OwnerEvent,
  TurnStartedEvent,
} from "@stella/contracts/turn-plane/owner-events";
import {
  type CloudTurnContext,
  type CloudTurnLane,
  type CloudTurnStartResponse,
  TURN_OWNER_GENERATION_HEADER,
  TURN_PLANE_PROTOCOL,
  TURN_PROMPT_MAX_CHARS,
} from "@stella/contracts/turn-plane/turn-start";
import { CLOUD_SANDBOX_SUBSCRIPTION_REQUIRED_MESSAGE } from "@stella/contracts/backend/billing";
import {
  type OwnerGateAdmission,
  type OwnerGateAdmissionWithLease,
  type OwnerGateAdmitInput,
  snapshotAllowsCloudSandbox,
  executionUnavailableMessage,
  snapshotAllowsExecution,
} from "../owner-gate.js";
import {
  conversationTitleFor,
  HEADER_TURN_AUTH_KIND,
  parseCloudTurnStartRequest,
  serviceOnlyTurnFields,
  turnStartErrorResponse,
} from "../turn-start-request.js";
import { sha256Hex } from "../hash.js";
import { HEADER_OWNER } from "../conversation-types.js";
import { normalizeOwnerGeneration } from "../owner-generation.js";
import type {
  ChatTurnRequest,
  ChatTurnAdmissionReceipt,
  OwnerFencedTurn,
  OwnerFenceLeaseReceipt,
  LocalTurnLease,
} from "./types.js";
import {
  CHAT_WATCHDOG_MS,
  AGENT_RUNTIME_KEY,
  PI_BRAIN_KEY,
  LOCAL_TURN_LEASE_KEY,
  chatTurnAdmissionKey,
  CONVERSATION_EXECUTION_KEY,
  CONVERSATION_PROJECTED_KEY,
  ownerPurgeImportedLeaseKey,
  orchestratorFenceLeaseReceiptKey,
} from "./constants.js";
import {
  OwnerPurgeFenceError,
  OwnerFenceLeaseConflictError,
  OwnerFenceRegistrationUncertainError,
  mintOrchestratorTurnCapability,
  isDurableChatTurnAdmissionIntent,
  localTurnRetirementDeadline,
  json,
  errorMessage,
  log,
} from "./support.js";
import { OrchestratorLocalTurn } from "./local-turn.js";

const PI_PLACED_KEY = "piPlacedChats";
const PI_PLACED_CHECK_MS = 15_000;
const PI_PLACED_GIVE_UP_MS = 3 * 60_000;

type PiPlacedChat = {
  clientMsgId: string;
  dispatchId: string;
  ownerId: string;
  prompt: string;
  attachments?: string[];
  context?: CloudTurnContext;
  locale?: string;
  placedAt: number;
};

function unplacedCancelRequestId(clientMsgId: string): string {
  return `pi-brain-unplaced:${clientMsgId}`.slice(0, 128);
}

export abstract class OrchestratorTurnStart extends OrchestratorLocalTurn {
  private async followPlacedChat(placed: PiPlacedChat): Promise<void> {
    const pending =
      (await this.ctx.storage.get<PiPlacedChat[]>(PI_PLACED_KEY)) ?? [];
    if (!pending.some((entry) => entry.clientMsgId === placed.clientMsgId)) {
      await this.ctx.storage.put(PI_PLACED_KEY, [...pending, placed]);
    }
    await this.armAlarmNoLaterThan(Date.now() + PI_PLACED_CHECK_MS);
  }

  protected async checkPlacedChats(): Promise<void> {
    const pending =
      (await this.ctx.storage.get<PiPlacedChat[]>(PI_PLACED_KEY)) ?? [];
    if (pending.length === 0) return;
    const still: PiPlacedChat[] = [];
    for (const placed of pending) {
      const journaled = this.ctx.storage.sql
        .exec<{ found: number }>(
          "SELECT 1 AS found FROM journal WHERE kind = 'message' AND role = 'user' AND client_msg_id = ? LIMIT 1",
          placed.clientMsgId,
        )
        .toArray()[0];
      if (journaled) continue;
      const status = await this.ownerGate(placed.ownerId)
        .dispatchStatus(placed.dispatchId)
        .catch(() => undefined);
      const dispatch = status?.ok ? status.response.dispatch : undefined;
      const terminal =
        dispatch !== undefined && TERMINAL_DISPATCH_STATES.includes(dispatch.state);
      const ownCancelRequestId = unplacedCancelRequestId(placed.clientMsgId);
      if (
        dispatch?.state === "canceled" &&
        dispatch.cancelRequestId &&
        dispatch.cancelRequestId !== ownCancelRequestId
      ) {
        continue;
      }
      if (dispatch?.state === "completed") continue;
      const stuck =
        dispatch?.state === "blocked" ||
        dispatch?.state === "reconciliation_required";
      const late = Date.now() - placed.placedAt >= PI_PLACED_GIVE_UP_MS;
      if (!terminal && !stuck && !late) {
        still.push(placed);
        continue;
      }
      if (!terminal) {
        await this.ownerGate(placed.ownerId)
          .cancelDispatch({
            dispatchId: placed.dispatchId,
            cancelRequestId: ownCancelRequestId,
            reason: "The computer holding Stella did not take this message.",
          })
          .catch(() => undefined);
      }
      const answered = await this.answerUnplacedChat(placed).catch(
        (error: unknown) => {
          log("error", "pi_brain_unplaced_answer_failed", {
            dispatchId: placed.dispatchId,
            message: errorMessage(error),
          });
          return false;
        },
      );
      log("info", "pi_brain_unplaced_answered", {
        dispatchId: placed.dispatchId,
        state: dispatch?.state ?? "unknown",
        answered,
      });
      if (!answered) still.push(placed);
    }
    await this.ctx.storage.put(PI_PLACED_KEY, still);
    if (still.length > 0) {
      await this.armAlarmNoLaterThan(Date.now() + PI_PLACED_CHECK_MS);
    }
  }

  private async answerUnplacedChat(placed: PiPlacedChat): Promise<boolean> {
    const owner = await this.resolveOwnerForCaller({ ownerId: placed.ownerId });
    if (!owner) return false;
    const response = await this.handleTurnStart(
      new Request("https://orchestrator.internal/turns", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [HEADER_OWNER]: placed.ownerId,
          [HEADER_TURN_AUTH_KIND]: "service",
          [TURN_OWNER_GENERATION_HEADER]: owner.ownerGeneration,
        },
        body: JSON.stringify({
          protocol: TURN_PLANE_PROTOCOL,
          clientMsgId: placed.clientMsgId,
          prompt: placed.prompt,
          lane: "chat",
          source: "placement",
          ...(placed.attachments?.length
            ? { attachments: placed.attachments }
            : {}),
          ...(placed.context ? { context: placed.context } : {}),
          ...(placed.locale ? { locale: placed.locale } : {}),
        }),
      }),
    );
    await response.body?.cancel().catch(() => undefined);
    return response.ok;
  }

  protected async handleTurnStart(
    request: Request,
    handoff?: {
      authority: AdmittedCloudChat;
      preparation: CloudChatPreparation;
    },
  ): Promise<Response> {
    // These headers are trustable because a Durable Object namespace is not
    // publicly addressable: only the Worker can produce this request, and it
    // strips any client-supplied x-stella-* before forwarding.
    const ownerId = request.headers.get(HEADER_OWNER)?.trim() ?? "";
    const authKind = request.headers.get(HEADER_TURN_AUTH_KIND)?.trim() ?? "";
    if (!ownerId || (authKind !== "user" && authKind !== "service")) {
      return turnStartErrorResponse(
        "unauthorized",
        "Sign in to send messages.",
        false,
      );
    }
    const expectedGeneration =
      authKind === "service"
        ? normalizeOwnerGeneration(
            request.headers.get(TURN_OWNER_GENERATION_HEADER),
          )
        : null;
    if (authKind === "service" && !expectedGeneration) {
      return turnStartErrorResponse(
        "bad_request",
        `Service callers must send ${TURN_OWNER_GENERATION_HEADER}.`,
        false,
      );
    }
    const parsed = parseCloudTurnStartRequest(
      await request.json().catch(() => null),
    );
    if (!parsed.ok) {
      return turnStartErrorResponse("bad_request", parsed.message, false);
    }
    const start = parsed.request;
    if (authKind === "user") {
      const restricted = serviceOnlyTurnFields(start);
      if (restricted.length > 0) {
        return turnStartErrorResponse(
          "forbidden",
          `${restricted.join(", ")} require service authentication.`,
          false,
        );
      }
    }
    const lane: CloudTurnLane = start.lane ?? "chat";
    if (lane !== "wake" && start.agentThreadControl !== undefined) {
      return turnStartErrorResponse(
        "bad_request",
        "Only wake turns carry agentThreadControl.",
        false,
      );
    }
    if (this.purged()) {
      return turnStartErrorResponse(
        "owner_purged",
        "This conversation was deleted.",
        false,
      );
    }
    const wakeReportSpillKey = await this.spillLargeWakeReport(start);
    if (wakeReportSpillKey === null) {
      return turnStartErrorResponse(
        "internal",
        "The agent report could not be stored yet.",
        true,
        5_000,
      );
    }
    const conversationId = this.conversationId();
    const admissionFingerprint = await sha256Hex(
      chatTurnFingerprintSource(ownerId, conversationId, start),
    );
    const imported = handoff?.authority;
    if (
      imported &&
      (imported.version !== 1 ||
        imported.ownerId !== ownerId ||
        imported.conversationId !== conversationId ||
        imported.clientMsgId !== start.clientMsgId ||
        imported.ownerGeneration !== expectedGeneration ||
        imported.snapshot.ownerGeneration !== expectedGeneration ||
        imported.fingerprint !== admissionFingerprint ||
        !imported.turnId ||
        !imported.leaseId ||
        !imported.fenceGeneration)
    ) {
      return turnStartErrorResponse(
        "idempotency_conflict",
        "Invalid cloud admission identity.",
        false,
      );
    }
    return await this.withTurnAdmissionLock(async () => {
      const boundOwner = this.journal.meta().owner_id;
      if (boundOwner && boundOwner !== ownerId) {
        return turnStartErrorResponse(
          "owner_mismatch",
          "That conversation belongs to another account.",
          false,
        );
      }
      const placedHere = authKind === "service" && start.source === "placement";
      const weighsBrain =
        (authKind === "user" || placedHere) && lane === "chat" && !start.piAgent;
      const home = weighsBrain ? await this.piBrainHome(ownerId) : undefined;
      if (home) await this.bringPiBrainHome(home);
      const brain = weighsBrain
        ? await this.ctx.storage.get<PiBrainRecord>(PI_BRAIN_KEY)
        : undefined;
      if (brain?.host === "device" && placedHere) {
        const holder = await this.piBrainHolderState(ownerId, brain.deviceId);
        const claim = await this.claimPiBrain({
          claimant: { host: "cloud" },
          claimEpoch: null,
          holder: { forEpoch: brain.epoch, ...holder },
        });
        if (claim.record?.host === "device") {
          log("info", "pi_brain_turn_unleased", {
            deviceId: claim.record.deviceId,
            epoch: claim.record.epoch,
          });
        }
      } else if (brain?.host === "device") {
        const holder = await this.piBrainHolderState(ownerId, brain.deviceId);
        let claim = await this.claimPiBrain({
          claimant: { host: "cloud" },
          claimEpoch: null,
          holder: { forEpoch: brain.epoch, ...holder },
        });
        const placeOn =
          claim.decision.kind === "elsewhere" &&
          claim.record?.host === "device" &&
          !(claim.record.epoch === brain.epoch && holder.refusal)
            ? claim.record
            : undefined;
        if (placeOn) {
          try {
            const dispatchId = await this.placeOnPiBrain({
              ownerId,
              deviceId: placeOn.deviceId,
              clientMsgId: start.clientMsgId,
              prompt: start.prompt,
              ...(start.attachments?.length
                ? { attachments: start.attachments }
                : {}),
              ...(start.context ? { context: start.context } : {}),
              ...(start.locale ? { locale: start.locale } : {}),
            });
            log("info", "pi_brain_turn_placed", {
              deviceId: placeOn.deviceId,
              epoch: placeOn.epoch,
              dispatchId,
            });
            await this.followPlacedChat({
              clientMsgId: start.clientMsgId,
              dispatchId,
              ownerId,
              prompt: start.prompt,
              ...(start.attachments?.length
                ? { attachments: start.attachments }
                : {}),
              ...(start.context ? { context: start.context } : {}),
              ...(start.locale ? { locale: start.locale } : {}),
              placedAt: Date.now(),
            });
            return json(
              {
                protocol: TURN_PLANE_PROTOCOL,
                conversationId,
                turnId: `placed:${dispatchId}`,
                accepted: true,
                replayed: false,
                createdConversation: false,
              } satisfies CloudTurnStartResponse,
              202,
            );
          } catch (error) {
            log("info", "pi_brain_turn_unplaced", {
              deviceId: placeOn.deviceId,
              message: errorMessage(error),
            });
            claim = await this.claimPiBrain({
              claimant: { host: "cloud" },
              claimEpoch: placeOn.epoch,
              holder: {
                forEpoch: placeOn.epoch,
                ...(await this.piBrainHolderState(ownerId, placeOn.deviceId)),
              },
            });
          }
        }
        if (claim.record?.host === "device") {
          log("info", "pi_brain_turn_unleased", {
            deviceId: claim.record.deviceId,
            epoch: claim.record.epoch,
          });
        }
      }
      const receiptKey = chatTurnAdmissionKey(start.clientMsgId);
      const stored =
        await this.ctx.storage.get<Partial<ChatTurnAdmissionReceipt>>(
          receiptKey,
        );
      let receipt: ChatTurnAdmissionReceipt | undefined;
      if (stored) {
        if (
          imported &&
          (stored.turnId !== imported.turnId ||
            stored.leaseId !== imported.leaseId ||
            stored.ownerGeneration !== imported.ownerGeneration)
        ) {
          return turnStartErrorResponse(
            "idempotency_conflict",
            "Cloud admission identity changed.",
            false,
          );
        }
        if (stored.fingerprint !== admissionFingerprint) {
          return turnStartErrorResponse(
            "idempotency_conflict",
            "That message id was already used for a different message.",
            false,
          );
        }
        if (
          !isDurableChatTurnAdmissionIntent(stored) ||
          stored.ownerId !== ownerId
        ) {
          return turnStartErrorResponse(
            "idempotency_conflict",
            "That message id has malformed admission authority.",
            false,
          );
        }
        if (stored.phase === "accepted") {
          return json(
            {
              protocol: TURN_PLANE_PROTOCOL,
              conversationId,
              turnId: stored.turnId,
              accepted: true,
              replayed: true,
              createdConversation: stored.createdConversation,
            } satisfies CloudTurnStartResponse,
            202,
          );
        }
        receipt = stored;
      }
      const turnId = receipt?.turnId ?? imported?.turnId ?? crypto.randomUUID();
      const leaseId =
        receipt?.leaseId ?? imported?.leaseId ?? crypto.randomUUID();
      const queuedAt = receipt?.queuedAt ?? Date.now();

      const admittedAt = performance.now();
      const admissionInput: OwnerGateAdmitInput = {
        lane: "chat",
        turnId,
        conversationId,
        ...(expectedGeneration ? { expectedGeneration } : {}),
      };
      let admission: OwnerGateAdmission | undefined = imported
        ? { ok: true, snapshot: imported.snapshot, replayed: false }
        : undefined;
      let combinedGeneration: string | undefined;
      let admittedHomeContext = handoff?.preparation.homeContext;
      let admittedDestinations = handoff?.preparation.destinations;
      if (
        !imported &&
        !receipt &&
        boundOwner === ownerId &&
        this.ownerGeneration
      ) {
        const intentAt = Date.now();
        receipt = {
          schemaVersion: 2,
          fingerprint: admissionFingerprint,
          ownerId,
          ownerGeneration: this.ownerGeneration,
          turnId,
          leaseId,
          phase: "registering",
          createdConversation: !(await this.ctx.storage.get<boolean>(
            CONVERSATION_PROJECTED_KEY,
          )),
          queuedAt,
          createdAt: intentAt,
          updatedAt: intentAt,
        };
        await this.putTurnState({ [receiptKey]: receipt });
        const leaseTurn: OwnerFencedTurn = {
          ownerId,
          ownerGeneration: receipt.ownerGeneration,
          turnId,
          ownerPurgeLeaseId: leaseId,
        };
        const observed: { result?: OwnerGateAdmissionWithLease } = {};
        try {
          combinedGeneration = await this.registerOwnerTurn(
            leaseTurn,
            false,
            admissionFingerprint,
            async (registeredOwnerId, lease) => {
              const result = await this.ownerGate(
                registeredOwnerId,
              ).admitWithFenceLease({
                admission: admissionInput,
                lease,
                includeHomeContext:
                  !this.activeTurnId && this.turnExecutions.size === 0,
              });
              observed.result = result;
              if (result.admission.ok && "homeContext" in result)
                admittedHomeContext = result.homeContext;
              if (result.admission.ok && "destinations" in result)
                admittedDestinations = result.destinations;
              return result.lease.status === "registered"
                ? { generation: result.lease.generation }
                : null;
            },
          );
          admission = observed.result?.admission;
        } catch (error) {
          const result = observed.result;
          if (result?.lease.status === "skipped") {
            await this.ctx.blockConcurrencyWhile(async () => {
              const key = orchestratorFenceLeaseReceiptKey(leaseId);
              const local =
                await this.getTurnState<OwnerFenceLeaseReceipt>(key);
              if (local?.phase === "registering" && local.turnId === turnId) {
                await this.ctx.storage.delete(key);
                if (local.runSlotKey)
                  await this.ctx.storage.delete(local.runSlotKey);
              }
              await this.ctx.storage.delete(receiptKey);
            });
            receipt = undefined;
            admission = result.admission;
          } else {
            await this.releaseOwnerGate({ ownerId, turnId });
            return turnStartErrorResponse(
              error instanceof OwnerFenceRegistrationUncertainError
                ? "internal"
                : "owner_purged",
              error instanceof OwnerFenceRegistrationUncertainError
                ? "Starting that turn is still being reconciled. Try again."
                : "This account's cloud data is being reset or deleted.",
              error instanceof OwnerFenceRegistrationUncertainError,
            );
          }
        }
      }
      admission ??= await this.ownerGateAdmit(ownerId, admissionInput);
      if (!admission.ok) {
        return turnStartErrorResponse(
          admission.code,
          admission.message,
          admission.retryable,
          admission.retryAfterMs,
        );
      }
      const ownerGateMs = Math.round(performance.now() - admittedAt);
      const snapshot = admission.snapshot;
      const refuse = async (
        code: Parameters<typeof turnStartErrorResponse>[0],
        message: string,
        retryable: boolean,
      ): Promise<Response> => {
        if (combinedGeneration && receipt) {
          await this.unregisterOwnerTurn({
            ownerId,
            ownerGeneration: receipt.ownerGeneration,
            turnId,
            ownerPurgeLeaseId: leaseId,
            ownerPurgeGeneration: combinedGeneration,
          });
        }
        await this.releaseOwnerGate({ ownerId, turnId });
        return turnStartErrorResponse(code, message, retryable);
      };
      const allowed = (candidate: CloudExecutionSelection): boolean =>
        (candidate.engine !== "anthropic" ||
          snapshotAllowsCloudSandbox(snapshot)) &&
        snapshotAllowsExecution(snapshot, candidate);
      const conversationExecution =
        lane === "wake" && !start.execution
          ? await this.ctx.storage.get<CloudExecutionSelection>(
              CONVERSATION_EXECUTION_KEY,
            )
          : undefined;
      const execution =
        start.execution ??
        (conversationExecution && allowed(conversationExecution)
          ? conversationExecution
          : snapshot.execution);
      if (
        execution.engine === "anthropic" &&
        !snapshotAllowsCloudSandbox(snapshot)
      ) {
        return await refuse(
          "subscription_required",
          CLOUD_SANDBOX_SUBSCRIPTION_REQUIRED_MESSAGE,
          false,
        );
      }
      if (execution.engine === "anthropic" && lane !== "wake" && snapshot.usageLimit) {
        log("info", "turn_refused_usage_limit", {
          conversationId,
          turnId,
          lane,
          reason: snapshot.usageLimit.reason,
        });
        return await refuse("usage_limit", snapshot.usageLimit.message, false);
      }
      if (!snapshotAllowsExecution(snapshot, execution)) {
        return await refuse(
          "execution_unavailable",
          executionUnavailableMessage(execution),
          false,
        );
      }
      if (execution.engine === "stella" && lane !== "wake") {
        if (snapshot.billingUnavailable) {
          log("error", "turn_refused_billing_unavailable", {
            conversationId,
            turnId,
            lane,
          });
          return await refuse(
            "billing_unavailable",
            BILLING_UNAVAILABLE_MESSAGE,
            true,
          );
        }
        if (snapshot.usageLimit) {
          log("info", "turn_refused_usage_limit", {
            conversationId,
            turnId,
            lane,
            reason: snapshot.usageLimit.reason,
          });
          return await refuse("usage_limit", snapshot.usageLimit.message, false);
        }
      }

      const now = Date.now();
      const createdConversation =
        receipt?.createdConversation ??
        !(await this.ctx.storage.get<boolean>(CONVERSATION_PROJECTED_KEY));
      if (!this.journal.meta().owner_id) {
        this.journal.bindOwner({
          ownerId,
          ownerGeneration: snapshot.ownerGeneration,
          createdAt: now,
          title: conversationTitleFor(start),
          conversationId,
        });
        log("info", "conversation_adopted", { conversationId, via: "turn" });
      } else if (start.title || !this.journal.meta().title) {
        this.journal.setTitle(conversationTitleFor(start));
      }
      if ((await this.ctx.storage.get<string>(AGENT_RUNTIME_KEY)) !== "pi") {
        await this.ctx.storage.put(AGENT_RUNTIME_KEY, "pi");
        if (!createdConversation) {
          log("info", "pi_conversation_migrated", { conversationId });
        }
      }
      if (this.ownerGeneration !== snapshot.ownerGeneration) {
        this.ownerGeneration = snapshot.ownerGeneration;
        await this.ctx.storage.put(
          "ownerDataGeneration",
          snapshot.ownerGeneration,
        );
      }

      const turn: ChatTurnRequest = {
        kind: "chat",
        ownerId,
        ownerGeneration: snapshot.ownerGeneration,
        conversationId,
        turnId,
        sessionId: `chat-${conversationId.slice(0, 8)}`,
        prompt: wakeReportSpillKey
          ? `${start.prompt.slice(0, TURN_PROMPT_MAX_CHARS)}\n\n[The full report is stored with this turn.]`
          : start.prompt,
        execution,
        audience: snapshot.allowance.audience,
        budgetMicroCents: snapshot.allowance.budgetMicroCents,
        lane,
        clientMsgId: start.clientMsgId,
        ...(start.originUserMessageId
          ? { originUserMessageId: start.originUserMessageId }
          : {}),
        ...(start.source ? { source: start.source } : {}),
        ...(start.title ? { title: start.title } : {}),
        ...(start.hiddenMessage || start.piAgent
          ? { hiddenMessage: true }
          : {}),
        ...(start.piAgent ? { piAgent: start.piAgent } : {}),
        ...(start.locale ? { locale: start.locale } : {}),
        ...(snapshot.timeZone ? { timeZone: snapshot.timeZone } : {}),
        ...(start.attachments ? { attachments: start.attachments } : {}),
        ...(start.context ? { context: start.context } : {}),
        ...(start.agentThreadControl
          ? {
              agentThreadControl: wakeReportSpillKey
                ? {
                    ...start.agentThreadControl,
                    ...(start.agentThreadControl.lifecycleReport !== undefined
                      ? {
                          lifecycleReport:
                            start.agentThreadControl.lifecycleReport.slice(
                              0,
                              TURN_PROMPT_MAX_CHARS + 1,
                            ),
                        }
                      : {}),
                  }
                : start.agentThreadControl,
            }
          : {}),
        ...(wakeReportSpillKey ? { wakeReportSpillKey } : {}),
        ownerPurgeLeaseId: leaseId,
        queuedAt,
      };

      if (!receipt) {
        receipt = {
          schemaVersion: 2,
          fingerprint: admissionFingerprint,
          ownerId,
          ownerGeneration: snapshot.ownerGeneration,
          turnId,
          leaseId,
          phase: "registering",
          createdConversation,
          queuedAt,
          createdAt: now,
          updatedAt: now,
        };
        await this.putTurnState({ [receiptKey]: receipt });
      }

      if (
        !this.activeTurnId &&
        this.turnExecutions.size === 0 &&
        this.ctx.storage.kv &&
        !this.ctx.storage.kv.get(LOCAL_TURN_LEASE_KEY) &&
        Array.from(this.ctx.storage.kv.list({ prefix: "queued:", limit: 1 }))
          .length === 0
      ) {
        const harnessExecution =
          turn.execution.engine === "anthropic" ? undefined : turn.execution;
        if (!harnessExecution) {
          this.prewarmCliContainer(turn.ownerId, turn.conversationId);
        }
        const work = (
          harnessExecution
            ? mintOrchestratorTurnCapability(this.env, turn, harnessExecution)
            : Promise.resolve()
        ).then(() => this.prepareCloudHomeContext(turn, admittedHomeContext));
        void work.catch(() => undefined);
        this.cloudHomePreparations.set(turnId, {
          home: work,
          destinations: admittedDestinations
            ? Promise.resolve(admittedDestinations)
            : this.ownerGate(turn.ownerId)
                .devices()
                .catch(() => null),
        });
      }
      const registrationStarted = performance.now();
      let freshAdmission = false;
      try {
        let registeredNow = combinedGeneration !== undefined;
        turn.ownerPurgeGeneration =
          combinedGeneration ??
          (await this.registerOwnerTurn(
            turn,
            false,
            admissionFingerprint,
            async (registeredOwnerId, body) => {
              if (imported) {
                if (
                  registeredOwnerId !== imported.ownerId ||
                  body.turnId !== imported.turnId ||
                  body.leaseId !== imported.leaseId ||
                  body.ownerGeneration !== imported.ownerGeneration
                )
                  throw new OwnerPurgeFenceError();
                const canceled = await this.getTurnState(
                  ownerPurgeImportedLeaseKey(body.leaseId),
                );
                if (canceled) throw new OwnerPurgeFenceError();
                registeredNow = Date.now() - imported.admittedAt < 1_000;
                return { generation: imported.fenceGeneration };
              }
              const result = await this.registerOwnerFenceLease(
                registeredOwnerId,
                body,
              );
              registeredNow = result !== null;
              return result;
            },
          ));
        if (!registeredNow) await this.assertOwnerTurn(turn);
        freshAdmission = registeredNow && admittedHomeContext !== undefined;
      } catch (error) {
        this.cloudHomePreparations.delete(turnId);
        if (error instanceof OwnerFenceLeaseConflictError) {
          return await refuse(
            "idempotency_conflict",
            "That message id was already used for a different message.",
            false,
          );
        }
        if (error instanceof OwnerFenceRegistrationUncertainError) {
          return await refuse(
            "internal",
            "Starting that turn is still being reconciled. Try again.",
            true,
          );
        }
        await this.unregisterOwnerTurn(turn);
        if (error instanceof OwnerPurgeFenceError) {
          return await refuse(
            "owner_purged",
            "This account's cloud data is being reset or deleted.",
            false,
          );
        }
        await this.releaseOwnerGate({ ownerId, turnId });
        throw error;
      }

      const registrationMs = Math.round(
        performance.now() - registrationStarted,
      );
      const commitStarted = performance.now();
      let heldForLocalTurn = false;
      await this.ctx.blockConcurrencyWhile(async () => {
        await this.assertOwnerFenceLeaseReceiptActive(turn);
        if (turn.ownerPurgeLeaseId !== receipt!.leaseId) {
          throw new OwnerPurgeFenceError();
        }
        if (turn.agentThreadControl) {
          await this.rememberCloudAgentControlReceipt(turn.agentThreadControl);
        }
        await this.putTurnState({
          [`queued:${turn.turnId}`]: turn,
          [receiptKey]: {
            ...receipt!,
            phase: "accepted",
            acceptedAt: turn.queuedAt!,
            updatedAt: Date.now(),
          } satisfies ChatTurnAdmissionReceipt,
          ownerDataGeneration: turn.ownerGeneration,
          [CONVERSATION_PROJECTED_KEY]: true,
          ...(lane === "chat" && !turn.piAgent
            ? { [CONVERSATION_EXECUTION_KEY]: execution }
            : {}),
        });
        const localLease =
          await this.ctx.storage.get<LocalTurnLease>(LOCAL_TURN_LEASE_KEY);
        heldForLocalTurn = localLease !== undefined;
        if (localLease) {
          const retirementAt = localTurnRetirementDeadline(localLease);
          await this.armAlarmNoLaterThan(retirementAt);
        } else if ((await this.ctx.storage.getAlarm()) === null) {
          await this.ctx.storage.setAlarm(
            Date.now() + Math.max(1_000, turn.watchdogMs ?? CHAT_WATCHDOG_MS),
          );
        }
      });
      const admissionCommitMs = Math.round(performance.now() - commitStarted);
      const projectionStarted = performance.now();
      const projections: OwnerEvent[] = [];
      if (createdConversation) {
        const meta = this.journal.meta();
        projections.push({
          ...this.ownerEventBase(turn, conversationId),
          kind: "conversation.created",
          conversationId,
          createdAt: meta.created_at > 0 ? meta.created_at : now,
          title: meta.title,
          execution,
        } satisfies ConversationCreatedEvent);
      }
      projections.push({
        ...this.ownerEventBase(turn, turnId),
        kind: "turn.started",
        turnId,
        turnKind: "chat",
        conversationId,
        sessionId: turn.sessionId,
        lane,
        ...(turn.source ? { source: turn.source } : {}),
        clientMsgId: turn.clientMsgId,
        ...(turn.hiddenMessage ? { hidden: true } : {}),
        ...(turn.agentThreadControl
          ? {
              threadId: turn.agentThreadControl.threadId,
              attemptGeneration: turn.agentThreadControl.attemptGeneration,
            }
          : {}),
        agentType: "orchestrator",
        execution,
        prompt: turn.prompt,
        createdAt: queuedAt,
      } satisfies TurnStartedEvent);
      await this.deferOwnerEvents(projections);

      if (!heldForLocalTurn) {
        this.enqueue(turn, freshAdmission);
      } else this.cloudHomePreparations.delete(turnId);
      log("info", "chat_turn_admitted", {
        turnId,
        conversationId,
        admissionTransport: imported
          ? "owner_handoff"
          : combinedGeneration
            ? "combined"
            : "separate",
        ownerGateMs,
        registrationMs,
        admissionCommitMs,
        projectionMs: Math.round(performance.now() - projectionStarted),
        totalMs: Math.round(performance.now() - admittedAt),
      });
      return json(
        {
          protocol: TURN_PLANE_PROTOCOL,
          conversationId,
          turnId,
          accepted: true,
          replayed: false,
          createdConversation,
        } satisfies CloudTurnStartResponse,
        202,
      );
    });
  }
}
