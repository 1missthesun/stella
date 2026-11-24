import { DictationIngressQueue } from "@stella/contracts/dictation-ingress";
import { createDictationLevelMeter } from "@stella/contracts/dictation-waveform";
import { uiState } from "@/platform/ui-state";
import {
  acquireSharedMicrophone,
  setSharedMicrophoneKeepWarm,
  type SharedMicrophoneLease,
} from "@/features/voice/services/shared-microphone";
import { DictationRefusedError, DictationStream } from "./dictation-stream";
import { transcribeDictation, type DictationRoute } from "./dictation-transcriber";
import {
  NativeCapture,
  nativeMicrophoneReady,
  nativeMicrophoneSupported,
} from "./native-microphone";
import { onDeviceDictationAvailable, OnDeviceDictationStream } from "./on-device-dictation";
import { PcmRecording } from "./pcm-recording";

type WorkletFrame = { pcm: Int16Array; rms: number };

const TARGET_SAMPLE_RATE = 16_000;
const PCM_WORKLET_NAME = "stella-dictation-pcm-capture";
const PCM_WORKLET_FILE = "dictation-pcm-worklet.js";
const DICTATION_SUPER_FAST_KEY = "stella-dictation-super-fast";
const MAX_DICTATION_DURATION_MS = 15 * 60 * 1000;

const PRE_ROLL_MS = 300;
const WARM_CONTEXT_IDLE_MS = 60_000;
const ARMED_PRE_ROLL_MS = 1_500;
// How far behind the voice the browser's microphone pipeline runs.
const BROWSER_DRAIN_MS = 120;
const LIVE_TIMEOUT_MS = 10_000;
// The browser pads a microphone that is still starting with zeros, but a quiet
// headset that gates its noise delivers nothing else.
const SILENT_LIVE_SAMPLES = 0.3 * TARGET_SAMPLE_RATE;
// macOS hands a process it denies the microphone nothing but zeros.
const NATIVE_SILENT_SAMPLES = 1.5 * TARGET_SAMPLE_RATE;

export const resolveDictationPcmWorkletUrl = (rendererHref: string): string =>
  new URL(PCM_WORKLET_FILE, rendererHref).href;

export type DictationSessionState =
  | "idle"
  | "starting"
  | "listening"
  | "transcribing"
  | "error";

type CaptureHandle = {
  /** Resolves once everything said before this call has been delivered. */
  drain: () => Promise<void>;
  release: () => void;
};

const wait = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

const rmsOf = (pcm: Int16Array): number => {
  let sum = 0;
  for (let i = 0; i < pcm.length; i += 1) sum += pcm[i]! * pcm[i]!;
  return pcm.length === 0 ? 0 : Math.sqrt(sum / pcm.length) / 0x8000;
};

// The native capture has no noise suppression, so the room would move the
// waveform. Fixed rather than adaptive: steady noise must never read as a voice.
const NATIVE_ROOM_RMS = 0.02;

const aboveRoomNoise = (rms: number): number =>
  Math.sqrt(Math.max(0, rms * rms - NATIVE_ROOM_RMS * NATIVE_ROOM_RMS));

type DictationCallbacks = {
  /** Nothing here can transcribe: the user has to add a key or sign in. */
  onNeedsKey?: () => void;
  onFinalTranscript?: (text: string) => void;
  onStateChange?: (state: DictationSessionState, error?: string) => void;
};

export function isDictationSuperFastEnabled(): boolean {
  return uiState.getItem(DICTATION_SUPER_FAST_KEY) === "true";
}

export function setDictationSuperFastPreference(enabled: boolean): void {
  uiState.setItem(DICTATION_SUPER_FAST_KEY, enabled ? "true" : "false");
}

class DictationWarmCapture {
  private micLease: SharedMicrophoneLease | null = null;
  private audioContext: AudioContext | null = null;
  private moduleReady: Promise<void> | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private chunks: Int16Array[] = [];
  private totalSamples = 0;
  private startPromise: Promise<void> | null = null;
  private listener: ((frame: WorkletFrame) => void) | null = null;
  private pinned = false;
  private armedTimer: ReturnType<typeof setTimeout> | null = null;
  timings: Record<string, number> = {};
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  async start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startInner().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  async pin(enabled: boolean): Promise<void> {
    this.pinned = enabled;
    if (enabled) {
      this.clearIdle();
      await this.start();
    } else {
      await this.stop();
    }
  }

