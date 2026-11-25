import { useEffect, useMemo, useRef } from "react";
import { useScheduledEvents } from "@/features/chat/hooks/use-scheduled-events";
import type { EventRecord } from "@/features/chat/lib/event-transforms";
import { groupEventsIntoMessages } from "@/features/chat/lib/group-events-into-messages";
import { assistantOwnerId, placeInConversation } from "@/features/chat/lib/message-order";
import { scheduledEventAnchors } from "@/features/chat/lib/scheduled-event-anchors";
import {
  createLifecycleRoutingState,
  routeLifecycleEvents,
  type LifecycleRoutingState,
} from "@/features/chat/lib/route-lifecycle-events";
import type { MessageRecord } from "@stella/contracts/local-chat";

const SCHEDULED_EVENTS_OVERLAY_MAX = 200;

type UseConversationDisplayMessagesOptions = {
  conversationId: string | null;
  persistedMessages: MessageRecord[];
  optimisticEvents: EventRecord[];
};

const isUserTurnAssistant = (message: MessageRecord): boolean => {
  const payload = message.payload as
    | {
        metadata?: {
          runtime?: { responseTarget?: { type?: unknown } };
        };
      }
    | undefined;
  const targetType = payload?.metadata?.runtime?.responseTarget?.type;
  return targetType === undefined || targetType === "user_turn";
};

const keepAssistantTurnsContiguous = (
  messages: MessageRecord[],
): MessageRecord[] => {
  const userIndexById = new Map<string, number>();
  const nextUserIndexAfter = new Array<number | undefined>(messages.length);
  let nextUserIndex: number | undefined;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    nextUserIndexAfter[index] = nextUserIndex;
    const message = messages[index]!;
    if (message.type === "user_message") {
      userIndexById.set(message._id, index);
      nextUserIndex = index;
    }
  }

  const movedIds = new Set<string>();
  const insertBefore = new Map<number, MessageRecord[]>();
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;
    const anchorId = assistantOwnerId(message);
    if (!anchorId || !isUserTurnAssistant(message)) continue;
    const anchorIndex = userIndexById.get(anchorId);
    if (anchorIndex === undefined) continue;
    const boundaryIndex = nextUserIndexAfter[anchorIndex];
    if (boundaryIndex === undefined || index < boundaryIndex) continue;

    movedIds.add(message._id);
    const pending = insertBefore.get(boundaryIndex);
    if (pending) pending.push(message);
    else insertBefore.set(boundaryIndex, [message]);
  }

  if (movedIds.size === 0) return messages;

  const result: MessageRecord[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const pending = insertBefore.get(index);
    if (pending) result.push(...pending);
    const message = messages[index]!;
    if (!movedIds.has(message._id)) result.push(message);
  }
  return result;
};

const unrecordedOverlays = (
  persistedMessages: readonly MessageRecord[],
  overlayMessages: readonly MessageRecord[],
): MessageRecord[] => {
  const recordedIds = new Set<string>();
  for (const message of persistedMessages) {
    recordedIds.add(message._id);
    const origin =
      message.type === "user_message" ? message.payload?.originUserMessageId : undefined;
    if (typeof origin === "string") recordedIds.add(origin);
  }
  return overlayMessages.filter((message) => {
    if (recordedIds.has(message._id)) return false;
    recordedIds.add(message._id);
    return true;
  });
};

export const useConversationDisplayMessages = ({
  conversationId,
  persistedMessages,
  optimisticEvents,
}: UseConversationDisplayMessagesOptions): MessageRecord[] => {
  const scheduledEvents = useScheduledEvents({
    conversationId: conversationId ?? undefined,
    enabled: Boolean(conversationId),
    maxItems: SCHEDULED_EVENTS_OVERLAY_MAX,
  });

  const scheduledAnchors = useMemo(
    () =>
      conversationId && scheduledEvents.length > 0
        ? scheduledEventAnchors.resolve(conversationId, scheduledEvents, persistedMessages)
        : null,
    [conversationId, persistedMessages, scheduledEvents],
  );
  useEffect(() => {
    if (conversationId && scheduledAnchors) {
      scheduledEventAnchors.keep(conversationId, scheduledAnchors);
    }
  }, [conversationId, scheduledAnchors]);

  const overlayMessages = useMemo(() => {
    const overlayEvents: EventRecord[] = [];
    for (const event of scheduledEvents) {
      const sentAfterSequence = scheduledAnchors?.get(event._id);
      overlayEvents.push(
        sentAfterSequence === undefined
          ? event
          : { ...event, payload: { ...event.payload, sentAfterSequence } },
      );
    }
    overlayEvents.push(...optimisticEvents);
    return overlayEvents.length > 0 ? groupEventsIntoMessages(overlayEvents) : [];
  }, [optimisticEvents, scheduledAnchors, scheduledEvents]);

  const merged = useMemo(() => {
    const overlays = unrecordedOverlays(persistedMessages, overlayMessages);
    return keepAssistantTurnsContiguous(
      overlays.length > 0
        ? placeInConversation(persistedMessages, overlays)
        : persistedMessages,
    );
  }, [overlayMessages, persistedMessages]);

  const lifecycleRoutingRef = useRef<LifecycleRoutingState>(
    createLifecycleRoutingState(),
  );
  const routingConversationIdRef = useRef<string | null>(conversationId);
  if (routingConversationIdRef.current !== conversationId) {
    routingConversationIdRef.current = conversationId;
    lifecycleRoutingRef.current = createLifecycleRoutingState();
  }

  return useMemo(
    () => routeLifecycleEvents(merged, lifecycleRoutingRef.current),
    [merged],
  );
};
