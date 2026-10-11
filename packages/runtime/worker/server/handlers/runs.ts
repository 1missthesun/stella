import crypto from "node:crypto";
import { Effect } from "effect";
import {
  METHOD_NAMES,
  type RuntimeAttachmentRef,
  type RuntimeLocalAgentCancellationRequest,
  type RuntimeLocalAgentMessageRequest,
  type RuntimeLocalAgentPauseRequest,
  type RuntimeLocalAgentSteerRequest,
  type RuntimeLocalAgentRequest,
  type RuntimeOneShotCompletionRequest,
  type RuntimePlacementAutomationCancellationRequest,
} from "@stella/contracts/protocol";
import {
  RunnerUnavailableError,
  WorkerNotInitializedError,
} from "../errors.js";
import * as HostBus from "../host-bus.js";
import {
  cancelPiPlacedAgent,
  cancelPiPlacement,
  piChatsFor,
  piDeliverAgentMessage,
  piPauseAgent,
  piPlacementCanceled,
  piPlacedChat,
} from "../pi-chats.js";
import * as WorkerSessions from "../sessions.js";
import { fromPromise, type WorkerRpcHandlers } from "../rpc.js";
import {
  isPlacementThreadId,
  placementRemoteThreadAgentId,
} from "@stella/contracts/placement-thread-id";
import { isPlacementLocalAgentId } from "../../../kernel/runner/execution-placement-local-ownership.js";

const piPlacedAgentKey = (agentId: string): string =>
  isPlacementLocalAgentId(agentId) || isPlacementThreadId(agentId)
    ? agentId
    : placementRemoteThreadAgentId(agentId);

/** A placed agent's brief, with where the files the user attached are on this computer. */
const withAttachedFiles = (
  prompt: string,
  attachments: readonly RuntimeAttachmentRef[],
): string => {
  const paths = attachments.flatMap((attachment) =>
    attachment.sourcePath ? [JSON.stringify(attachment.sourcePath)] : [],
  );
  return paths.length === 0
    ? prompt
    : `${prompt}\n\nThe user attached these files; they are on this computer at: ${paths.join(", ")}.`;
};

