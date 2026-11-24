import crypto from "node:crypto";
import { METHOD_NAMES } from "@stella/contracts/protocol";
import { RunnerUnavailableError, WorkerRequestError } from "../errors.js";
import { asTrimmedString } from "../attachments.js";
import { piChatsFor } from "../pi-chats.js";
import { requireSession } from "../sessions.js";
import type { WorkerRpcHandlers } from "../rpc.js";

export const chatHandlers: WorkerRpcHandlers = {
  [METHOD_NAMES.INTERNAL_WORKER_SEND_AGENT_INPUT]: async (params, ctx) => {
    const payload = params as {
      conversationId?: string;
      threadId?: string;
      message?: string;
      metadata?: Record<string, unknown>;
    };
    const conversationId = asTrimmedString(payload.conversationId);
    const threadId = asTrimmedString(payload.threadId);
    const message = asTrimmedString(payload.message);
    if (!conversationId) {
      throw new WorkerRequestError({ message: "conversationId is required." });
    }
    if (!message) {
      throw new WorkerRequestError({ message: "message is required." });
    }
    const session = requireSession(
      ctx.sessions,
      () => new RunnerUnavailableError(),
    );
    if (!threadId) {
      const userAsk = payload.metadata?.userAsk as
        | { askId?: unknown }
        | undefined;
      if (typeof userAsk?.askId !== "string" || !userAsk.askId) {
        throw new WorkerRequestError({ message: "threadId is required." });
      }
      const runner = session.runnerCell.get();
      if (!runner) {
        throw new RunnerUnavailableError();
      }
      const askId = userAsk.askId;
      await runner.deliverOrchestratorNote({
        conversationId,
        requestId: `user-ask-late:${askId}`,
        text: message,
      });
      return { delivered: true as const };
    }
    await (await piChatsFor(session, ctx.hostBus)).messageAgent(conversationId, {
      key: crypto.randomUUID(),
      threadId,
      message,
    });
    return { delivered: true as const };
  },
};
