import crypto from "node:crypto";
import {
  METHOD_NAMES,
  type RuntimeAttachmentRef,
  type RuntimeLocalAgentCancellationRequest,
  type RuntimeLocalAgentMessageRequest,
  type RuntimeLocalAgentStopRequest,
  type RuntimeLocalAgentSteerRequest,
  type RuntimeLocalAgentRequest,
  type RuntimeOneShotCompletionRequest,
  type RuntimePlacementAutomationCancellationRequest,
} from "@stella/contracts/protocol";
import {
  RunnerUnavailableError,
  WorkerNotInitializedError,
} from "../errors.js";
import { isFramedAgentMessage } from "@stella/contracts/agent-directory";
import {
  cancelPiPlacedAgent,
  markPlacementReconciled,
  cancelPiPlacement,
  piChatsFor,
  piDeliverAgentMessage,
  piStopAgent,
  piPlacementCanceled,
  piPlacedChat,
} from "../pi-chats.js";
import { requireSession, type OpenSession } from "../sessions.js";
import type { WorkerRpcHandlers } from "../rpc.js";
import {
  isPlacementThreadId,
  placementRemoteThreadAgentId,
} from "@stella/contracts/placement-thread-id";
import { isPlacementLocalAgentId } from "../../../kernel/runner/execution-placement-local-ownership.js";

