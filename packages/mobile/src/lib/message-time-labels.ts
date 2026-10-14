import type { ChatMessage } from "../types";

export const TIMESTAMP_GAP_MS = 60 * 60_000;

const DAY_MS = 24 * 60 * 60_000;

const startOfDay = (ms: number): number => {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

const timeOfDay = (ms: number): string =>
  new Date(ms).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

const daysAgo = (ms: number, now: number): number =>
  Math.round((startOfDay(now) - startOfDay(ms)) / DAY_MS);

export function formatTimestampHeader(ms: number, now = Date.now()): string {
  const days = daysAgo(ms, now);
  const time = timeOfDay(ms);
  if (days <= 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  const date = new Date(ms);
  if (days < 7) {
    return `${date.toLocaleDateString(undefined, { weekday: "long" })} ${time}`;
  }
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  const day = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  return `${day} at ${time}`;
}

export function timestampHeaders(
  messages: readonly ChatMessage[],
): Map<string, number> {
  const headers = new Map<string, number>();
  let previous: number | null = null;
  for (const message of messages) {
    const at = message.createdAt;
    if (typeof at !== "number" || !Number.isFinite(at)) continue;
    if (previous === null || at - previous >= TIMESTAMP_GAP_MS) {
      headers.set(message.id, at);
    }
    previous = at;
  }
  return headers;
}

const readAt = (message: ChatMessage): number | null => {
  if (!message.sentWhileBusy) return null;
  if (message.queued) return null;
  if (message.sequence === undefined && !message.canonicalId) return null;
  return message.canonicalCreatedAt ?? message.createdAt ?? null;
};

const showsContent = (message: ChatMessage): boolean =>
  message.text.trim().length > 0 || (message.artifacts?.length ?? 0) > 0;

export function readReceipt(
  messages: readonly ChatMessage[],
  now = Date.now(),
): { id: string; label: string } | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (message.role === "assistant") {
      if (showsContent(message)) return null;
      continue;
    }
    const at = readAt(message);
    if (at === null) return null;
    const days = daysAgo(at, now);
    const when =
      days <= 0
        ? timeOfDay(at)
        : days === 1
          ? "Yesterday"
          : new Date(at).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            });
    return { id: message.id, label: `Read ${when}` };
  }
  return null;
}