export const runsHandlers: WorkerRpcHandlers = {
  [METHOD_NAMES.INTERNAL_WORKER_RUN_AUTOMATION]: (params) =>
    Effect.gen(function* () {
      const session = yield* WorkerSessions.sessionOrFail(
        () => new RunnerUnavailableError(),
      );
      const automation = params as {
        conversationId: string;
        userPrompt: string;
        rejectIfBusy?: boolean;
        executionPlacementRunId?: string;
        userMessageEventId?: string;
        userAuthoredPrompt?: boolean;
        scheduled?: boolean;
        attachments?: RuntimeAttachmentRef[];
      };
      // The host's own turns (schedule fires, watch escalations, heartbeats)
      // and the chats other devices place here run in the conversation's harness.
      const hostBus = yield* HostBus.Service;
      if (automation.executionPlacementRunId) {
        const placementRunId = automation.executionPlacementRunId;
        return yield* fromPromise(() =>
          piPlacedChat(session, hostBus, {
            conversationId: automation.conversationId,
            userPrompt: automation.userPrompt,
            placementRunId,
            ...(automation.userMessageEventId ? { userMessageEventId: automation.userMessageEventId } : {}),
            ...(automation.attachments?.length ? { attachments: automation.attachments } : {}),
            ...(automation.scheduled ? { scheduled: true } : {}),
          }),
        );
      }
      return yield* fromPromise(async () =>
        (await piChatsFor(session, hostBus)).automation(automation.conversationId, {
          requestId: automation.userMessageEventId || `automation:${crypto.randomUUID()}`,
          prompt: automation.userPrompt,
          visible: automation.userAuthoredPrompt === true,
          ...(automation.rejectIfBusy ? { rejectIfBusy: true } : {}),
        }),
      );
    }),

  [METHOD_NAMES.INTERNAL_WORKER_CANCEL_PLACEMENT_AUTOMATION]: (params) =>
    Effect.gen(function* () {
      const session = yield* WorkerSessions.sessionOrFail(
        () => new RunnerUnavailableError(),
      );
      const payload = params as RuntimePlacementAutomationCancellationRequest;
      const runId = typeof payload.runId === "string" ? payload.runId.trim() : "";
      if (!runId) {
        throw new Error(
          "An execution-placement automation cancellation requires runId.",
        );
      }
      const reason = typeof payload.reason === "string" ? payload.reason : undefined;
      return { canceled: yield* fromPromise(() => cancelPiPlacement(session, runId, reason)) };
    }),

  [METHOD_NAMES.INTERNAL_WORKER_RUN_BLOCKING_AGENT]: (params) =>
    Effect.gen(function* () {
      const session = yield* WorkerSessions.sessionOrFail(
        () => new RunnerUnavailableError(),
      );
      const payload = params as RuntimeLocalAgentRequest;
      // Before the agent starts, so its brief can name real paths. A failed
      // download fails the agent here rather than starting one that will
      // report it cannot find the file the user attached.
      const attachments = yield* fromPromise(() =>
        session.agentRuns.materializeAgentAttachments({
          conversationId: payload.conversationId,
          ...(payload.attachments ? { attachments: payload.attachments } : {}),
        }),
      );
      // An agent another device placed here runs in the conversation's
      // harness, on the model its requester named (Claude Code included);
      // its answer goes back through the placement.
      const requestedModel = payload.requestedModel?.trim();
      const pickedModel = requestedModel && requestedModel !== "default" ? requestedModel : undefined;
      const hostBus = yield* HostBus.Service;
      const agentKey = payload.remoteThreadId
        ? piPlacedAgentKey(payload.remoteThreadId)
        : payload.threadId || payload.executionId || crypto.randomUUID();
      const runKey = payload.executionId || agentKey;
      return yield* fromPromise(async () => {
        const chats = await piChatsFor(session, hostBus);
        const canceled = payload.threadId || payload.executionId ? piPlacementCanceled(session, "agent", runKey) : null;
        if (canceled) return { status: "error" as const, finalText: "" as const, error: canceled, threadId: agentKey };
        const result = await chats.runPlacedAgent(payload.conversationId, {
          agentKey,
          runKey,
          ...(payload.remoteThreadId ? { threadId: payload.remoteThreadId } : {}),
          description: payload.description,
          prompt: withAttachedFiles(payload.prompt, attachments),
          ...(pickedModel ? { model: pickedModel } : {}),
        }).catch((error: unknown) => {
          if (!pickedModel) throw error;
          return {
            threadId: agentKey,
            status: "error" as const,
            error: `This device couldn't run the agent on "${pickedModel}": ${error instanceof Error ? error.message : String(error)}`,
          };
        });
        // The report goes back to a chat on another device; the files it
        // links are here, so this computer shares them.
        if (result.status === "ok" && result.finalText) {
          await session.runner
            .ensureInitialized()
            .then((runner) => runner.publishLinkedFiles(result.finalText))
            .catch(() => undefined);
        }
        return result.status === "ok"
          ? { status: "ok" as const, finalText: result.finalText, threadId: result.threadId }
          : { status: result.status, finalText: "" as const, error: result.error, threadId: result.threadId };
      });
    }),

  [METHOD_NAMES.INTERNAL_WORKER_STEER_BLOCKING_AGENT]: (params) =>
    Effect.gen(function* () {
      const session = yield* WorkerSessions.sessionOrFail(
        () => new RunnerUnavailableError(),
      );
      const payload = params as RuntimeLocalAgentSteerRequest;
      const hostBus = yield* HostBus.Service;
      const delivered = yield* fromPromise(async () =>
        (await piChatsFor(session, hostBus)).steerPlacedAgent({
          key: String(payload.messageId || crypto.randomUUID()),
          agentKey: piPlacedAgentKey(String(payload.agentId ?? "")),
          message: String(payload.text ?? ""),
        }),
      );
      return { delivered };
    }),

  [METHOD_NAMES.INTERNAL_WORKER_DELIVER_AGENT_MESSAGE]: (params) =>
    Effect.gen(function* () {
      const session = yield* WorkerSessions.sessionOrFail(
        () => new RunnerUnavailableError(),
      );
      const payload = params as RuntimeLocalAgentMessageRequest;
      const hostBus = yield* HostBus.Service;
      const outcome = yield* fromPromise(() =>
        piDeliverAgentMessage(session, hostBus, {
          threadId: String(payload.threadId ?? ""),
          text: String(payload.text ?? ""),
          messageId: String(payload.messageId ?? ""),
        }),
      );
      return { outcome };
    }),

  [METHOD_NAMES.INTERNAL_WORKER_PAUSE_LOCAL_AGENT]: (params) =>
    Effect.gen(function* () {
      const session = yield* WorkerSessions.sessionOrFail(
        () => new RunnerUnavailableError(),
      );
      const payload = params as RuntimeLocalAgentPauseRequest;
      const threadId = String(payload.threadId ?? "");
      const hostBus = yield* HostBus.Service;
      const outcome = yield* fromPromise(() =>
        piPauseAgent(session, hostBus, threadId),
      );
      return { outcome };
    }),

  [METHOD_NAMES.INTERNAL_WORKER_CANCEL_BLOCKING_AGENT]: (params) =>
    Effect.gen(function* () {
      const session = yield* WorkerSessions.sessionOrFail(
        () => new RunnerUnavailableError(),
      );
      const payload = params as RuntimeLocalAgentCancellationRequest;
      const agentId =
        typeof payload.agentId === "string" ? payload.agentId.trim() : "";
      if (!agentId) {
        throw new Error(
          "A blocking local-agent cancellation requires agentId.",
        );
      }
      const reason = typeof payload.reason === "string" ? payload.reason : undefined;
      const executionId = typeof payload.executionId === "string" ? payload.executionId.trim() : "";
      const runKey = executionId || agentId;
      return {
        canceled: yield* fromPromise(() =>
          cancelPiPlacedAgent(session, { agentKey: piPlacedAgentKey(agentId), runKey, ...(reason ? { reason } : {}) }),
        ),
      };
    }),

  [METHOD_NAMES.INTERNAL_WORKER_CREATE_BACKGROUND_AGENT]: (params) =>
    Effect.gen(function* () {
      const session = yield* WorkerSessions.sessionOrFail(
        () => new RunnerUnavailableError(),
      );
      const payload = params as RuntimeLocalAgentRequest;
      // An agent the app starts (an app-source merge, memory sync) is a pi
      // agent of the conversation's orchestrator.
      const hostBus = yield* HostBus.Service;
      return yield* fromPromise(async () =>
        (await piChatsFor(session, hostBus)).startAgent(payload.conversationId, {
          key: payload.threadId || crypto.randomUUID(),
          description: payload.description,
          prompt: payload.prompt,
        }),
      );
    }),

  [METHOD_NAMES.INTERNAL_WORKER_WEB_SEARCH]: (params) =>
    Effect.gen(function* () {
      const session = yield* WorkerSessions.sessionOrFail(
        () => new RunnerUnavailableError(),
      );
      const payload = params as {
        query: string;
        category?: string;
      };
      const runner = yield* fromPromise(() =>
        session.runner.ensureInitialized(),
      );
      return yield* fromPromise(() =>
        runner.webSearch(payload.query, {
          category: payload.category,
        }),
      );
    }),

  [METHOD_NAMES.INTERNAL_WORKER_ONE_SHOT_COMPLETION]: (params) =>
    Effect.gen(function* () {
      const session = yield* WorkerSessions.sessionOrFail(
        () => new WorkerNotInitializedError(),
      );
      return yield* fromPromise(() =>
        session.agentRuns.oneShotCompletion(
          params as RuntimeOneShotCompletionRequest,
        ),
      );
    }),
};
