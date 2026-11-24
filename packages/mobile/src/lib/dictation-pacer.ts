/**
 * Meta's realtime ASR runs a wall clock from the handshake and closes the
 * session (code 1008, "ingress audio slower than real-time") once the audio it
 * has received falls a cumulative ten seconds behind that clock.
 */

import {
  DICTATION_PCM_BYTES_PER_MS,
  DictationIngressQueue,
} from "@stella/contracts/dictation-ingress";
import type { DictationStream } from "./dictation-stream";

const TICK_MS = 250;
const STALLED_TICK_MS = 200;
const PAD_AFTER_MS = 1_000;
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