  warmForIntent(): void {
    if (this.listener || this.micLease) return;
    try {
      this.prepare();
    } catch {
      return;
    }
    this.scheduleIdleClose();
  }

  /** Opens the microphone for a press in progress; see `disarm`. */
  arm(): void {
    if (this.listener || this.pinned || this.armedTimer) return;
    this.clearIdle();
    this.armedTimer = setTimeout(() => this.disarm(), ARMED_PRE_ROLL_MS);
    void this.start().catch(() => undefined);
  }

  disarm(): void {
    if (!this.armedTimer) return;
    clearTimeout(this.armedTimer);
    this.armedTimer = null;
    void this.stop();
  }

  async attach(listener: (frame: WorkletFrame) => void): Promise<Int16Array[]> {
    this.clearIdle();
    if (this.armedTimer) clearTimeout(this.armedTimer);
    this.armedTimer = null;
    this.listener = listener;
    const preRoll = this.chunks;
    this.chunks = [];
    this.totalSamples = 0;
    try {
      await this.start();
    } catch (error) {
      this.detach(listener);
      throw error;
    }
    return preRoll;
  }

  detach(listener: (frame: WorkletFrame) => void): void {
    if (this.listener !== listener) return;
    this.listener = null;
    void this.stop();
  }

  async stop(): Promise<void> {
    const starting = this.startPromise;
    if (starting) await starting.catch(() => undefined);
    if (this.listener || this.pinned || this.armedTimer || this.startPromise) return;
    this.tearDownAudioPipeline();
    const lease = this.micLease;
    this.micLease = null;
    this.chunks = [];
    this.totalSamples = 0;
    lease?.release({ immediate: true });
    this.scheduleIdleClose();
  }

  private prepare(): { context: AudioContext; moduleReady: Promise<void> } {
    if (this.audioContext && this.moduleReady && this.audioContext.state !== "closed") {
      return { context: this.audioContext, moduleReady: this.moduleReady };
    }
    const t0 = performance.now();
    const context = new AudioContext({ latencyHint: "interactive" });
    this.timings.context = performance.now() - t0;
    const moduleReady = context.audioWorklet
      .addModule(resolveDictationPcmWorkletUrl(window.location.href))
      .then(
        () => {
          this.timings.worklet = performance.now() - t0;
        },
        (error: unknown) => {
          if (this.audioContext === context) this.closeContext();
          throw error;
        },
      );
    void moduleReady.catch(() => undefined);
    this.audioContext = context;
    this.moduleReady = moduleReady;
    return { context, moduleReady };
  }

  private closeContext(): void {
    const context = this.audioContext;
    this.audioContext = null;
    this.moduleReady = null;
    void context?.close().catch(() => undefined);
  }

