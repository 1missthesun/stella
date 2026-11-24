import type { DictationCaptureEvent } from "@stella/contracts/desktop/ipc-contract";

const DRAIN_TIMEOUT_MS = 500;

type NativeCaptureHandlers = {
  onAudio: (pcm: Int16Array) => void;
  onFailed: (message: string) => void;
};

const api = () => window.electronAPI?.dictation;

const captures = new Map<string, NativeCapture>();
let subscribed = false;

const subscribe = (): boolean => {
  const dictation = api();
  if (!dictation?.onCaptureAudio || !dictation.onCaptureEvent) return false;
  if (subscribed) return true;
  subscribed = true;
  dictation.onCaptureAudio(({ captureId, pcm }) =>
    captures.get(captureId)?.handleAudio(pcm),
  );
  dictation.onCaptureEvent((event) =>
    captures.get(event.captureId)?.handleEvent(event),
  );
  return true;
};

/** A shortcut can have opened it for this window before the window is ready. */
export const nativeMicrophoneSupported = (): boolean =>
  window.electronAPI?.platform === "darwin";

let nativeReady = false;

/** Whether dictation here opens the microphone natively. */
export const nativeMicrophoneReady = (): boolean => nativeReady;

export const reportDictationReady = async (ready: boolean): Promise<void> => {
  const answer = await api()
    ?.captureReady?.({ ready })
    .catch(() => null);
  nativeReady = answer?.native === true && subscribe();
};

/**
 * Opens the microphone for a press that has not finished yet; a start with the
 * same id takes it over, and one that never comes lets it go.
 */
export const armNativeMicrophone = (captureId: string): void =>
  api()?.captureArm?.({ captureId });

export const discardNativeCapture = (captureId: string): void => {
  if (!captures.has(captureId)) api()?.captureClose?.({ captureId, discard: true });
};

export class NativeCapture {
  private settleDrain: (() => void) | null = null;
  private over = false;
  private opened = false;

  private constructor(
    private readonly id: string,
    private readonly handlers: NativeCaptureHandlers,
  ) {}

  /** Null when the microphone has to be opened by the browser instead. */
  static async open(
    captureId: string,
    handlers: NativeCaptureHandlers,
  ): Promise<NativeCapture | null> {
    const open = api()?.captureOpen;
    if (!open || !subscribe()) return null;
    const capture = new NativeCapture(captureId, handlers);
    captures.set(captureId, capture);
    const ok = await open({ captureId }).then(
      (answer) => answer.ok,
      () => false,
    );
    if (!ok) captures.delete(captureId);
    if (!ok || capture.over) return null;
    capture.opened = true;
    return capture;
  }

  handleAudio(pcm: ArrayBuffer): void {
    if (!this.over) this.handlers.onAudio(new Int16Array(pcm));
  }

  handleEvent(event: DictationCaptureEvent): void {
    if (this.over || event.event === "live") return;
    const expected = this.settleDrain !== null || !this.opened;
    this.finish();
    if (!expected) this.handlers.onFailed(event.message ?? "The microphone stopped.");
  }

  /** Resolves once everything said before this call has arrived. */
  async drain(): Promise<void> {
    if (this.over) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => this.discard(), DRAIN_TIMEOUT_MS);
      this.settleDrain = () => {
        clearTimeout(timer);
        resolve();
      };
      api()?.captureClose?.({ captureId: this.id });
    });
  }

  discard(): void {
    if (this.over) return;
    this.finish();
    api()?.captureClose?.({ captureId: this.id, discard: true });
  }

  private finish(): void {
    this.over = true;
    captures.delete(this.id);
    this.settleDrain?.();
    this.settleDrain = null;
  }
}
