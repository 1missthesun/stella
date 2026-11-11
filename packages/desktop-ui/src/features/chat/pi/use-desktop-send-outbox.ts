import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { MessageRecord } from "@stella/contracts/local-chat";
import type { EventRecord } from "@/features/chat/lib/event-transforms";
import { acceptedUserMessageIds } from "@/features/chat/lib/accepted-user-message-ids";
import { provideCloudSendRecovery } from "@/features/cloud/cloud-send-recovery";
import { desktopSendOutbox, type QueuedSend } from "./desktop-send-outbox";

const markOf = (entry: QueuedSend) =>
  entry.failed ? { sendFailed: entry.failed } : { sendPending: "sending" as const };

/**
 * The chat's own sends as they show before the runtime has them: still
 * waiting ones (also those saved before a restart) say so under the bubble,
 * refused ones offer Retry and Remove.
 */
export function useDesktopSendOutbox(args: {
  conversationId: string | null;
  enabled: boolean;
  optimistic: EventRecord[];
  persisted: readonly MessageRecord[];
}): EventRecord[] {
  const { conversationId, enabled, optimistic, persisted } = args;
  const queued = useSyncExternalStore(
    desktopSendOutbox.subscribe,
    desktopSendOutbox.getSnapshot,
    desktopSendOutbox.getSnapshot,
  );
  useEffect(() => {
    if (!enabled) return;
    desktopSendOutbox.setActive(conversationId);
    return () => desktopSendOutbox.setActive(null);
  }, [conversationId, enabled]);
  useEffect(() => {
    if (!enabled) return;
    return provideCloudSendRecovery({
      retry: (requestId) => desktopSendOutbox.retry(requestId),
      dismiss: (requestId) => desktopSendOutbox.remove(requestId),
    });
  }, [enabled]);
  return useMemo(() => {
    if (!enabled || !conversationId) return optimistic;
    const mine = queued.filter((entry) => entry.conversationId === conversationId);
    if (mine.length === 0 && !optimistic.some((event) => desktopSendOutbox.wasRemoved(event._id))) {
      return optimistic;
    }
    const byId = new Map(mine.map((entry) => [entry.requestId, entry]));
    const shown = new Set<string>();
    const events: EventRecord[] = [];
    for (const event of optimistic) {
      if (desktopSendOutbox.wasRemoved(event._id)) continue;
      const entry = byId.get(event._id);
      shown.add(event._id);
      events.push(entry ? { ...event, payload: { ...event.payload, ...markOf(entry) } } : event);
    }
    const accepted = acceptedUserMessageIds(persisted);
    for (const entry of mine) {
      if (shown.has(entry.requestId) || accepted.has(entry.requestId)) continue;
      const attachments = entry.send?.attachments;
      events.push({
        _id: entry.requestId,
        type: "user_message",
        timestamp: entry.createdAtMs,
        payload: {
          text: entry.text,
          ...(Array.isArray(attachments) && attachments.length > 0 ? { attachments } : {}),
          ...markOf(entry),
        },
      } as EventRecord);
    }
    return events;
  }, [conversationId, enabled, optimistic, persisted, queued]);
}