  private scheduleIdleClose(): void {
    this.clearIdle();
    if (this.pinned || this.listener || this.micLease) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.pinned || this.listener || this.micLease || this.startPromise) return;
      this.closeContext();
    }, WARM_CONTEXT_IDLE_MS);
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private async startInner(): Promise<void> {
    if (this.audioContext && this.micLease) return;
    this.timings = {};
    const t0 = performance.now();
    const { context: ctx, moduleReady } = this.prepare();
    let lease: SharedMicrophoneLease;
    try {
      [lease] = await Promise.all([
        acquireSharedMicrophone().then((value) => {
          this.timings.getUserMedia = performance.now() - t0;
          return value;
        }),
        moduleReady,
        ctx.state === "suspended" ? ctx.resume() : Promise.resolve(),
      ]);
    } catch (error) {
      if (this.audioContext === ctx) this.closeContext();
      throw error;
    }
    if (this.audioContext !== ctx) {
      lease.release({ immediate: true });
      throw new Error("Dictation audio was released while starting.");
    }
    this.micLease = lease;

    const source = ctx.createMediaStreamSource(lease.stream);
    this.sourceNode = source;
    const worklet = new AudioWorkletNode(ctx, PCM_WORKLET_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
    });
    worklet.port.onmessage = (event: MessageEvent<WorkletFrame>) => {
      const frame = event.data;
      if (!frame?.pcm?.length) return;
      if (this.listener) this.listener(frame);
      else this.append(frame.pcm);
    };
    this.workletNode = worklet;
    source.connect(worklet);
  }

  private append(chunk: Int16Array): void {
    this.chunks.push(chunk);
    this.totalSamples += chunk.length;
    const keepMs = this.armedTimer ? ARMED_PRE_ROLL_MS : PRE_ROLL_MS;
    const maxSamples = Math.round((keepMs / 1000) * TARGET_SAMPLE_RATE);
    while (this.totalSamples > maxSamples && this.chunks.length > 0) {
      const first = this.chunks[0]!;
      if (this.totalSamples - first.length >= maxSamples) {
        this.chunks.shift();
        this.totalSamples -= first.length;
        continue;
      }
      const trim = this.totalSamples - maxSamples;
      this.chunks[0] = first.slice(trim);
      this.totalSamples -= trim;
      break;
    }
  }

  private tearDownAudioPipeline(): void {
    if (this.workletNode) {
      try {
        this.workletNode.port.onmessage = null;
        this.workletNode.port.close();
        this.workletNode.disconnect();
      } catch {
        // The node may already be gone with its context.
      }
      this.workletNode = null;
    }
    if (this.sourceNode) {
      try {
        this.sourceNode.disconnect();
      } catch {
        // Already disconnected.
      }
      this.sourceNode = null;
    }
  }
}

const warmCapture = new DictationWarmCapture();

export async function setDictationSuperFastModeEnabled(
  enabled: boolean,
): Promise<void> {
  setDictationSuperFastPreference(enabled);
  await setSharedMicrophoneKeepWarm(enabled);
  await warmCapture.pin(enabled);
}

export async function ensureDictationSuperFastWarm(): Promise<void> {
  if (!isDictationSuperFastEnabled()) return;
  await setDictationSuperFastModeEnabled(true);
}

export function warmDictationAudio(): void {
  if (!nativeMicrophoneReady()) warmCapture.warmForIntent();
}

export function armBrowserMicrophone(): void {
  warmCapture.arm();
}

export function disarmBrowserMicrophone(): void {
  warmCapture.disarm();
}

export class DictationSession {
  private state: DictationSessionState = "idle";
  private capture: CaptureHandle | null = null;
  private live: Promise<void> = Promise.resolve();
  private markLive: () => void = () => undefined;
  private heard = false;
  private silentSamples = 0;
  private routed: Promise<void> = Promise.resolve();
  private unrouted: Int16Array[] | null = null;
  private needsKey = false;
  private callbacks: DictationCallbacks = {};
  private recording = new PcmRecording();
  private transcription: AbortController | null = null;
  private streaming = false;
  private onDevice: OnDeviceDictationStream | null = null;
  private onDeviceOpened: Promise<void> = Promise.resolve();
  private onDeviceFallback: Promise<boolean> = Promise.resolve(false);
  private stream: DictationStream | null = null;
  private streamOpened: Promise<void> = Promise.resolve();
  private streamFailure: Error | null = null;
  private ingress: DictationIngressQueue | null = null;
  private durationLimitTimer: ReturnType<typeof setTimeout> | null = null;
  private cancelled = false;
  private stopRequested = false;
  private readonly meter = createDictationLevelMeter();
  private pressedAt = 0;
  private marks: Record<string, number> = {};

  isActive(): boolean {
    return (
      this.state === "starting" ||
      this.state === "listening" ||
      this.state === "transcribing"
    );
  }

