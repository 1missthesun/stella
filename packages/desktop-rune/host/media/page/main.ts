// The media page: desktop-ui's browser-only audio modules, unchanged, driven by the host over the
// WebView's message channel (host/media/protocol.ts).

import { WebRTCMediaSession } from "@/features/voice/services/realtime/transports/webrtc-media-session";
import { playVoiceCue, type VoiceCue } from "@/features/voice/services/voice-cues";
import {
  playReadAloud,
  playReadAloudStream,
  stopReadAloud,
  subscribeReadAloudPlaying,
  isReadAloudPlaying,
  canStreamReadAloud,
} from "@/features/voice/services/read-aloud/read-aloud-player";
import { MicCapture } from "@/features/voice/services/realtime/audio-pipeline/mic-capture";
import { PcmPlayer } from "@/features/voice/services/realtime/audio-pipeline/pcm-player";
import {
  acquireSharedMicrophone,
  setSharedMicrophoneKeepWarm,
  type SharedMicrophoneLease,
} from "@/features/voice/services/shared-microphone";
import type { AnalyserFrame, FromPage, HandleRef, MediaPageCaps, ToPage } from "../protocol";
import { applyUiState } from "./ui-state";

type Bridge = { post(data: unknown, origin?: string): void };
const bridge = (window as unknown as { __stellaBridge: Bridge }).__stellaBridge;
const send = (message: FromPage) => bridge.post(message);

const objects = new Map<number, unknown>();
let nextPageHandle = -1;
const own = (value: unknown): HandleRef => {
  const handle = nextPageHandle--;
  objects.set(handle, value);
  return { $h: handle };
};

const isRef = (value: unknown): value is HandleRef =>
  typeof value === "object" && value !== null && typeof (value as HandleRef).$h === "number";
const resolveArgs = (args: unknown[]) => args.map((arg) => (isRef(arg) ? objects.get(arg.$h) : arg));

const fromBase64 = (data: string) => {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};
const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

const callbacks = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
let nextCallback = 1;
const callHost = (handle: number, name: string, args: unknown[]) =>
  new Promise<unknown>((resolve, reject) => {
    const id = nextCallback++;
    callbacks.set(id, { resolve, reject });
    send({ t: "cb", id, handle, name, args });
  });
const emit = (handle: number, name: string, ...args: unknown[]) => send({ t: "event", handle, name, args });

/** Host-pulled byte streams: a `Response` body the page reads while the host forwards the network's chunks. */
const streams = new Map<number, ReadableStreamDefaultController<Uint8Array>>();
const pulledStream = (stream: number) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      streams.set(stream, controller);
    },
    pull() {
      send({ t: "pull", stream });
    },
    cancel() {
      streams.delete(stream);
      send({ t: "pull", stream: -stream });
    },
  }, { highWaterMark: 1 });

type Analysed = { analysers(): Record<string, AnalyserNode | null> };
const analysed = new Map<number, Analysed>();

const frameOf = (node: AnalyserNode): AnalyserFrame => {
  const freq = new Uint8Array(node.frequencyBinCount);
  const time = new Uint8Array(node.fftSize);
  node.getByteFrequencyData(freq);
  node.getByteTimeDomainData(time);
  return { freq: toBase64(freq), time: toBase64(time) };
};

declare const DICTATION_PCM_WORKLET: string;

const WORKLETS: Record<string, string> = { "dictation-pcm-worklet.js": DICTATION_PCM_WORKLET };
const PCM_BATCH_SAMPLES = 320;

/** An AudioContext feeding a microphone stream into a PCM worklet (`{pcm: Int16Array, rms}` per message), for the UI's AudioContext stand-in: frames go out in ~20 ms batches. */
class PcmWorkletPipeline {
  private readonly context = new AudioContext({ latencyHint: "interactive" });
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private batch: Int16Array[] = [];
  private samples = 0;
  private energy = 0;

  constructor(private readonly onFrame: (pcm: Int16Array, rms: number) => void) {}

