/**
 * Lossless, paced delivery of captured dictation audio to the realtime relay.
 *
 * Desktop and mobile start the microphone the moment the user presses it,
 * before the relay socket and Meta's realtime ASR session are ready, so the
 * first words are spoken into a session that does not exist yet. This queue
 * holds everything captured meanwhile, drops none of it, and releases it in
 * capture order once the provider's clock starts (its handshake
 * acknowledgment).
 *
 * Meta closes a session whose received audio runs too far ahead of that
 * clock ("Audio processing backlog too large"; a 10 s burst was accepted and
 * a 15 s burst refused against the live relay), so the queue never releases
 * more than `DICTATION_INGRESS_AHEAD_MS` ahead of it. A connect slower than
 * that only delays the transcript; every word still reaches the provider.
 *
 * Audio is 16 kHz mono signed 16-bit PCM.
 */

export const DICTATION_PCM_BYTES_PER_MS = 32;
export const DICTATION_INGRESS_AHEAD_MS = 4_000;
export const DICTATION_MAX_FRAME_BYTES = 1_000 * DICTATION_PCM_BYTES_PER_MS;
const DRAIN_INTERVAL_MS = 100;

const ownedBytes = (bytes: ArrayBuffer | ArrayBufferView): Uint8Array =>
  bytes instanceof ArrayBuffer
    ? new Uint8Array(bytes.slice(0))
    : new Uint8Array(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      );

const exactBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? (bytes.buffer as ArrayBuffer)
    : (bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer);

export class DictationIngressQueue {
  private queue: Uint8Array[] = [];
  private queuedBytes = 0;
  private sentBytes = 0;
  private clockStartedAt: number | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private waiters: (() => void)[] = [];
  private closed = false;

  constructor(
    private readonly sink: (bytes: ArrayBuffer) => void,
    private readonly now: () => number = Date.now,
    private readonly aheadMs: number = DICTATION_INGRESS_AHEAD_MS,
  ) {}

  get queuedMs(): number {
    return this.queuedBytes / DICTATION_PCM_BYTES_PER_MS;
  }

  get sentMs(): number {
    return this.sentBytes / DICTATION_PCM_BYTES_PER_MS;
  }

  get started(): boolean {
    return this.clockStartedAt !== null;
  }

  push(bytes: ArrayBuffer | ArrayBufferView): void {
    if (this.closed || bytes.byteLength === 0) return;
    this.queue.push(ownedBytes(bytes));
    this.queuedBytes += bytes.byteLength;
    this.drain();
  }

  start(at: number = this.now()): void {
    if (this.closed || this.clockStartedAt !== null) return;
    this.clockStartedAt = at;
    this.timer = setInterval(() => this.drain(), DRAIN_INTERVAL_MS);
    this.drain();
  }

  flushed(): Promise<void> {
    if (this.queuedBytes === 0 || this.closed) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  close(): void {
    this.closed = true;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    this.queue = [];
    this.queuedBytes = 0;
    this.settleWaiters();
  }

  drain(): void {
    if (this.closed || this.clockStartedAt === null) return;
    const elapsedMs = Math.max(0, this.now() - this.clockStartedAt);
    let budget =
      Math.floor((elapsedMs + this.aheadMs) * DICTATION_PCM_BYTES_PER_MS) -
      this.sentBytes;
    budget -= budget % 2;
    while (this.queue.length > 0 && budget > 0 && !this.closed) {
      const head = this.queue[0]!;
      const take = Math.min(head.byteLength, budget, DICTATION_MAX_FRAME_BYTES);
      const frame = take === head.byteLength ? head : head.subarray(0, take);
      if (take === head.byteLength) this.queue.shift();
      else this.queue[0] = head.subarray(take);
      this.queuedBytes -= take;
      this.sentBytes += take;
      budget -= take;
      this.sink(exactBuffer(frame));
    }
    if (this.queuedBytes === 0) this.settleWaiters();
  }

  private settleWaiters(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve();
  }
}
