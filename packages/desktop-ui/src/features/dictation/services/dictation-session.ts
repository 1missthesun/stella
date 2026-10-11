import { DictationIngressQueue } from "@stella/contracts/dictation-ingress";
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
const DICTATION_MIC_OPENED_KEY = "stella-dictation-mic-opened";
/** Hard cap on a single dictation recording before we auto-stop and
 * transcribe. Stella keeps the existing 15-minute product limit. */
const MAX_DICTATION_DURATION_MS = 15 * 60 * 1000;

/** How often we emit a level tick to consumers (≈ 12 Hz). The waveform UI
 *  appends one bar per tick, so this also controls the bar density of the
 *  scrolling visualization. */
const LEVEL_EMIT_INTERVAL_MS = 80;

/** RMS values during normal speech sit around 0.05–0.15. Multiplying by
 *  this constant maps that range onto a perceptually pleasing 0–1 scale
 *  for the waveform without immediately clipping at the top. */
const LEVEL_GAIN = 6;
/** Audio kept from just before the press, covering the click's own latency. */
const PRE_ROLL_MS = 300;
/** A warm-up from hovering the mic ends this long after the last intent. */
const INTENT_WARM_MS = 10_000;

export const resolveDictationPcmWorkletUrl = (rendererHref: string): string =>
  new URL(PCM_WORKLET_FILE, rendererHref).href;

export type DictationSessionState =
  | "idle"
  | "listening"
  | "transcribing"
  | "error";

type DictationCallbacks = {
  onFinalTranscript?: (text: string) => void;
  onPartialTranscript?: (text: string) => void;
  onStateChange?: (state: DictationSessionState, error?: string) => void;
  /** Periodic 0..1 input-level tick used by the recording UI to render a
   *  scrolling waveform. Fires at ~12 Hz while listening; the value is the
   *  peak RMS observed since the previous tick. */
  onLevel?: (level: number) => void;
};

export function isDictationSuperFastEnabled(): boolean {
  return uiState.getItem(DICTATION_SUPER_FAST_KEY) === "true";
}

export function setDictationSuperFastPreference(enabled: boolean): void {
  uiState.setItem(DICTATION_SUPER_FAST_KEY, enabled ? "true" : "false");
}

/**
 * The microphone and its 16 kHz PCM pipeline, shared by every recording.
 *
 * Opening a microphone and an AudioContext on macOS takes from a few hundred
 * milliseconds to almost two seconds, and nothing said in that time can be
 * recovered. So the pipeline opens ahead of a likely press (hovering or
 * focusing the mic, or always with Super Fast), keeps only the last
 * `PRE_ROLL_MS` while nobody is recording, and a press takes it over with no
 * device open at all. A press with nothing warm opens it on the spot.
 */
