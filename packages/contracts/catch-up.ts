/**
 * Catch-up: what a summary reads from a conversation, and when a client
 * offers one. The cloud builds the summary (`catchUps.request`); desktop and
 * mobile share the offer rule so both show the pill for the same stretch.
 */

import { messageText } from "./conversation-protocol.js";
import { splitMessageReplyRefs } from "./reply-refs.js";
import type { CatchUp } from "./backend/catch-ups.js";

/** One message a catch-up may read: the user's and Stella's, as shown. */
export type CatchUpSourceMessage = {
  seq: number;
  role: "user" | "assistant";
  text: string;
  at: number;
  messageIds: string[];
};

export type CatchUpSourceAgent = {
  title: string;
  startedAt: number;
};

/** What the conversation hands the summarizer. */
export type CatchUpSource = {
  messages: CatchUpSourceMessage[];
  running: CatchUpSourceAgent[];
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** The text the user saw for a prompt: its display text when it had one. */
const userText = (payload: Record<string, unknown>): string => {
  const display = asRecord(payload.metadata)?.displayText;
  return typeof display === "string" && display.trim()
    ? display.trim()
    : messageText(payload);
};

/**
 * The user's and Stella's visible messages among `records`, with the ids the
 * timelines give them (`journal-message-records.ts` on desktop,
 * `cloud-journal-projection.ts` on mobile).
 */
export const catchUpMessagesFromJournal = (
  records: ReadonlyArray<{
    kind: string;
    seq: number;
    turnId: string;
    createdAtMs: number;
    role?: string;
    hidden?: boolean;
    clientMsgId?: string;
    payload?: unknown;
  }>,
): CatchUpSourceMessage[] => {
  const messages: CatchUpSourceMessage[] = [];
  for (const record of records) {
    if (record.kind !== "message" || record.hidden) continue;
    const payload = asRecord(record.payload);
    if (!payload) continue;
    if (record.role === "user") {
      const text = userText(payload);
      if (!text) continue;
      const origin = payload.originUserMessageId;
      const ids = [
        typeof origin === "string" && origin.trim() ? origin.trim() : "",
        record.clientMsgId ?? "",
        `cloud:${record.turnId}:message:${record.seq}`,
      ].filter((id, index, all) => id && all.indexOf(id) === index);
      messages.push({ seq: record.seq, role: "user", text, at: record.createdAtMs, messageIds: ids });
    } else if (record.role === "assistant") {
      const { text } = splitMessageReplyRefs(payload);
      if (!text.trim()) continue;
      messages.push({
        seq: record.seq,
        role: "assistant",
        text: text.trim(),
        at: record.createdAtMs,
        messageIds: [`cloud:${record.turnId}:message:${record.seq}`],
      });
    }
  }
  return messages;
};

/** Stella's messages in this window, after the last catch-up, make a busy stretch. */
export const CATCH_UP_BUSY_MESSAGES = 6;
export const CATCH_UP_BUSY_WINDOW_MS = 20 * 60_000;
/** Opening the pill asks for a new summary only when at least this many of Stella's messages are new. */
export const CATCH_UP_MIN_NEW_MESSAGES = 3;
/** After a summary lands the pill stays this long, so it can be read again (on any device). */
export const CATCH_UP_LINGER_MS = 15 * 60_000;

/**
 * Whether to offer a catch-up, and over how many of Stella's messages: once
 * at least `CATCH_UP_BUSY_MESSAGES` of hers arrived within
 * `CATCH_UP_BUSY_WINDOW_MS` of each other since the newest catch-up, the
 * offer stands until a catch-up covers them, however quiet it got since.
 * `count` is Stella's messages no catch-up covers yet.
 */
export const catchUpOffer = (
  messages: ReadonlyArray<{ role: string; at: number }>,
  catchUps: readonly CatchUp[],
  now: number = Date.now(),
): {
  offer: boolean;
  count: number;
  /** Until when the newest summary keeps the pill up without an offer; 0 for none. */
  lingerUntil: number;
} => {
  let since = 0;
  let newestAt = 0;
  for (const catchUp of catchUps) {
    if (catchUp.state === "ready" && catchUp.throughAt !== undefined) {
      since = Math.max(since, catchUp.throughAt);
      newestAt = Math.max(newestAt, catchUp.createdAt);
    }
  }
  const lingerUntil = newestAt && newestAt + CATCH_UP_LINGER_MS > now ? newestAt + CATCH_UP_LINGER_MS : 0;
  const times = messages
    .filter((message) => message.role === "assistant" && message.at > since)
    .map((message) => message.at)
    .sort((a, b) => a - b);
  let busy = false;
  for (let end = CATCH_UP_BUSY_MESSAGES - 1; end < times.length && !busy; end += 1) {
    busy = times[end]! - times[end - CATCH_UP_BUSY_MESSAGES + 1]! <= CATCH_UP_BUSY_WINDOW_MS;
  }
  return { offer: busy, count: times.length, lingerUntil };
};
