import type { EventRecord, MessageRecord } from "@stella/contracts/local-chat";

export const replyFileEvents = (messages: readonly MessageRecord[]): EventRecord[] => {
  const events: EventRecord[] = [];
  for (const message of messages) {
    if (message.type !== "assistant_message") continue;
    const text = typeof message.payload?.text === "string" ? message.payload.text : "";
    if (!text.includes("](")) continue;
    events.push({ _id: message._id, timestamp: message.timestamp, type: "assistant_message", payload: { text } });
  }
  return events;
};

const LIFECYCLE_TYPES = new Set(["agent-started", "agent-completed", "agent-failed", "agent-canceled"]);

const eventKey = (event: EventRecord): string => {
  const agentId = event.payload?.agentId;
  return LIFECYCLE_TYPES.has(event.type) && typeof agentId === "string" ? `${event.type}\u0000${agentId}` : event._id;
};

export const mergeEvents = (...lists: readonly (readonly EventRecord[])[]): EventRecord[] => {
  const nonEmpty = lists.filter((list) => list.length > 0);
  if (nonEmpty.length === 1) return nonEmpty[0] as EventRecord[];
  const seen = new Set<string>();
  const merged: EventRecord[] = [];
  for (const list of nonEmpty) {
    for (const event of list) {
      const key = eventKey(event);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(event);
    }
  }
  return merged.sort((a, b) => a.timestamp - b.timestamp || (a._id < b._id ? -1 : a._id > b._id ? 1 : 0));
};
