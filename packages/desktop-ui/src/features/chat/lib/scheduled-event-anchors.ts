import type { EventRecord, MessageRecord } from "@stella/contracts/local-chat";
import { toServerTime } from "@stella/contracts/server-clock";
import { uiState } from "@/platform/ui-state";
import { newestSequence } from "./message-order";

const KEY_PREFIX = "stella.scheduledEventAnchors:";

const loadedWithConversation = new Map<string, ReadonlySet<string>>();

const read = (conversationId: string): Map<string, number> => {
  try {
    const stored: unknown = JSON.parse(uiState.getItem(KEY_PREFIX + conversationId) ?? "{}");
    return new Map(
      Object.entries(stored as Record<string, unknown>).filter(
        (entry): entry is [string, number] => Number.isSafeInteger(entry[1]),
      ),
    );
  } catch {
    return new Map();
  }
};

const sequenceAt = (rows: readonly MessageRecord[], at: number): number => {
  let after: number | undefined;
  let first: number | undefined;
  for (const row of rows) {
    if (row.sequence === undefined) continue;
    first = Math.min(first ?? row.sequence, row.sequence);
    if (row.timestamp <= at) after = Math.max(after ?? row.sequence, row.sequence);
  }
  return after ?? (first ?? 0) - 1;
};

export const scheduledEventAnchors = {
  resolve(
    conversationId: string,
    events: readonly EventRecord[],
    rows: readonly MessageRecord[],
  ): ReadonlyMap<string, number> {
    const newest = newestSequence(rows);
    const stored = read(conversationId);
    if (newest === undefined) return stored;
    let loaded = loadedWithConversation.get(conversationId);
    if (!loaded) {
      loaded = new Set(events.map((event) => event._id));
      loadedWithConversation.set(conversationId, loaded);
    }
    const anchors = new Map<string, number>();
    for (const event of events) {
      const known = stored.get(event._id);
      anchors.set(
        event._id,
        known ??
          (loaded.has(event._id) ? sequenceAt(rows, toServerTime(event.timestamp)) : newest),
      );
    }
    return anchors;
  },
  keep(conversationId: string, anchors: ReadonlyMap<string, number>): void {
    if (anchors.size === 0) return;
    uiState.setItem(KEY_PREFIX + conversationId, JSON.stringify(Object.fromEntries(anchors)));
  },
};
