import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { resolveNativeHelperPath } from "../native-helper-path.js";
import { getFileLogger } from "@stella/node-shared/observability/file-logger";

const HELPER = "mic_capture";
const FRAME_HEADER_BYTES = 9;
const FRAME_AUDIO = 1;
const FRAME_EVENT = 2;
const RESPAWN_BACKOFF_MS = 5_000;
/** Audio held for a window that has not asked for it yet: one minute. */
const MAX_HELD_BYTES = 60 * 32_000;

export type CaptureEvent =
  | { event: "live" }
  | { event: "ended" }
  | { event: "failed"; message: string };

export type CaptureSink = {
  audio: (pcm: ArrayBuffer) => void;
  event: (event: CaptureEvent) => void;
};

type HelperChild = ChildProcessByStdio<Writable, Readable, null>;

type Capture = {
  id: string;
  generation: number;
  sink: CaptureSink | null;
  held: ArrayBuffer[];
  heldBytes: number;
  heldEvents: CaptureEvent[];
  closing: boolean;
  unclaimedTimer: ReturnType<typeof setTimeout> | null;
};

type HelperEvent = { event?: unknown; ms?: unknown; message?: unknown };

/**
 * Dictation's microphone on a Mac. The helper process runs with no device open
 * (the system's microphone indicator stays off) so that opening the microphone
 * costs only what the hardware needs. A capture can be opened before the window
 * that wants it is ready; what it hears meanwhile is held for that window.
 */
export class MicrophoneCapture {
  private child: HelperChild | null = null;
  private buffered: Buffer = Buffer.alloc(0);
  private generation = 0;
  private current: Capture | null = null;
  private retryAt = 0;
  private disposed = false;

  constructor(private readonly isAllowed: () => boolean) {}

  /** Starts the helper, without opening the microphone. */
  prepare(): boolean {
    return this.isAllowed() && this.ensureChild() !== null;
  }

  open(id: string, unclaimedMs: number): boolean {
    if (this.current?.id === id) return true;
    if (!this.isAllowed()) return false;
    const child = this.ensureChild();
    if (!child) return false;
    this.abandonCurrent("Another dictation started.");
    const capture: Capture = {
      id,
      generation: (this.generation += 1),
      sink: null,
      held: [],
      heldBytes: 0,
      heldEvents: [],
      closing: false,
      unclaimedTimer: setTimeout(() => this.discard(id), unclaimedMs),
    };
    this.current = capture;
    child.stdin.write(`start ${capture.generation}\n`);
    return true;
  }

  claim(id: string, sink: CaptureSink): boolean {
    const capture = this.current;
    if (!capture || capture.id !== id || capture.sink) return false;
    if (capture.unclaimedTimer) clearTimeout(capture.unclaimedTimer);
    capture.unclaimedTimer = null;
    capture.sink = sink;
    const events = capture.heldEvents.splice(0);
    const ended = events.filter((event) => event.event !== "live");
    if (events.length > ended.length) sink.event({ event: "live" });
    for (const pcm of capture.held.splice(0)) sink.audio(pcm);
    capture.heldBytes = 0;
    for (const event of ended) this.deliver(capture, event);
    return true;
  }

  /** Ends the capture; what was said up to now still arrives before "ended". */
  close(id: string): void {
    const capture = this.current;
    if (!capture || capture.id !== id || capture.closing) return;
    capture.closing = true;
    this.child?.stdin.write(`stop ${capture.generation}\n`);
  }

  discard(id: string): void {
    const capture = this.current;
    if (!capture || capture.id !== id) return;
    capture.sink = null;
    this.forget(capture);
    this.child?.stdin.write(`stop ${capture.generation}\n`);
  }

  dispose(): void {
    this.disposed = true;
    const child = this.child;
    this.child = null;
    child?.stdin.end();
    child?.kill();
  }

  private forget(capture: Capture): void {
    if (capture.unclaimedTimer) clearTimeout(capture.unclaimedTimer);
    capture.unclaimedTimer = null;
    capture.held = [];
    if (this.current === capture) this.current = null;
  }

  private abandonCurrent(message: string): void {
    const capture = this.current;
    if (!capture) return;
    this.forget(capture);
    capture.sink?.event({ event: "failed", message });
  }

  private deliver(capture: Capture, event: CaptureEvent): void {
    if (!capture.sink) {
      capture.heldEvents.push(event);
      return;
    }
    if (event.event !== "live") this.forget(capture);
    capture.sink.event(event);
  }

  private ensureChild(): HelperChild | null {
    if (this.child) return this.child;
    if (this.disposed || Date.now() < this.retryAt) return null;
    const helper = resolveNativeHelperPath(HELPER);
    if (!helper) return null;
    let child: HelperChild;
    try {
      child = spawn(helper, [], { stdio: ["pipe", "pipe", "ignore"] });
    } catch (error) {
      this.noteGone(null, (error as Error).message);
      return null;
    }
    this.child = child;
    this.buffered = Buffer.alloc(0);
    child.stdin.on("error", () => undefined);
    child.stdout.on("data", (chunk: Buffer) => this.onData(child, chunk));
    child.on("error", (error) => this.noteGone(child, error.message));
    child.on("exit", (code, signal) =>
      this.noteGone(child, `exited (${code ?? signal})`),
    );
    return child;
  }

  private noteGone(child: HelperChild | null, reason: string): void {
    if (child && this.child !== child) return;
    this.child = null;
    if (this.disposed) return;
    this.retryAt = Date.now() + RESPAWN_BACKOFF_MS;
    getFileLogger()?.process("native.mic-capture.gone", { reason });
    this.abandonCurrent("The microphone stopped.");
  }

  private onData(child: HelperChild, chunk: Buffer): void {
    if (this.child !== child) return;
    this.buffered =
      this.buffered.length === 0 ? chunk : Buffer.concat([this.buffered, chunk]);
    for (;;) {
      if (this.buffered.length < FRAME_HEADER_BYTES) return;
      const end = FRAME_HEADER_BYTES + this.buffered.readUInt32LE(0);
      if (this.buffered.length < end) return;
      const type = this.buffered[4];
      const generation = this.buffered.readUInt32LE(5);
      const payload = this.buffered.subarray(FRAME_HEADER_BYTES, end);
      this.buffered = this.buffered.subarray(end);
      const capture = this.current;
      if (!capture || capture.generation !== generation) continue;
      if (type === FRAME_AUDIO) this.onAudio(capture, payload);
      else if (type === FRAME_EVENT) this.onEvent(capture, payload);
    }
  }

  private onAudio(capture: Capture, payload: Buffer): void {
    const pcm = new Uint8Array(payload).buffer;
    if (capture.sink) {
      capture.sink.audio(pcm);
      return;
    }
    if (capture.heldBytes + pcm.byteLength > MAX_HELD_BYTES) return;
    capture.held.push(pcm);
    capture.heldBytes += pcm.byteLength;
  }

  private onEvent(capture: Capture, payload: Buffer): void {
    let event: HelperEvent;
    try {
      event = JSON.parse(payload.toString("utf8")) as HelperEvent;
    } catch {
      return;
    }
    if (event.event === "live") {
      getFileLogger()?.process("native.mic-capture.live", { ms: event.ms });
      this.deliver(capture, { event: "live" });
    } else if (event.event === "ended") {
      this.deliver(capture, { event: "ended" });
    } else if (event.event === "failed") {
      const message =
        typeof event.message === "string" ? event.message : "The microphone could not be opened.";
      getFileLogger()?.process("native.mic-capture.failed", { message });
      this.deliver(capture, { event: "failed", message });
    }
  }
}