  async start(
    callbacks: DictationCallbacks,
    options: { route: Promise<DictationRoute>; captureId: string },
  ): Promise<void> {
    if (this.isActive()) return;
    this.pressedAt = performance.now();
    this.marks = {};
    this.callbacks = callbacks;
    this.cancelled = false;
    this.stopRequested = false;
    this.needsKey = false;
    this.heard = false;
    this.silentSamples = 0;
    this.streaming = false;
    this.recording = new PcmRecording();
    this.unrouted = [];
    this.meter.reset();
    this.resetStream();
    this.resetOnDevice();
    this.live = new Promise((resolve) => {
      this.markLive = resolve;
    });
    this.setState("starting");
    this.routed = options.route
      .catch(() => "needs-key" as const)
      .then((route) => this.applyRoute(route));

    try {
      this.capture = await this.openCapture(options.captureId);
    } catch (err) {
      if (this.cancelled) {
        await this.cleanup();
        this.settleCancelled();
        return;
      }
      console.error("[dictation] failed to acquire microphone:", err);
      this.setState("error", (err as Error).message);
      await this.cleanup();
      throw err;
    }

    try {
      await Promise.race([this.live, wait(LIVE_TIMEOUT_MS)]);
      if (this.cancelled || this.needsKey) {
        await this.cleanup();
        this.settleCancelled();
        return;
      }
      if (!this.heard && !this.stopRequested) {
        throw new Error("The microphone is not delivering any sound.");
      }
      if (
        this.streamFailure &&
        (this.onDevice ||
          (this.streamFailure instanceof DictationRefusedError &&
            !(await this.onDeviceFallback)))
      ) {
        throw this.streamFailure;
      }
      this.durationLimitTimer = setTimeout(() => {
        console.warn("[dictation] hit max segment duration, auto-stopping");
        void this.stop();
      }, MAX_DICTATION_DURATION_MS);
      this.setState("listening");
    } catch (err) {
      console.error("[dictation] failed to start dictation:", err);
      this.setState("error", (err as Error).message);
      await this.cleanup();
      throw err;
    }
    if (this.stopRequested) await this.stop();
  }

  async stop(): Promise<void> {
    if (this.state === "starting") {
      this.stopRequested = true;
      this.markLive();
      return;
    }
    if (this.state !== "listening") return;

    if (this.durationLimitTimer) {
      clearTimeout(this.durationLimitTimer);
      this.durationLimitTimer = null;
    }
    if (this.cancelled) {
      await this.cleanup();
      this.settleCancelled();
      return;
    }
    const controller = new AbortController();
    this.transcription = controller;
    this.setState("transcribing");
    const capture = this.capture;
    this.capture = null;
    await capture?.drain();
    capture?.release();
    this.meter.reset();
    await this.routed;

    const recording = this.recording;
    this.recording = new PcmRecording();
    if (this.cancelled || this.needsKey || recording.sampleCount === 0) {
      this.stream?.cancel();
      this.resetStream();
      this.onDevice?.cancel();
      this.resetOnDevice();
      this.settleCancelled();
      return;
    }

    try {
      const transcript = this.onDevice
        ? await this.finishOnDevice()
        : this.streaming
          ? await this.finishStreamed(recording, controller.signal)
          : await transcribeDictation(recording.toWav(), controller.signal);
      if (this.cancelled || !transcript) {
        this.settleCancelled();
        return;
      }
      this.callbacks.onFinalTranscript?.(transcript);
      this.setState("idle");
    } catch (err) {
      if (this.cancelled) {
        this.settleCancelled();
        return;
      }
      console.error("[dictation] transcription failed:", err);
      this.setState("error", (err as Error).message);
    } finally {
      if (this.transcription === controller) this.transcription = null;
    }
  }

  async cancel(): Promise<void> {
    this.cancelled = true;
    this.stream?.cancel();
    this.onDevice?.cancel();
    if (this.state === "transcribing") {
      this.transcription?.abort();
      this.releaseCapture();
      this.setState("idle");
      this.callbacks = {};
      return;
    }
    if (this.state === "starting") {
      this.markLive();
      return;
    }
    if (this.state === "idle") {
      this.releaseCapture();
      return;
    }
    await this.stop();
  }

  private settleCancelled(): void {
    this.setState("idle");
    if (this.needsKey && !this.cancelled) this.callbacks.onNeedsKey?.();
  }

