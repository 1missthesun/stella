import { DictationIngressQueue } from "@stella/contracts/dictation-ingress";
import { createDictationLevelMeter } from "@stella/contracts/dictation-waveform";
import { uiState } from "@/platform/ui-state";
import {
  acquireSharedMicrophone,
  setSharedMicrophoneKeepWarm,
  type SharedMicrophoneLease,
} from "@/features/voice/services/shared-microphone";
import { DictationStream } from "./dictation-stream";
import { transcribeDictation } from "./dictation-transcriber";
import { PcmRecording } from "./pcm-recording";

type WorkletFrame = { pcm: Int16Array; rms: number };

const TARGET_SAMPLE_RATE = 16_000;
const PCM_WORKLET_NAME = "stella-dictation-pcm-capture";
const PCM_WORKLET_FILE = "dictation-pcm-worklet.js";
const DICTATION_SUPER_FAST_KEY = "stella-dictation-super-fast";
const MAX_DICTATION_DURATION_MS = 15 * 60 * 1000;

const PRE_ROLL_MS = 300;
const WARM_CONTEXT_IDLE_MS = 60_000;

export const resolveDictationPcmWorkletUrl = (rendererHref: string): string =>
  new URL(PCM_WORKLET_FILE, rendererHref).href;

export type DictationSessionState =
  | "idle"
  | "listening"
  | "transcribing"
  | "error";

type DictationCallbacks = {
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

  async attach(listener: (frame: WorkletFrame) => void): Promise<Int16Array[]> {
    this.clearIdle();
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
    if (this.listener || this.pinned || this.startPromise) return;
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
    const maxSamples = Math.round((PRE_ROLL_MS / 1000) * TARGET_SAMPLE_RATE);
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
  warmCapture.warmForIntent();
}

export class DictationSession {
  private state: DictationSessionState = "idle";
  private attached: ((frame: WorkletFrame) => void) | null = null;
  private callbacks: DictationCallbacks = {};
  private recording = new PcmRecording();
  private transcription: AbortController | null = null;
  private streaming = false;
  private streamedSamples = 0;
  private stream: DictationStream | null = null;
  private streamOpened: Promise<void> = Promise.resolve();
  private streamFailure: Error | null = null;
  private ingress: DictationIngressQueue | null = null;
  private durationLimitTimer: ReturnType<typeof setTimeout> | null = null;
  private cancelled = false;
  private readonly meter = createDictationLevelMeter();
  private pressedAt = 0;
  private marks: Record<string, number> = {};

  isActive(): boolean {
    return this.state === "listening" || this.state === "transcribing";
  }

  async start(
    callbacks: DictationCallbacks,
    options: { streaming?: boolean } = {},
  ): Promise<void> {
    if (this.isActive()) return;
    this.pressedAt = performance.now();
    this.marks = {};
    this.callbacks = callbacks;
    this.cancelled = false;
    this.streaming = options.streaming === true;
    this.recording = new PcmRecording();
    this.meter.reset();
    this.resetStream();
    if (this.streaming) this.openStream();

    const listener = (frame: WorkletFrame) => this.onFrame(frame);
    this.attached = listener;
    let preRoll: Int16Array[];
    try {
      preRoll = await warmCapture.attach(listener);
    } catch (err) {
      if (this.cancelled) {
        await this.cleanup();
        this.setState("idle");
        return;
      }
      console.error("[dictation] failed to acquire microphone:", err);
      this.setState("error", (err as Error).message);
      await this.cleanup();
      throw err;
    }

    try {
      if (this.cancelled) {
        await this.cleanup();
        this.setState("idle");
        return;
      }
      for (const chunk of preRoll) this.capture(chunk);
      if (this.streamFailure) throw this.streamFailure;
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
  }

  async stop(): Promise<void> {
    if (this.state === "idle") return;
    if (this.state === "transcribing") return;

    if (this.durationLimitTimer) {
      clearTimeout(this.durationLimitTimer);
      this.durationLimitTimer = null;
    }
    this.meter.reset();
    this.releaseCapture();

    const recording = this.recording;
    this.recording = new PcmRecording();
    const samples = this.streaming
      ? this.streamedSamples
      : recording.sampleCount;
    if (this.cancelled || samples === 0) {
      this.stream?.cancel();
      this.resetStream();
      this.setState("idle");
      return;
    }

    this.setState("transcribing");
    const controller = new AbortController();
    this.transcription = controller;
    try {
      const transcript = this.streaming
        ? await this.finishStream()
        : await transcribeDictation(recording.toWav(), controller.signal);
      if (this.cancelled || !transcript) {
        this.setState("idle");
        return;
      }
      this.callbacks.onFinalTranscript?.(transcript);
      this.setState("idle");
    } catch (err) {
      if (this.cancelled) {
        this.setState("idle");
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
    if (this.state === "transcribing") {
      this.transcription?.abort();
      this.setState("idle");
      this.callbacks = {};
      return;
    }
    if (this.state === "idle") {
      this.releaseCapture();
      return;
    }
    await this.stop();
  }

  private onFrame(frame: WorkletFrame): void {
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
    this.capture(frame.pcm);
    if (this.recording.full && this.state === "listening") {
      console.warn("[dictation] hit max recording length, auto-stopping");
      void this.stop();
    }
  }

  private releaseCapture(): void {
    if (!this.attached) return;
    warmCapture.detach(this.attached);
    this.attached = null;
  }

  private resetStream(): void {
    this.ingress?.close();
    this.ingress = null;
    this.stream = null;
    this.streamOpened = Promise.resolve();
    this.streamFailure = null;
    this.streamedSamples = 0;
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
    console.error("[dictation] relay failed while recording:", error);
    await this.cleanup();
    this.setState("error", error.message);
  }

  private capture(pcm: Int16Array): void {
    if (!this.streaming) {
      this.recording.append(pcm);
      return;
    }
    this.streamedSamples += pcm.length;
    this.ingress?.push(pcm);
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
    this.releaseCapture();
    if (this.durationLimitTimer) {
      clearTimeout(this.durationLimitTimer);
      this.durationLimitTimer = null;
    }
    this.meter.reset();
    this.recording = new PcmRecording();
  }

  readLevel(): number {
    return this.meter.takeLevel();
  }

  private setState(state: DictationSessionState, error?: string): void {
    this.state = state;
    this.callbacks.onStateChange?.(state, error);
  }
}