  async addModule(file: string) {
    const source = WORKLETS[file];
    if (!source) throw new Error(`Unknown audio worklet ${file}`);
    const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
    try {
      await this.context.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async resume() {
    if (this.context.state === "suspended") await this.context.resume();
  }

  async connect(stream: MediaStream, processor: string, options: AudioWorkletNodeOptions) {
    this.disconnect();
    await this.resume();
    const source = this.context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(this.context, processor, options);
    node.port.onmessage = (event: MessageEvent<{ pcm?: Int16Array; rms?: number }>) => {
      const { pcm, rms } = event.data ?? {};
      if (pcm?.length) this.push(pcm, rms ?? 0);
    };
    source.connect(node);
    this.source = source;
    this.node = node;
  }

  disconnect() {
    if (this.node) {
      this.node.port.onmessage = null;
      this.node.port.close();
      this.node.disconnect();
      this.node = null;
    }
    this.source?.disconnect();
    this.source = null;
    this.flush();
  }

  async close() {
    this.disconnect();
    if (this.context.state !== "closed") await this.context.close();
  }

  private push(pcm: Int16Array, rms: number) {
    this.batch.push(pcm);
    this.samples += pcm.length;
    this.energy += rms * rms * pcm.length;
    if (this.samples >= PCM_BATCH_SAMPLES) this.flush();
  }

  private flush() {
    if (!this.samples) return;
    const pcm = new Int16Array(this.samples);
    let at = 0;
    for (const chunk of this.batch) {
      pcm.set(chunk, at);
      at += chunk.length;
    }
    const rms = Math.sqrt(this.energy / this.samples);
    this.batch = [];
    this.samples = 0;
    this.energy = 0;
    this.onFrame(pcm, rms);
  }
}

const classes: Record<string, (handle: number, args: unknown[]) => unknown> = {
  PcmWorkletPipeline(handle) {
    return new PcmWorkletPipeline((pcm, rms) => emit(handle, "frame", toBase64(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength)), rms));
  },
  WebRTCMediaSession(handle, [options]) {
    const { dataChannelLabel, logPrefix } = options as { dataChannelLabel: string; logPrefix: string };
    const session = new WebRTCMediaSession({
      dataChannelLabel,
      logPrefix,
      sdpFetch: (offer) => callHost(handle, "sdpFetch", [offer]) as Promise<string>,
    });
    session.attach({
      onChannelOpen: () => emit(handle, "channelOpen"),
      onMessage: (event) => emit(handle, "message", event),
      onChannelDown: (reason, kind) => emit(handle, "channelDown", reason, kind),
    });
    analysed.set(handle, { analysers: () => ({ mic: session.getMicAnalyser(), output: session.getOutputAnalyser() }) });
    return session;
  },
  MicCapture(handle, [options]) {
    const capture = new MicCapture({
      ...(options as { targetSampleRate?: number; bufferSize?: number }),
      onChunk: (base64Pcm) => emit(handle, "chunk", base64Pcm),
    });
    analysed.set(handle, { analysers: () => ({ mic: capture.getAnalyser() }) });
    return capture;
  },
  PcmPlayer(handle, [options]) {
    const player = new PcmPlayer({
      inputSampleRate: (options as { inputSampleRate: number }).inputSampleRate,
      onSpeakingStart: () => emit(handle, "speakingStart"),
      onSpeakingEnd: () => emit(handle, "speakingEnd"),
    });
    analysed.set(handle, { analysers: () => ({ output: player.getAnalyser() }) });
    return player;
  },
};

const playingHandle = 0;
const functions: Record<string, (args: unknown[], signal: AbortSignal) => unknown> = {
  playVoiceCue([cue]) {
    playVoiceCue(cue as VoiceCue);
  },
  async playReadAloud([data, notifyEnd]) {
    await playReadAloud(fromBase64(data as string).buffer as ArrayBuffer, {
      onEnded: () => emit(playingHandle, "readAloudEnded", notifyEnd),
    });
  },
  async playReadAloudStream([stream, notifyEnd]) {
    await playReadAloudStream(new Response(pulledStream(stream as number)), {
      onEnded: () => emit(playingHandle, "readAloudEnded", notifyEnd),
    });
  },
  stopReadAloud() {
    stopReadAloud();
  },
  async acquireSharedMicrophone() {
    const lease = await acquireSharedMicrophone();
    return { lease: own(lease), stream: own(lease.stream) };
  },
  stopStream([stream]) {
    (stream as MediaStream | undefined)?.getTracks().forEach((track) => track.stop());
  },
  releaseMicrophone([lease, options]) {
    (lease as SharedMicrophoneLease | undefined)?.release(options as { immediate?: boolean } | undefined);
  },
  async setSharedMicrophoneKeepWarm([keepWarm]) {
    await setSharedMicrophoneKeepWarm(Boolean(keepWarm));
  },
};

subscribeReadAloudPlaying(() => emit(playingHandle, "readAloudPlaying", isReadAloudPlaying()));

const aborts = new Map<number, AbortController>();

const run = async (id: number, work: (signal: AbortSignal) => unknown) => {
  const controller = new AbortController();
  aborts.set(id, controller);
  try {
    const value = await work(controller.signal);
    send({ t: "ret", id, ok: true, value: value === undefined ? null : value });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    send({ t: "ret", id, ok: false, error: err.message, name: err.name });
  } finally {
    aborts.delete(id);
  }
};

const receive = (message: ToPage) => {
  switch (message.t) {
    case "state":
      applyUiState(message.values);
      return;
    case "new":
      return void run(message.id, () => {
        const make = classes[message.cls];
        if (!make) throw new Error(`Unknown media class ${message.cls}`);
        objects.set(message.handle, make(message.handle, message.args));
      });
    case "call":
      return void run(message.id, (signal) => {
        if (message.handle === 0) {
          const fn = functions[message.method];
          if (!fn) throw new Error(`Unknown media function ${message.method}`);
          return fn(resolveArgs(message.args), signal);
        }
        const target = objects.get(message.handle) as Record<string, (...a: unknown[]) => unknown> | undefined;
        if (!target) throw new Error(`No media object ${message.handle}`);
        const args = resolveArgs(message.args);
        if (message.method === "open") return target.open!(signal);
        return target[message.method]!(...args);
      });
    case "abort":
      aborts.get(message.id)?.abort();
      return;
    case "drop":
      objects.delete(message.handle);
      analysed.delete(message.handle);
      return;
    case "cbret": {
      const waiter = callbacks.get(message.id);
      callbacks.delete(message.id);
      if (message.ok) waiter?.resolve(message.value);
      else waiter?.reject(new Error(message.error ?? "Host callback failed"));
      return;
    }
    case "chunk": {
      const controller = streams.get(message.stream);
      if (!controller) return;
      if (message.error) {
        streams.delete(message.stream);
        controller.error(new Error(message.error));
      } else if (message.done) {
        streams.delete(message.stream);
        controller.close();
      } else if (message.data) {
        controller.enqueue(fromBase64(message.data));
      }
      return;
    }
    case "sample": {
      const frames: Record<string, AnalyserFrame | null> = {};
      for (const [handle, owner] of analysed) {
        for (const [name, node] of Object.entries(owner.analysers())) frames[`${handle}:${name}`] = node ? frameOf(node) : null;
      }
      send({ t: "samples", frames });
      return;
    }
  }
};

window.addEventListener("message", (event) => {
  const message = event.data as ToPage | undefined;
  if (message && typeof message === "object" && "t" in message) receive(message);
});

const forward = (level: "debug" | "warn" | "error") => {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    original(...args);
    send({ t: "log", level, text: args.map((a) => (a instanceof Error ? a.message : typeof a === "string" ? a : JSON.stringify(a))).join(" ") });
  };
};
forward("debug");
forward("warn");
forward("error");
window.addEventListener("error", (event) => send({ t: "log", level: "error", text: String(event.message) }));
window.addEventListener("unhandledrejection", (event) => send({ t: "log", level: "error", text: String((event.reason as Error)?.message ?? event.reason) }));

const caps: MediaPageCaps = {
  secureContext: window.isSecureContext,
  rtc: typeof RTCPeerConnection !== "undefined",
  audioContext: typeof AudioContext !== "undefined",
  mediaSource: typeof MediaSource !== "undefined",
  mpegStream: canStreamReadAloud(),
  getUserMedia: typeof navigator.mediaDevices?.getUserMedia === "function",
  userAgent: navigator.userAgent,
};
send({ t: "hello", caps });