  private async openCapture(captureId: string): Promise<CaptureHandle> {
    if (nativeMicrophoneSupported()) {
      let native: NativeCapture | null = null;
      native = await NativeCapture.open(captureId, {
        onAudio: (pcm) => {
          this.onFrame({ pcm, rms: aboveRoomNoise(rmsOf(pcm)) }, true);
          if (native && !this.heard && this.silentSamples >= NATIVE_SILENT_SAMPLES) {
            native.discard();
            void this.onNativeFailed("It delivered only silence.");
          }
        },
        onFailed: (message) => void this.onNativeFailed(message),
      });
      if (native) {
        const opened = native;
        return {
          drain: () => opened.drain(),
          release: () => opened.discard(),
        };
      }
    }
    return await this.openBrowserCapture();
  }

  private async openBrowserCapture(): Promise<CaptureHandle> {
    const listener = (frame: WorkletFrame) => this.onFrame(frame);
    const preRoll = await warmCapture.attach(listener);
    for (const pcm of preRoll) this.onFrame({ pcm, rms: rmsOf(pcm) });
    return {
      drain: () => wait(BROWSER_DRAIN_MS),
      release: () => warmCapture.detach(listener),
    };
  }

  /** Before it was live the browser gets a try; after, what was said is kept. */
  private async onNativeFailed(message: string): Promise<void> {
    console.warn("[dictation] native microphone failed:", message);
    if (this.heard) {
      void this.stop();
      return;
    }
    if (this.state !== "starting" || this.cancelled) return;
    this.silentSamples = 0;
    try {
      const browser = await this.openBrowserCapture();
      if (this.state === "starting" || this.state === "listening") this.capture = browser;
      else browser.release();
    } catch (error) {
      console.error("[dictation] failed to acquire microphone:", error);
      this.markLive();
    }
  }

  private applyRoute(route: DictationRoute): void {
    const held = this.unrouted ?? [];
    this.unrouted = null;
    if (this.cancelled) return;
    if (route === "needs-key") {
      this.needsKey = true;
      this.markLive();
      if (this.state === "listening") void this.cleanup().then(() => this.settleCancelled());
      return;
    }
    if (route === "on-device") {
      this.openOnDevice();
    } else if (route === "streaming") {
      this.streaming = true;
      this.openStream();
      this.onDeviceFallback = onDeviceDictationAvailable().catch(() => false);
    }
    for (const pcm of held) this.forward(pcm);
  }

  private onFrame(frame: WorkletFrame, native = false): void {
    if (import.meta.env.DEV && this.marks.firstFrame === undefined) {
      this.marks.firstFrame = performance.now() - this.pressedAt;
      const marks = this.marks;
      setTimeout(() => {
        console.info(
          `[dictation] timing ${JSON.stringify({ ...warmCapture.timings, ...marks })}`,
        );
      }, 1500);
    }
    this.meter.pushRms(frame.rms, (frame.pcm.length * 1000) / TARGET_SAMPLE_RATE);
    this.record(frame.pcm);
    if (!this.heard) {
      this.silentSamples += frame.pcm.length;
      this.heard =
        (!native && this.silentSamples >= SILENT_LIVE_SAMPLES) ||
        frame.pcm.some((sample) => sample !== 0);
      if (this.heard) this.markLive();
    }
    if (this.recording.full && this.state === "listening") {
      console.warn("[dictation] hit max recording length, auto-stopping");
      void this.stop();
    }
  }

  private releaseCapture(): void {
    this.capture?.release();
    this.capture = null;
  }

  private resetStream(): void {
    this.ingress?.close();
    this.ingress = null;
    this.stream = null;
    this.streamOpened = Promise.resolve();
    this.streamFailure = null;
  }

