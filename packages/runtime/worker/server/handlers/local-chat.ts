import { METHOD_NAMES } from "@stella/contracts/protocol";
import { ChatStoreUnavailableError } from "../errors.js";
import { requireSession } from "../sessions.js";
import type { WorkerRpcHandlers } from "../rpc.js";

export const localChatHandlers: WorkerRpcHandlers = {
  [METHOD_NAMES.INTERNAL_WORKER_LOCAL_CHAT_GET_OR_CREATE_DEFAULT]: (
    _params,
    ctx,
  ) =>
    requireSession(
      ctx.sessions,
      () => new ChatStoreUnavailableError(),
    ).storage.chatStore.chat.getOrCreateDefaultConversationId(),

  [METHOD_NAMES.INTERNAL_WORKER_LOCAL_CHAT_APPEND_EVENT]: (params, ctx) => {
    const session = requireSession(
      ctx.sessions,
      () => new ChatStoreUnavailableError(),
    );
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
  },

  [METHOD_NAMES.INTERNAL_WORKER_LOCAL_CHAT_LIST_EVENTS]: (params, ctx) => {
    const session = requireSession(
      ctx.sessions,
      () => new ChatStoreUnavailableError(),
    );
    const payload = params as {
      conversationId?: string;
      maxItems?: number;
    };
    return session.storage.chatStore.chat.listEvents(
      payload.conversationId ?? "",
      payload.maxItems,
    );
  },

  [METHOD_NAMES.INTERNAL_WORKER_LOCAL_CHAT_GET_EVENT_COUNT]: (params, ctx) => {
    const session = requireSession(
      ctx.sessions,
      () => new ChatStoreUnavailableError(),
    );
    const payload = params as { conversationId?: string };
    return session.storage.chatStore.chat.getEventCount(
      payload.conversationId ?? "",
    );
  },
};
