import type { DesktopThreadActivityRecord } from "@/features/chat/thread-activity-types";
import { presentStellaProviderError } from "@/features/chat/streaming/stella-provider-error-toast";
import { showToast } from "@/ui/toast";
import {
  dismissUsageLimitCard,
  presentUsageLimitPaused,
  presentUsageLimitResumed,
  usageLimitCardId,
} from "@/features/chat/usage-limit-card";
import { clearComposerNotices } from "@/features/chat/composer-notice-store";
import {
  emptyPiChat,
  reducePiChat,
  type PiChatAgentsResult,
  type PiChatEvent,
  type PiChatEventsPayload,
  type PiChatPlacedResult,
  type PiChatSend,
  type PiChatState,
  type PiChatWatchResult,
} from "@stella/contracts/pi-chat";

type Watched = {
  state: PiChatState;
  watchers: number;
  listeners: Set<() => void>;
  held?: PiChatEvent[][];
};

const EMPTY: PiChatState = emptyPiChat();
const watched = new Map<string, Watched>();
let unsubscribeEvents: (() => void) | undefined;

const api = () => (typeof window === "undefined" ? undefined : window.electronAPI?.piChat);

export const piChatAvailable = (): boolean => api() !== undefined;

const publish = (entry: Watched) => {
  for (const listener of entry.listeners) listener();
};

const entryFor = (conversationId: string): Watched => {
  let entry = watched.get(conversationId);
  if (!entry) {
    entry = { state: EMPTY, watchers: 0, listeners: new Set() };
    watched.set(conversationId, entry);
  }
  return entry;
};

const attach = (conversationId: string, entry: Watched) => {
  const chat = api();
  if (!chat) return;
  entry.held = [];
  void chat.request({ op: "watch", conversationId }).then(
    (result) => {
      const { snapshot, hasOlder, remote } = result as PiChatWatchResult;
      let state = reducePiChat({ ...entry.state, hasOlder, remote: remote ?? [] }, [snapshot]);
      for (const events of entry.held ?? []) state = reducePiChat(state, events);
      entry.held = undefined;
      entry.state = state;
      publish(entry);
    },
    (error: unknown) => {
      entry.held = undefined;
      entry.state = { ...entry.state, failure: error instanceof Error ? error.message : String(error) };
      publish(entry);
    },
  );
};

const clearStaleNotices = (conversationId: string) => {
  const usageLimit = usageLimitCardId(conversationId);
  clearComposerNotices(conversationId, (notice) => notice.id === usageLimit);
};

const resumeUsageLimit = async (conversationId: string) => {
  const chat = api();
  if (!chat) throw new Error("Stella's runtime isn't available.");
  await chat.request({ op: "resumeUsageLimit", conversationId });
};

const presentUsageLimit = (conversationId: string, event: PiChatEvent & { type: "engine_status" }) => {
  if (event.state === "usage-limit") {
    presentUsageLimitPaused(
      conversationId,
      event.paused ?? { reply: true, tasks: 0, ...(event.until !== undefined ? { until: event.until } : {}) },
      () => resumeUsageLimit(conversationId),
    );
    return;
  }
  if (event.state !== "usage-limit-end") return;
  if (event.resumed) presentUsageLimitResumed(conversationId);
  else dismissUsageLimitCard(conversationId);
};

const presentEvents = (conversationId: string, events: readonly PiChatEvent[]) => {
  for (const event of events) {
    if (event.type === "engine_status" && (event.state === "usage-limit" || event.state === "usage-limit-end")) {
      presentUsageLimit(conversationId, event);
      continue;
    }
    if (event.type === "engine_status" && event.state === "model-fallback") {
      showToast({
        title: "Switched to a fallback model",
        description:
          event.text || "The configured model was unavailable, so this session switched to a fallback model.",
        variant: "error",
        duration: 10000,
      });
      continue;
    }
    if (event.type !== "message_end" || event.entry.kind !== "pi.assistant") continue;
    const message = event.entry.model?.[0];
    if (message?.role !== "assistant") continue;
    if (message.stopReason === "error") {
      presentStellaProviderError(message.errorMessage ?? null, { conversationId });
    } else if (message.stopReason !== "aborted") {
      clearStaleNotices(conversationId);
    }
  }
};

const changesWhatShows = (event: PiChatEvent) => event.type !== "message_update";

let runtimeReady = true;