  private openStream(): void {
    const stream = new DictationStream(
      (error) => {
        if (this.stream !== stream) return;
        this.streamFailure = error;
        if (this.state === "listening" && !this.cancelled) {
          void this.failWhileListening(error);
        }
      },
    );
    this.stream = stream;
    const ingress = new DictationIngressQueue((bytes) => stream.send(bytes));
    this.ingress = ingress;
    this.streamOpened = stream.open().then(
      () => {
        this.marks.socket = performance.now() - this.pressedAt;
        if (this.stream !== stream || this.streamFailure) return;
        ingress.start();
      },
      (error: unknown) => {
        if (this.stream !== stream) return;
        const failure =
          error instanceof Error ? error : new Error(String(error));
        this.streamFailure = failure;
        if (this.state === "listening" && !this.cancelled) {
          void this.failWhileListening(failure);
        }
      },
    );
  }

  private async failWhileListening(error: Error): Promise<void> {
    const recordingIsEnough =
      !this.onDevice &&
      (!(error instanceof DictationRefusedError) || (await this.onDeviceFallback));
    if (recordingIsEnough) {
      console.warn("[dictation] relay failed; the recording will be transcribed instead:", error.message);
      return;
    }
    console.error("[dictation] relay failed while recording:", error);
    await this.cleanup();
    this.setState("error", error.message);
  }

  private record(pcm: Int16Array): void {
    this.recording.append(pcm);
    if (this.unrouted) this.unrouted.push(pcm);
    else this.forward(pcm);
  }

  private forward(pcm: Int16Array): void {
    if (this.onDevice) this.onDevice.send(pcm);
    else if (this.streaming) this.ingress?.push(pcm);
  }

  private resetOnDevice(): void {
    this.onDevice = null;
    this.onDeviceOpened = Promise.resolve();
    this.onDeviceFallback = Promise.resolve(false);
  }

  private openOnDevice(): void {
    const stream = new OnDeviceDictationStream();
    this.onDevice = stream;
    this.streaming = true;
    this.onDeviceOpened = stream.open().catch((error: unknown) => {
      if (this.onDevice !== stream) return;
      const failure = error instanceof Error ? error : new Error(String(error));
      this.streamFailure = failure;
      if (this.state === "listening" && !this.cancelled) void this.failWhileListening(failure);
    });
  }

  private async finishOnDevice(): Promise<string> {
    const stream = this.onDevice;
    try {
      await this.onDeviceOpened;
      if (this.streamFailure) throw this.streamFailure;
      if (!stream) throw new Error("Dictation stream is unavailable.");
      return (await stream.finish()).text;
    } finally {
      if (this.onDevice === stream) this.resetOnDevice();
    }
  }

  /**
   * The relay can end without its last words, or hear nothing in a word it
   * only caught part of. The recording still has them.
   */
  private async finishStreamed(
    recording: PcmRecording,
    signal: AbortSignal,
  ): Promise<string> {
    const stream = this.stream;
    let failure: unknown = null;
    const text = await this.finishStream().catch((error: unknown) => {
      failure = error;
      return "";
    });
    if (text || signal.aborted) return text;
    if (failure === null && !recording.hasSpeech()) return "";
    try {
      return await transcribeDictation(recording.toWav(), signal);
    } catch (error) {
      if (signal.aborted) return "";
      const partial = stream?.partial ?? "";
      if (partial || failure === null) return partial;
      throw error;
    }
  }

  private async finishStream(): Promise<string> {
    const stream = this.stream;
    try {
      await this.streamOpened;
      if (this.streamFailure) throw this.streamFailure;
      if (!stream) throw new Error("Dictation stream is unavailable.");
      await this.ingress?.flushed();
      if (this.streamFailure) throw this.streamFailure;
      return await stream.finish();
    } finally {
      if (this.stream === stream) this.resetStream();
    }
  }

  private async cleanup(): Promise<void> {
    this.stream?.cancel();
    this.resetStream();
    this.onDevice?.cancel();
    this.resetOnDevice();
    this.releaseCapture();
    if (this.durationLimitTimer) {
      clearTimeout(this.durationLimitTimer);
      this.durationLimitTimer = null;
    }
    this.meter.reset();
    this.recording = new PcmRecording();
    this.unrouted = null;
  }

  readLevel(): number {
    return this.meter.takeLevel();
  }

  private setState(state: DictationSessionState, error?: string): void {
    this.state = state;
    this.callbacks.onStateChange?.(state, error);
  }
}