class DictationWarmCapture {
  private micLease: SharedMicrophoneLease | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private chunks: Int16Array[] = [];
  private totalSamples = 0;
  private startPromise: Promise<void> | null = null;
  private listener: ((frame: WorkletFrame) => void) | null = null;
  private pinned = false;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  async start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startInner().finally(() => {
      this.startPromise = null;
    });
    return this.startPromise;
  }

  /** Super Fast: stay open until turned off. */
  async pin(enabled: boolean): Promise<void> {
    this.pinned = enabled;
    if (enabled) {
      this.clearIdle();
      await this.start();
    } else {
      await this.stop();
    }
  }

  /**
   * A press is likely: open now and close again if none comes. Only once
   * dictation has opened the microphone before, so hovering never raises the
   * system permission prompt.
   */
  warmForIntent(): void {
    if (this.listener) return;
    if (uiState.getItem(DICTATION_MIC_OPENED_KEY) !== "true") return;
    this.scheduleIdleStop(INTENT_WARM_MS);
    void this.start().catch(() => undefined);
  }

  /**
   * Hand the pipeline to a recording, opening it if nothing is warm: resolves
   * with the pre-roll, and every later frame goes to `listener` until
   * `detach`. The listener is registered first, so a warm-up timing out
   * meanwhile cannot close the microphone under the press.
   */
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

  /** Close the microphone unless a recording or Super Fast still needs it. */
  async stop(): Promise<void> {
    this.clearIdle();
    const starting = this.startPromise;
    if (starting) await starting.catch(() => undefined);
    if (this.listener || this.pinned || this.startPromise) return;
    this.tearDownAudioPipeline();
    const ctx = this.audioContext;
    const lease = this.micLease;
    this.audioContext = null;
    this.micLease = null;
    this.chunks = [];
    this.totalSamples = 0;
    lease?.release();
    await ctx?.close().catch(() => undefined);
  }

  private scheduleIdleStop(ms: number): void {
    this.clearIdle();
    if (this.pinned) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      void this.stop();
    }, ms);
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private async startInner(): Promise<void> {
    if (this.audioContext && this.micLease) return;
    // The context and its worklet come up while the device opens.
    const ctx = new AudioContext();
    const moduleReady = ctx.audioWorklet.addModule(
      resolveDictationPcmWorkletUrl(window.location.href),
    );
    let lease: SharedMicrophoneLease;
    try {
      [lease] = await Promise.all([acquireSharedMicrophone(), moduleReady]);
    } catch (error) {
      void moduleReady.catch(() => undefined);
      await ctx.close().catch(() => undefined);
      throw error;
    }
    this.micLease = lease;
    this.audioContext = ctx;
    uiState.setItem(DICTATION_MIC_OPENED_KEY, "true");

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

/** The user is about to press the mic (hover or focus): open it now. */
export function warmDictationMicrophone(): void {
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
  /** Settles once the provider acknowledged its session or the relay failed. */
  private streamOpened: Promise<void> = Promise.resolve();
  private streamFailure: Error | null = null;
  /** Everything captured, held from the press and paced out once connected. */
  private ingress: DictationIngressQueue | null = null;
  private durationLimitTimer: ReturnType<typeof setTimeout> | null = null;
  private cancelled = false;
  /** Peak RMS seen since the last `onLevel` emit, reset every tick. */
  private peakSinceLastEmit = 0;
  private levelEmitTimer: ReturnType<typeof setInterval> | null = null;

  isActive(): boolean {
    return this.state === "listening" || this.state === "transcribing";
  }

  async start(
    callbacks: DictationCallbacks,
    options: { streaming?: boolean } = {},
  ): Promise<void> {
    if (this.isActive()) return;
    this.callbacks = callbacks;
    this.cancelled = false;
    this.streaming = options.streaming === true;
    this.recording = new PcmRecording();
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
      // The relay may already have refused while the mic was starting.
      if (this.streamFailure) throw this.streamFailure;
      this.durationLimitTimer = setTimeout(() => {
        console.warn("[dictation] hit max segment duration, auto-stopping");
        void this.stop();
      }, MAX_DICTATION_DURATION_MS);
      this.startLevelEmitter();
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
    this.stopLevelEmitter();
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
      this.setState("idle");
      this.callbacks.onFinalTranscript?.(transcript);
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

  /** Stop without transcribing. Used on unmount / error paths. */
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
    if (frame.rms > this.peakSinceLastEmit) this.peakSinceLastEmit = frame.rms;
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
      (text) => {
        if (this.stream === stream) this.callbacks.onPartialTranscript?.(text);
      },
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
        if (this.stream !== stream || this.streamFailure) return;
        ingress.start();
      },
      (error: unknown) => {
        if (this.stream !== stream) return;
        const failure =
          error instanceof Error ? error : new Error(String(error));
        this.streamFailure = failure;
        // Failure while recording: tear down and surface it. Before that,
        // start() reads the failure; after, stop() does.
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
      // A short recording can end before the relay connects; its audio is
      // still buffered and goes out the moment the socket opens.
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
    this.stopLevelEmitter();
    this.recording = new PcmRecording();
  }

  private startLevelEmitter(): void {
    this.stopLevelEmitter();
    this.peakSinceLastEmit = 0;
    this.levelEmitTimer = setInterval(() => {
      const level = Math.min(1, this.peakSinceLastEmit * LEVEL_GAIN);
      this.peakSinceLastEmit = 0;
      this.callbacks.onLevel?.(level);
    }, LEVEL_EMIT_INTERVAL_MS);
  }

  private stopLevelEmitter(): void {
    if (this.levelEmitTimer) {
      clearInterval(this.levelEmitTimer);
      this.levelEmitTimer = null;
    }
    this.peakSinceLastEmit = 0;
  }

  private setState(state: DictationSessionState, error?: string): void {
    this.state = state;
    this.callbacks.onStateChange?.(state, error);
  }
}