const piPlacedAgentKey = (agentId: string): string =>
  isPlacementLocalAgentId(agentId) || isPlacementThreadId(agentId)
    ? agentId
    : placementRemoteThreadAgentId(agentId);

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
  [METHOD_NAMES.INTERNAL_WORKER_RUN_AUTOMATION]: async (params, ctx) => {
    const session = requireSession(
      ctx.sessions,
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
      handoff?: boolean;
      model?: string;
      failover?: boolean;
      attachments?: RuntimeAttachmentRef[];
      context?: unknown;
    };
    if (automation.executionPlacementRunId) {
      const placementRunId = automation.executionPlacementRunId;
      return await piPlacedChat(session, ctx.hostBus, {
        conversationId: automation.conversationId,
        userPrompt: automation.userPrompt,
        placementRunId,
        ...(automation.userMessageEventId
          ? { userMessageEventId: automation.userMessageEventId }
          : {}),
        ...(automation.attachments?.length
          ? { attachments: automation.attachments }
          : {}),
        ...(automation.context !== undefined
          ? { context: automation.context }
          : {}),
        ...(automation.scheduled ? { scheduled: true } : {}),
        ...(automation.handoff ? { handoff: true } : {}),
        ...(automation.handoff && automation.model ? { model: automation.model } : {}),
        ...(automation.failover ? { failover: true } : {}),
      });
    }
    return await (await piChatsFor(session, ctx.hostBus)).automation(
      automation.conversationId,
      {
        requestId:
          automation.userMessageEventId || `automation:${crypto.randomUUID()}`,
        prompt: automation.userPrompt,
        visible: automation.userAuthoredPrompt === true,
        ...(automation.rejectIfBusy ? { rejectIfBusy: true } : {}),
      },
    );
  },

  [METHOD_NAMES.INTERNAL_WORKER_CANCEL_PLACEMENT_AUTOMATION]: async (
    params,
    ctx,
  ) => {
    const session = requireSession(
      ctx.sessions,
      () => new RunnerUnavailableError(),
    );
    const payload = params as RuntimePlacementAutomationCancellationRequest;
    const runId =
      typeof payload.runId === "string" ? payload.runId.trim() : "";
    if (!runId) {
      throw new Error(
        "An execution-placement automation cancellation requires runId.",
      );
    }
    const reason =
      typeof payload.reason === "string" ? payload.reason : undefined;
    return { canceled: await cancelPiPlacement(session, runId, reason) };
  },

  [METHOD_NAMES.INTERNAL_WORKER_RUN_BLOCKING_AGENT]: async (params, ctx) => {
    const session = requireSession(
      ctx.sessions,
      () => new RunnerUnavailableError(),
    );
    const payload = params as RuntimeLocalAgentRequest;
    const attachments = await session.agentRuns.materializeAgentAttachments({
      conversationId: payload.conversationId,
      ...(payload.attachments ? { attachments: payload.attachments } : {}),
    });
    const requestedModel = payload.requestedModel?.trim();
    const pickedModel =
      requestedModel && requestedModel !== "default"
        ? requestedModel
        : undefined;
    const agentKey = payload.remoteThreadId
      ? piPlacedAgentKey(payload.remoteThreadId)
      : payload.threadId || payload.executionId || crypto.randomUUID();
    const runKey = payload.executionId || agentKey;
    const chats = await piChatsFor(session, ctx.hostBus);
    const canceled =
      payload.threadId || payload.executionId
        ? piPlacementCanceled(session, "agent", runKey)
        : null;
    if (canceled) {
      return {
        status: "error" as const,
        finalText: "" as const,
        error: canceled,
        threadId: agentKey,
      };
    }
    const result = await chats.runPlacedAgent(payload.conversationId, {
      agentKey,
      runKey,
      ...(payload.remoteThreadId ? { threadId: payload.remoteThreadId } : {}),
      ...(payload.lineage ? { lineage: payload.lineage } : {}),
      description: payload.description,
      prompt: withAttachedFiles(payload.prompt, attachments),
      ...(pickedModel ? { model: pickedModel } : {}),
    });
    if (result.status === "ok" && result.finalText) {
      await session.runner
        .ensureInitialized()
        .then((runner) => runner.publishLinkedFiles(result.finalText))
        .catch(() => undefined);
    }
    if (result.status === "moved") {
      return { status: "ok" as const, finalText: "", threadId: result.threadId };
    }
    return result.status === "ok"
      ? {
          status: "ok" as const,
          finalText: result.finalText,
          threadId: result.threadId,
          ...(result.waitingFor ? { waitingFor: result.waitingFor } : {}),
        }
      : {
          status: result.status,
          finalText: "" as const,
          error: result.error,
          threadId: result.threadId,
          ...("stopped" in result && result.stopped
            ? { stopped: true as const }
            : {}),
        };
  },

  [METHOD_NAMES.INTERNAL_WORKER_STEER_BLOCKING_AGENT]: async (params, ctx) => {
    const session = requireSession(
      ctx.sessions,
      () => new RunnerUnavailableError(),
    );
    const payload = params as RuntimeLocalAgentSteerRequest;
    const delivered = await (await piChatsFor(session, ctx.hostBus)).steerPlacedAgent({
      key: String(payload.messageId || crypto.randomUUID()),
      agentKey: piPlacedAgentKey(String(payload.agentId ?? "")),
      message: String(payload.text ?? ""),
    });
    return { delivered };
  },

  [METHOD_NAMES.INTERNAL_WORKER_DELIVER_AGENT_MESSAGE]: async (params, ctx) => {
    const session = requireSession(
      ctx.sessions,
      () => new RunnerUnavailableError(),
    );
    const payload = params as RuntimeLocalAgentMessageRequest;
    const message = {
      threadId: String(payload.threadId ?? ""),
      text: String(payload.text ?? ""),
      messageId: String(payload.messageId ?? ""),
    };
    const sender =
      payload.sender === "user" ||
      payload.sender === "starter" ||
      payload.sender === "other"
        ? payload.sender
        : undefined;
    const outcome = await piDeliverAgentMessage(session, ctx.hostBus, {
      ...message,
      ...(sender ? { sender } : {}),
    });
    if (
      outcome === "not_found" &&
      !payload.ownerGeneration &&
      message.messageId.startsWith("schedule:")
    ) {
      const routed = await scheduleFireThroughCloud(session, message);
      if (routed) return { outcome: routed };
    }
    return { outcome };
  },

  [METHOD_NAMES.INTERNAL_WORKER_STOP_LOCAL_AGENT]: async (params, ctx) => {
    const session = requireSession(
      ctx.sessions,
      () => new RunnerUnavailableError(),
    );
    const payload = params as RuntimeLocalAgentStopRequest;
    const threadId = String(payload.threadId ?? "");
    session.runnerCell.get()?.computerAgents.dropQueuedStarts(threadId);
    const stopped = await piStopAgent(session, ctx.hostBus, threadId);
    return { outcome: stopped === "not_found" ? "not_found" : "stopped" };
  },

  [METHOD_NAMES.INTERNAL_WORKER_PLACEMENT_RECONCILED]: () => {
    markPlacementReconciled();
    return { ok: true };
  },

  [METHOD_NAMES.INTERNAL_WORKER_CANCEL_BLOCKING_AGENT]: async (params, ctx) => {
    const session = requireSession(
      ctx.sessions,
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
    const reason =
      typeof payload.reason === "string" ? payload.reason : undefined;
    const executionId =
      typeof payload.executionId === "string" ? payload.executionId.trim() : "";
    const runKey = executionId || agentId;
    return {
      canceled: await cancelPiPlacedAgent(session, {
        agentKey: piPlacedAgentKey(agentId),
        runKey,
        ...(reason ? { reason } : {}),
      }),
    };
  },

  [METHOD_NAMES.INTERNAL_WORKER_CREATE_BACKGROUND_AGENT]: async (
    params,
    ctx,
  ) => {
    const session = requireSession(
      ctx.sessions,
      () => new RunnerUnavailableError(),
    );
    const payload = params as RuntimeLocalAgentRequest;
    return await (await piChatsFor(session, ctx.hostBus)).startAgent(
      payload.conversationId,
      {
        key: payload.threadId || crypto.randomUUID(),
        description: payload.description,
        prompt: payload.prompt,
      },
    );
  },

  [METHOD_NAMES.INTERNAL_WORKER_WEB_SEARCH]: async (params, ctx) => {
    const session = requireSession(
      ctx.sessions,
      () => new RunnerUnavailableError(),
    );
    const payload = params as {
      query: string;
      category?: string;
    };
    const runner = await session.runner.ensureInitialized();
    return await runner.webSearch(payload.query, {
      category: payload.category,
    });
  },

  [METHOD_NAMES.INTERNAL_WORKER_ONE_SHOT_COMPLETION]: async (params, ctx) => {
    const session = requireSession(
      ctx.sessions,
      () => new WorkerNotInitializedError(),
    );
    return await session.agentRuns.oneShotCompletion(
      params as RuntimeOneShotCompletionRequest,
    );
  },
};

const scheduleFireThroughCloud = async (
  session: OpenSession,
  message: { threadId: string; text: string; messageId: string },
): Promise<"steered" | "resumed" | "queued" | undefined> => {
  const runner = session.runnerCell.get();
  if (!runner?.getStellaSiteAuth()) return undefined;
  const scheduleId = /^schedule:(.+):\d+$/u.exec(message.messageId)?.[1];
  try {
    const delivery = await runner.agentThreads.message({
      messageId: message.messageId,
      to: message.threadId,
      text: message.text,
      from: {
        threadId:
          scheduleId && scheduleId !== message.threadId
            ? scheduleId
            : "schedule",
        label: "a schedule on another computer",
      },
      ...(isFramedAgentMessage(message.text) ? { framed: true } : {}),
    });
    return delivery.outcome === "steered" || delivery.outcome === "resumed"
      ? delivery.outcome
      : "queued";
  } catch (error) {
    console.warn(
      "[schedules] a schedule's fire for a task elsewhere did not reach it",
      message.threadId,
      error,
    );
    return undefined;
  }
};
