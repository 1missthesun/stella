// The phone's dictation microphone: the app's AVAudioEngine capture (ios/StellaRune/Mic.swift)
// behind desktop-ui's NativeCapture, so dictation-session records the same 16 kHz mono s16le
// frames it gets from the desktop's helper, and never reaches for the browser pipeline
// (AudioContext and worklets don't exist in JavaScriptCore).

import { onPhoneEvent, phonePost, phoneRequest, PhoneRequestError } from "../../../../../../../ui/native/app";

const DRAIN_TIMEOUT_MS = 500;

type NativeCaptureHandlers = {
  onAudio: (pcm: Int16Array) => void;
  onFailed: (message: string) => void;
};

type MicEvent = { gen: number; kind: "live" | "audio" | "ended" | "failed"; pcm?: string; message?: string };

let generation = 0;
const captures = new Map<number, NativeCapture>();
let subscribed = false;

const pcmOf = (b64: string): Int16Array => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Int16Array(bytes.buffer, 0, bytes.byteLength >> 1);
};

const subscribe = () => {
  if (subscribed) return;
  subscribed = true;
  onPhoneEvent<MicEvent>("mic", (e) => captures.get(e.gen)?.handle(e));
};

export const nativeMicrophoneSupported = (): boolean => true;

/** The app's microphone is always the one dictation uses, so nothing warms a browser pipeline. */
export const nativeMicrophoneReady = (): boolean => true;

export const reportDictationReady = async (_ready: boolean): Promise<void> => {};

/** iOS needs no pre-roll warm-up: AVAudioEngine starts within a frame of the tap. */
export const armNativeMicrophone = (_captureId: string): void => {};

export const discardNativeCapture = (_captureId: string): void => {};

export class NativeCapture {
  private settleDrain: (() => void) | null = null;
  private over = false;

  private constructor(
    private readonly gen: number,
    private readonly handlers: NativeCaptureHandlers,
  ) {}

  /** Starts the app's microphone; throws with the reason (no permission, no input) when it can't, which the composer shows. */
  static async open(_captureId: string, handlers: NativeCaptureHandlers): Promise<NativeCapture | null> {
    subscribe();
    const gen = (generation += 1);
    const capture = new NativeCapture(gen, handlers);
    captures.set(gen, capture);
    try {
      await phoneRequest("mic.start", { gen });
    } catch (error) {
      captures.delete(gen);
      if (error instanceof PhoneRequestError && error.code === "superseded") return null;
      throw error instanceof Error ? error : new Error(String(error));
    }
    if (capture.over) return null;
    return capture;
  }

  handle(e: MicEvent): void {
    if (this.over) return;
    if (e.kind === "audio" && e.pcm) {
      this.handlers.onAudio(pcmOf(e.pcm));
      return;
    }
    if (e.kind === "live") return;
    const expected = this.settleDrain !== null;
    this.finish();
    if (!expected) this.handlers.onFailed(e.message ?? "The microphone stopped.");
  }

  async drain(): Promise<void> {
    if (this.over) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => this.discard(), DRAIN_TIMEOUT_MS);
      this.settleDrain = () => {
        clearTimeout(timer);
        resolve();
      };
      phonePost({ cmd: "mic.stop", gen: this.gen });
    });
  }

  discard(): void {
    if (this.over) return;
    this.finish();
    phonePost({ cmd: "mic.stop", gen: this.gen });
  }

  private finish(): void {
    this.over = true;
    captures.delete(this.gen);
    this.settleDrain?.();
    this.settleDrain = null;
  }
}
