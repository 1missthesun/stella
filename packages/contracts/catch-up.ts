import { messageText } from "./conversation-protocol.js";
import { splitMessageReplyRefs } from "./reply-refs.js";
import type { CatchUp, CatchUpItem } from "./backend/catch-ups.js";

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

export type CatchUpSource = {
  messages: CatchUpSourceMessage[];
  running: CatchUpSourceAgent[];
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const userText = (payload: Record<string, unknown>): string => {
  const display = asRecord(payload.metadata)?.displayText;
  return typeof display === "string" && display.trim()
    ? display.trim()
    : messageText(payload);
};

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

/**
 * The off switch for catch-up summaries (the composer's Summary pill). While
 * false no client shows the pill or reads summaries, and the cloud refuses
 * requests and drops queued jobs, so no model runs. Off pending a redesign.
 */
export const CATCH_UP_ENABLED: boolean = false;

export const CATCH_UP_BUSY_MESSAGES = 6;
export const CATCH_UP_BUSY_WINDOW_MS = 20 * 60_000;
export const CATCH_UP_MIN_NEW_MESSAGES = 3;
export const CATCH_UP_LINGER_MS = 15 * 60_000;

export const catchUpOffer = (
  messages: ReadonlyArray<{ role: string; at: number }>,
  catchUps: readonly CatchUp[],
  now: number = Date.now(),
): {
  offer: boolean;
  count: number;
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

export const CATCH_UP_TIME_GAP_MS = 30 * 60_000;

export type CatchUpRow =
  | { kind: "item"; item: CatchUpItem }
  | { kind: "time"; at: number };

export const catchUpRows = (items: readonly CatchUpItem[]): CatchUpRow[] => {
  let last = 0;
  const timed = items.map((item, index) => {
    const at = item.links[0]?.at ?? last;
    last = at;
    return { item, at, index };
  });
  timed.sort((a, b) => a.at - b.at || a.index - b.index);
  const rows: CatchUpRow[] = [];
  let previous: number | null = null;
  for (const { item, at } of timed) {
    if (previous !== null && previous > 0 && at - previous >= CATCH_UP_TIME_GAP_MS) {
      rows.push({ kind: "time", at });
    }
    rows.push({ kind: "item", item });
    previous = at;
  }
  return rows;
};
