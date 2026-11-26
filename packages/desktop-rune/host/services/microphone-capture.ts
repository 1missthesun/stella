// Rune's dictation microphone (master: services/microphone-capture.ts). Master streams the mic
// through its macOS-only `mic_capture` helper; on Linux and Windows the engine captures the
// default input (engine/src/mic.rs) in the same format, so a dictation opens no WebView. macOS
// keeps master's helper.

import type { CaptureEvent, CaptureSink } from "../../../desktop/electron/services/microphone-capture";
import { engine, onEngine } from "../electron/engine";

const MAX_HELD_BYTES = 60 * 32_000;

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

type MicEvent = { gen: number; kind: "live" | "audio" | "ended" | "failed"; pcm?: string; message?: string };

const master = () =>
  require("../../../desktop/electron/services/microphone-capture.ts") as {
    __electron_MicrophoneCapture: new (isAllowed: () => boolean) => MicrophoneCapture;
  };

export class MicrophoneCapture {
  private generation = 0;
  private current: Capture | null = null;
  private listening = false;

  constructor(private readonly isAllowed: () => boolean) {
    if (process.platform === "darwin") return new (master().__electron_MicrophoneCapture)(isAllowed);
  }

  prepare(): boolean {
    return this.isAllowed() && engine() !== null;
  }

  open(id: string, unclaimedMs: number): boolean {
    if (this.current?.id === id) return true;
    const mic = engine()?.mic;
    if (!mic || !this.isAllowed()) return false;
    this.listen();
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
    mic.start(capture.generation);
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

  close(id: string): void {
    const capture = this.current;
    if (!capture || capture.id !== id || capture.closing) return;
    capture.closing = true;
    engine()?.mic.stop(capture.generation);
  }

  discard(id: string): void {
    const capture = this.current;
    if (!capture || capture.id !== id) return;
    capture.sink = null;
    this.forget(capture);
    engine()?.mic.stop(capture.generation);
  }

  dispose(): void {
    const capture = this.current;
    if (!capture) return;
    this.forget(capture);
    engine()?.mic.stop(capture.generation);
  }

  private listen(): void {
    if (this.listening) return;
    this.listening = true;
    onEngine("mic", (event) => this.onEvent(event));
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
    engine()?.mic.stop(capture.generation);
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

  private onEvent(event: MicEvent): void {
    const capture = this.current;
    if (!capture || capture.generation !== event.gen) return;
    if (event.kind === "audio" && event.pcm) this.onAudio(capture, Buffer.from(event.pcm, "base64"));
    else if (event.kind === "live" || event.kind === "ended") this.deliver(capture, { event: event.kind });
    else if (event.kind === "failed") this.deliver(capture, { event: "failed", message: event.message ?? "The microphone could not be opened." });
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
}
