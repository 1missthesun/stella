/**
 * Keeps dictation audio ingress at real time, without losing any of it.
 *
 * The microphone starts on the press, before the relay and Meta's realtime
 * ASR are connected. Everything captured meanwhile waits in a lossless
 * `DictationIngressQueue` and is released in order once the provider
 * acknowledges its handshake, never far enough ahead of its clock to trip
 * its backlog limit.
 *
 * Meta's realtime ASR runs a wall clock from the handshake and closes the
 * session (code 1008, "ingress audio slower than real-time") once the audio it
 * has received falls a cumulative ten seconds behind that clock. The phone
 * only ever hands us what the microphone captured, so any gap in capture
 * (audio-session interruption, route change, a brief suspension) becomes
 * permanent lateness that eventually ends the session mid-sentence.
 *
 * The pacer accounts for the audio it forwards and, from a timer, fills any
 * lateness beyond a small tolerance with silence. Silence is only sent when
 * the timer fires on schedule and nothing captured is still waiting: a late
 * timer means the JS thread was blocked, and the recorder's queued buffers are
 * about to catch the stream up on their own. Padding on top of those would
 * push the session past the backlog limit instead.
 */

import {
  DICTATION_PCM_BYTES_PER_MS,
  DictationIngressQueue,
} from "@stella/contracts/dictation-ingress";
import type { DictationStream } from "./dictation-stream";

const TICK_MS = 250;
/** A tick this late means the JS thread stalled; queued audio will follow. */
const STALLED_TICK_MS = 200;
/** Lateness we tolerate before sending silence. */
const PAD_AFTER_MS = 1_000;
/** Lateness left in place so an in-flight recorder chunk cannot overshoot. */
const PAD_KEEP_MS = 250;
const MAX_PAD_MS = 1_000;

export class DictationIngressPacer {
  private readonly queue: DictationIngressQueue;
  private timer: ReturnType<typeof setInterval> | null = null;
  private expectedTickAt = 0;
  private startedAt = 0;
  private stopped = false;

  constructor(
    stream: Pick<DictationStream, "send">,
    private readonly now: () => number = Date.now,
  ) {
    this.queue = new DictationIngressQueue((bytes) => stream.send(bytes), now);
  }

  get queuedMs(): number {
    return this.queue.queuedMs;
  }

  get sentMs(): number {
    return this.queue.sentMs;
  }

  send(bytes: ArrayBuffer): void {
    this.queue.push(bytes);
  }

  start(startedAt: number = this.now()): void {
    if (this.stopped || this.timer !== null) return;
    this.startedAt = startedAt;
    this.queue.start(startedAt);
    this.expectedTickAt = this.now() + TICK_MS;
    this.timer = setInterval(this.tick, TICK_MS);
  }

  stopPadding(): void {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }

  flushed(): Promise<void> {
    return this.queue.flushed();
  }

  stop(): void {
    this.stopped = true;
    this.stopPadding();
    this.queue.close();
  }

  private readonly tick = (): void => {
    const now = this.now();
    const lateness = now - this.expectedTickAt;
    this.expectedTickAt = now + TICK_MS;
    if (lateness > STALLED_TICK_MS) return;
    this.queue.drain();
    if (this.queue.queuedMs > 0) return;
    const deficitMs = now - this.startedAt - this.queue.sentMs;
    if (deficitMs < PAD_AFTER_MS) return;
    const padMs = Math.min(MAX_PAD_MS, deficitMs - PAD_KEEP_MS);
    this.queue.push(
      new ArrayBuffer(Math.floor(padMs) * DICTATION_PCM_BYTES_PER_MS),
    );
  };
}