const listen = () => {
  if (unsubscribeEvents) return;
  unsubscribeEvents = api()?.onEvents(({ conversationId, events }) => {
    const entry = watched.get(conversationId);
    if (!entry || entry.watchers === 0) return;
    presentEvents(conversationId, events);
    if (entry.held) {
      entry.held.push(events);
      return;
    }
    entry.state = reducePiChat(entry.state, events);
    if (events.some(changesWhatShows)) publish(entry);
  });
  window.electronAPI?.agent?.onAvailability?.((snapshot) => {
    const ready = snapshot.connected && snapshot.ready;
    if (ready && !runtimeReady) {
      for (const [conversationId, entry] of watched) {
        if (entry.watchers === 0) continue;
        void api()
          ?.request({ op: "unwatch", conversationId })
          .catch(() => undefined)
          .then(() => attach(conversationId, entry));
      }
    }
    runtimeReady = ready;
  });
};

export const watchPiChat = (conversationId: string): (() => void) => {
  const chat = api();
  if (!chat) return () => {};
  listen();
  const entry = entryFor(conversationId);
  entry.watchers += 1;
  if (entry.watchers === 1) attach(conversationId, entry);
  return () => {
    entry.watchers -= 1;
    if (entry.watchers > 0) return;
    void chat.request({ op: "unwatch", conversationId }).catch(() => undefined);
  };
};

export const subscribePiChat = (conversationId: string, listener: () => void): (() => void) => {
  const entry = entryFor(conversationId);
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
  };
};

export const piChatSnapshot = (conversationId: string | null): PiChatState =>
  (conversationId ? watched.get(conversationId)?.state : undefined) ?? EMPTY;

export const submitPiChat = async (
  conversationId: string,
  requestId: string,
  text: string,
  send?: PiChatSend,
): Promise<PiChatPlacedResult["placed"] | undefined> => {
  const chat = api();
  if (!chat) throw new Error("Stella's runtime is not available.");
  clearStaleNotices(conversationId);
  const result = await chat.request({ op: "submit", conversationId, requestId, text, ...(send ? { send } : {}) });
  return (result as Partial<PiChatPlacedResult> | undefined)?.placed;
};

export const submitPiWelcome = async (conversationId: string, message: string): Promise<void> => {
  const chat = api();
  if (!chat) throw new Error("Stella's runtime is not available.");
  await chat.request({ op: "welcome", conversationId, message });
};

export const importLocalPiChat = async (conversationId: string, fromConversationId: string): Promise<number> => {
  const chat = api();
  if (!chat) throw new Error("Stella's runtime is not available.");
  const result = (await chat.request({ op: "importLocal", conversationId, fromConversationId })) as
    | { imported?: number }
    | undefined;
  return result?.imported ?? 0;
};

export const abortPiChat = (conversationId: string): void => {
  const dispatchIds = (watched.get(conversationId)?.state.remote ?? []).flatMap((turn) =>
    turn.clientMsgId ? [turn.clientMsgId] : [],
  );
  void api()
    ?.request({ op: "abort", conversationId, ...(dispatchIds.length > 0 ? { dispatchIds } : {}) })
    .catch(() => undefined);
};

export const piChatAgents = async (conversationId: string): Promise<DesktopThreadActivityRecord[]> => {
  const chat = api();
  if (!chat) return [];
  const { agents } = (await chat.request({ op: "agents", conversationId })) as PiChatAgentsResult;
  return agents.map((agent) => {
    const latest = agent.assistantMessages[agent.assistantMessages.length - 1];
    return {
      source: "stella",
      pi: true,
      threadId: agent.threadId,
      conversationId,
      agentType: "general",
      description: agent.description,
      status: agent.agentStatus === "canceled" ? "canceled" : agent.status,
      startedAt: agent.startedAt,
      updatedAt: agent.updatedAt,
      ...(agent.status === "running" ? {} : { completedAt: agent.updatedAt }),
      ...(agent.status === "completed" && latest ? { result: latest } : {}),
      ...(agent.error ? { error: agent.error } : {}),
      assistantMessages: agent.assistantMessages,
      assistantMessagesUpdatedAt: agent.updatedAt,
    };
  });
};

export const onPiChatEvents = (listener: (payload: PiChatEventsPayload) => void): (() => void) =>
  api()?.onEvents(listener) ?? (() => {});
