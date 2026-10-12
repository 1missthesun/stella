import { Effect } from "effect";
import { METHOD_NAMES } from "@stella/contracts/protocol";
import { ChatStoreUnavailableError } from "../errors.js";
import * as WorkerSessions from "../sessions.js";
import { type WorkerRpcHandlers } from "../rpc.js";

const chatSession = WorkerSessions.sessionOrFail(
  () => new ChatStoreUnavailableError(),
);

export const localChatHandlers: WorkerRpcHandlers = {
  [METHOD_NAMES.INTERNAL_WORKER_LOCAL_CHAT_GET_OR_CREATE_DEFAULT]: () =>
    Effect.map(chatSession, (session) =>
      session.storage.chatStore.chat.getOrCreateDefaultConversationId(),
    ),

  [METHOD_NAMES.INTERNAL_WORKER_LOCAL_CHAT_APPEND_EVENT]: (params) =>
    Effect.map(chatSession, (session) => {
      const eventArgs = params as {
        conversationId: string;
        type: string;
        payload?: unknown;
        requestId?: string;
        targetDeviceId?: string;
        deviceId?: string;
        timestamp?: number;
        eventId?: string;
        channelEnvelope?: unknown;
      };
      session.storage.appendChatEventAndNotify(eventArgs);
      return { ok: true };
    }),

  [METHOD_NAMES.INTERNAL_WORKER_LOCAL_CHAT_LIST_EVENTS]: (params) =>
    Effect.map(chatSession, (session) => {
      const payload = params as {
        conversationId?: string;
        maxItems?: number;
      };
      return session.storage.chatStore.chat.listEvents(
        payload.conversationId ?? "",
        payload.maxItems,
      );
    }),

  [METHOD_NAMES.INTERNAL_WORKER_LOCAL_CHAT_GET_EVENT_COUNT]: (params) =>
    Effect.map(chatSession, (session) => {
      const payload = params as { conversationId?: string };
      return session.storage.chatStore.chat.getEventCount(
        payload.conversationId ?? "",
      );
    }),

};
