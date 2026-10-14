import type { ChatMessage } from "../types";

const SETTLE_MS = 700;
const REPEAT_WINDOW_MS = 15_000;
const FIRST_PART_MIN = 12;
const FIRST_PART_MAX = 220;

export type QueuedReply = { id: string; text: string; source: string };

const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

export function splitForSpeech(id: string, text: string): QueuedReply[] {
  const source = normalize(text);
  const match = /^[\s\S]+?[.!?…](?=\s)/u.exec(text);
  const head = match?.[0].trim() ?? "";
  const tail = match ? text.slice(match[0].length).trim() : "";
  if (head.length < FIRST_PART_MIN || head.length > FIRST_PART_MAX || !tail) {
    return [{ id, text, source }];
  }
  return [
    { id: `${id}#1`, text: head, source },
    { id: `${id}#2`, text: tail, source },
  ];
}

export class ReplyQueue {
  accepting = true;
  private known = new Set<string>();
  private settling = new Map<string, { text: string; since: number }>();
  private spoken = new Map<string, number>();
  private queue: QueuedReply[] = [];

  isKnown(message: ChatMessage): boolean {
    return (
      this.known.has(message.id) ||
      (message.canonicalId !== undefined && this.known.has(message.canonicalId))
    );
  }

  markKnown(message: ChatMessage) {
    this.known.add(message.id);
    if (message.canonicalId) this.known.add(message.canonicalId);
    this.settling.delete(message.id);
  }

  markAllKnown(messages: readonly ChatMessage[]) {
    for (const message of messages) {
      if (message.role === "assistant" && message.text.trim()) this.markKnown(message);
    }
  }

  clear() {
    this.queue = [];
  }

  scan(messages: readonly ChatMessage[], turnRunning: boolean): number | null {
    const now = Date.now();
    let waiting = false;
    for (const message of messages) {
      if (message.role !== "assistant" || this.isKnown(message)) continue;
      const text = message.text.trim();
      if (!text) continue;
      if (!this.accepting) {
        this.markKnown(message);
        continue;
      }
      if (turnRunning) {
        const seen = this.settling.get(message.id);
        if (!seen || seen.text !== text) {
          this.settling.set(message.id, { text, since: now });
          waiting = true;
          continue;
        }
        if (now - seen.since < SETTLE_MS) {
          waiting = true;
          continue;
        }
      }
      this.markKnown(message);
      const source = normalize(text);
      const spokenAt = this.spoken.get(source);
      if (spokenAt !== undefined && now - spokenAt < REPEAT_WINDOW_MS) continue;
      if (this.queue.some((queued) => queued.source === source)) continue;
      this.queue.push(...splitForSpeech(message.id, text));
    }
    return waiting ? SETTLE_MS : null;
  }

  push(id: string, text: string) {
    this.queue.push(...splitForSpeech(id, text));
  }

  next(): QueuedReply | null {
    const reply = this.queue.shift() ?? null;
    if (reply) this.spoken.set(reply.source, Date.now());
    return reply;
  }

  peek(): QueuedReply | null {
    return this.queue[0] ?? null;
  }
}
