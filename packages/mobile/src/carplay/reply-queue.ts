import type { ChatMessage } from "../types";

const SETTLE_MS = 700;
const REPEAT_WINDOW_MS = 3 * 60_000;

export type QueuedReply = { id: string; text: string };

const normalize = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * Decides which assistant messages the car speaks. Every message that arrives
 * while the queue is accepting is spoken once, in transcript order. While the
 * driver is talking the queue stops accepting, and anything that lands in that
 * window is dropped rather than read out after the send.
 */
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
    for (const message of messages) this.markKnown(message);
  }

  clear() {
    this.queue = [];
  }

  /**
   * Picks up newly arrived replies. While a turn is still running, a reply is
   * held until its text has stopped changing. Returns the delay after which
   * held replies should be scanned again, or null when nothing is held.
   */
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
      const key = normalize(text);
      const spokenAt = this.spoken.get(key);
      if (spokenAt !== undefined && now - spokenAt < REPEAT_WINDOW_MS) continue;
      if (this.queue.some((queued) => normalize(queued.text) === key)) continue;
      this.queue.push({ id: message.id, text });
    }
    return waiting ? SETTLE_MS : null;
  }

  push(reply: QueuedReply) {
    this.queue.push(reply);
  }

  next(): QueuedReply | null {
    const reply = this.queue.shift() ?? null;
    if (reply) this.spoken.set(normalize(reply.text), Date.now());
    return reply;
  }
}
