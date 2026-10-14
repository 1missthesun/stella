import { useEffect, useRef, useState } from "react";
import type { EventRecord } from "@stella/contracts/local-chat";

const HANDOFF_HOLD_MS = 10_000;

type Handoff = {
  conversationId: string | null;
  messageId: string;
  started: boolean;
  admittedAt?: number;
};

const latestSentMessageId = (events: readonly EventRecord[]): string | null => {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.type === "user_message") return event._id;
  }
  return null;
};

const isMessage = (record: EventRecord, messageId: string) =>
  record._id === messageId ||
  (record.payload as { originUserMessageId?: unknown } | undefined)?.originUserMessageId === messageId;

const awaitingReply = (records: readonly EventRecord[], messageId: string): boolean => {
  let found = false;
  for (const record of records) {
    if (!found) {
      found = isMessage(record, messageId);
      continue;
    }
    if (record.type === "assistant_message") return false;
  }
  return found;
};

export const useTurnHandoff = ({
  conversationId,
  optimisticEvents,
  persistedMessages,
  awaitingAdmission,
  turnRunning,
}: {
  conversationId: string | null;
  optimisticEvents: readonly EventRecord[];
  persistedMessages: readonly EventRecord[];
  awaitingAdmission: boolean;
  turnRunning: boolean;
}): boolean => {
  const handoffRef = useRef<Handoff | null>(null);
  const [, setExpired] = useState(0);

  let handoff = handoffRef.current;
  if (handoff && handoff.conversationId !== conversationId) handoff = null;
  if (awaitingAdmission) {
    const messageId = latestSentMessageId(optimisticEvents);
    if (messageId && handoff?.messageId !== messageId) {
      handoff = { conversationId, messageId, started: turnRunning };
    } else if (handoff && turnRunning && !handoff.started) {
      handoff = { ...handoff, started: true };
    }
  } else if (handoff && !handoff.started) {
    if (turnRunning) handoff = { ...handoff, started: true };
    else if (handoff.admittedAt === undefined) handoff = { ...handoff, admittedAt: Date.now() };
  }
  handoffRef.current = handoff;

  const admittedAt = handoff?.admittedAt;
  const holding =
    !awaitingAdmission &&
    !turnRunning &&
    handoff !== null &&
    !handoff.started &&
    admittedAt !== undefined &&
    Date.now() - admittedAt < HANDOFF_HOLD_MS &&
    awaitingReply(persistedMessages, handoff.messageId);

  useEffect(() => {
    if (!holding || admittedAt === undefined) return;
    const timer = setTimeout(
      () => setExpired((count) => count + 1),
      Math.max(0, admittedAt + HANDOFF_HOLD_MS - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [holding, admittedAt]);

  return holding;
};
