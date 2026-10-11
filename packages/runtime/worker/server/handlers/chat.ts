import crypto from "node:crypto";
import { Effect } from "effect";
import { METHOD_NAMES } from "@stella/contracts/protocol";
import { RunnerUnavailableError, WorkerRequestError } from "../errors.js";
import { asTrimmedString } from "../attachments.js";
import * as HostBus from "../host-bus.js";
import { piChatsFor } from "../pi-chats.js";
import * as WorkerSessions from "../sessions.js";
import { fromPromise, type WorkerRpcHandlers } from "../rpc.js";

export const chatHandlers: WorkerRpcHandlers = {
  [METHOD_NAMES.INTERNAL_WORKER_SEND_AGENT_INPUT]: (params) =>
    Effect.gen(function* () {
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
        return yield* Effect.fail(
          new WorkerRequestError({ message: "conversationId is required." }),
        );
      }
      if (!message) {
        return yield* Effect.fail(
          new WorkerRequestError({ message: "message is required." }),
        );
      }
      const session = yield* WorkerSessions.sessionOrFail(
        () => new RunnerUnavailableError(),
      );
      if (!threadId) {
        const userAsk = payload.metadata?.userAsk as { askId?: unknown } | undefined;
        if (typeof userAsk?.askId !== "string" || !userAsk.askId) {
          return yield* Effect.fail(
            new WorkerRequestError({ message: "threadId is required." }),
          );
        }
        const runner = session.runnerCell.get();
        if (!runner) {
          return yield* Effect.fail(new RunnerUnavailableError());
        }
        const askId = userAsk.askId;
        return yield* fromPromise(async () => {
          await runner.deliverOrchestratorNote({
            conversationId,
            requestId: `user-ask-late:${askId}`,
            text: message,
          });
          return { delivered: true as const };
        });
      }
      const hostBus = yield* HostBus.Service;
      return yield* fromPromise(async () => {
        await (await piChatsFor(session, hostBus)).messageAgent(conversationId, {
          key: crypto.randomUUID(),
          threadId,
          message,
        });
        return { delivered: true as const };
      });
    }),
};
