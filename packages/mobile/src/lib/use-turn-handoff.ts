/**
 * The phone never runs a turn itself. Its placement waiter settles once the
 * turn is handed to the computer or the cloud that runs it, and that turn
 * shows as running here only when its `started` row reaches the journal. The
 * chat keeps working across that hand-off, until the turn shows as running,
 * a reply follows the message, its turn ends, or the hold runs out.
 */
import { useEffect, useRef, useState } from "react";
import type { JournalRecord } from "@stella/contracts/conversation-protocol";

const HANDOFF_HOLD_MS = 10_000;

type Handoff = {
  conversationId: string | null;
  messageId: string;
  started: boolean;
  releasedAt?: number;
};

const isMessage = (record: JournalRecord, messageId: string) =>
  record.kind === "message" &&
  record.role === "user" &&
  (record.clientMsgId === messageId ||
    record.payload.originUserMessageId === messageId);

const awaitingReply = (
  records: readonly JournalRecord[],
  messageId: string,
): boolean => {
  let turnId: string | null = null;
  for (const record of records) {
    if (turnId === null) {
      if (isMessage(record, messageId)) turnId = record.turnId;
      continue;
    }
    if (record.kind === "message" && record.role === "assistant" && !record.hidden) {
      return false;
    }
    if (record.kind === "turn" && record.turnId === turnId && record.phase !== "started") {
      return false;
    }
  }
  return turnId !== null;
};

export const useTurnHandoff = ({
  conversationId,
  sentMessageId,
  sending,
  turnRunning,
  records,
}: {
  conversationId: string | null;
  sentMessageId: string | null;
  sending: boolean;
  turnRunning: boolean;
  records: readonly JournalRecord[];
}): string | null => {
  const handoffRef = useRef<Handoff | null>(null);
  const [, setExpired] = useState(0);

  let handoff = handoffRef.current;
  if (handoff && handoff.conversationId !== conversationId) handoff = null;
  if (sending) {
    if (sentMessageId && handoff?.messageId !== sentMessageId) {
      handoff = { conversationId, messageId: sentMessageId, started: turnRunning };
    } else if (handoff && turnRunning && !handoff.started) {
      handoff = { ...handoff, started: true };
    }
  } else if (handoff && !handoff.started) {
    if (turnRunning) handoff = { ...handoff, started: true };
    else if (handoff.releasedAt === undefined) handoff = { ...handoff, releasedAt: Date.now() };
  }
  handoffRef.current = handoff;

  const releasedAt = handoff?.releasedAt;
  const holding =
    !sending &&
    !turnRunning &&
    handoff !== null &&
    !handoff.started &&
    releasedAt !== undefined &&
    Date.now() - releasedAt < HANDOFF_HOLD_MS &&
    awaitingReply(records, handoff.messageId);

  useEffect(() => {
    if (!holding || releasedAt === undefined) return;
    const timer = setTimeout(
      () => setExpired((count) => count + 1),
      Math.max(0, releasedAt + HANDOFF_HOLD_MS - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [holding, releasedAt]);

  return holding && handoff ? handoff.messageId : null;
};
