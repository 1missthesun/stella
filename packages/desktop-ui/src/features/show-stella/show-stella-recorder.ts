import type {
  ShowStellaRecorderResult,
  ShowStellaRecorderStart,
} from "@stella/contracts/desktop/show-stella";
import { PcmRecording } from "@/features/dictation/services/pcm-recording";
import { resolveDictationPcmWorkletUrl } from "@/features/dictation/services/dictation-session";

/**
 * Records the screen in the overlay renderer: a video for the user, a few
 * frames a second for the capture's moments and zoom, and the microphone as
 * 16 kHz PCM for the transcript. Everything goes to the main process, which
 * writes it into the capture's folder.
 */

const PCM_WORKLET_NAME = "stella-dictation-pcm-capture";
const SAMPLE_RATE = 16_000;
const VIDEO_TIMESLICE_MS = 1_000;
const VIDEO_BITS_PER_SECOND = 4_000_000;
const JPEG_QUALITY = 0.8;
const MAX_FRAMES_IN_FLIGHT = 2;
const VIDEO_TYPES = [
  "video/mp4;codecs=avc1.640028,mp4a.40.2",
  "video/mp4;codecs=avc1,mp4a.40.2",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm",
];

type ImageCaptureLike = { grabFrame: () => Promise<ImageBitmap> };
type ImageCaptureCtor = new (track: MediaStreamTrack) => ImageCaptureLike;

const api = () => window.electronAPI?.showStella;

const desktopStream = (start: ShowStellaRecorderStart) => {
  const { display } = start;
  const width = Math.round(display.width * display.scaleFactor);
  const height = Math.round(display.height * display.scaleFactor);
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: start.sourceId,
        maxWidth: width,
        maxHeight: height,
        maxFrameRate: 30,
      },
    } as unknown as MediaTrackConstraints,
  });
};

const microphoneStream = () =>
  navigator.mediaDevices
    .getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    })
    .catch((error: unknown) => {
      console.warn("[show-stella] no microphone:", (error as Error)?.message);
      return null;
    });

export class ShowStellaRecorder {
  private screen: MediaStream | null = null;
  private mic: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private recorderDone: Promise<void> = Promise.resolve();
  private chunkSends: Promise<void> = Promise.resolve();
  private audio: AudioContext | null = null;
  private pcm: PcmRecording | null = null;
  private frameTimer: ReturnType<typeof setInterval> | null = null;
  private framesInFlight = 0;
  private grabber: ImageCaptureLike | null = null;
  private canvas: OffscreenCanvas | null = null;
  private mimeType: string | null = null;
  private stopped = false;

  constructor(private readonly start: ShowStellaRecorderStart) {}

  private now(): number {
    return Date.now() - this.start.startedAtMs;
  }

  async begin(): Promise<void> {
    const [screen, mic] = await Promise.all([
      desktopStream(this.start),
      this.start.microphone ? microphoneStream() : Promise.resolve(null),
    ]);
    if (this.stopped) {
      for (const stream of [screen, mic]) stream?.getTracks().forEach((track) => track.stop());
      return;
    }
    this.screen = screen;
    this.mic = mic;
    const track = screen.getVideoTracks()[0];
    if (!track) throw new Error("The screen recording has no picture.");

    if (mic) await this.beginAudio(mic);
    this.beginVideo(screen, mic);
    this.beginFrames(track);
    api()?.recorderStarted({ captureId: this.start.captureId, atMs: Date.now() });
  }

  private async beginAudio(mic: MediaStream): Promise<void> {
    try {
      const context = new AudioContext({ latencyHint: "interactive" });
      await context.audioWorklet.addModule(resolveDictationPcmWorkletUrl(window.location.href));
      if (context.state === "suspended") await context.resume();
      const pcm = new PcmRecording();
      // The sound lines up with the capture's clock: silence until the mic started.
      const lead = Math.max(0, Math.round((this.now() * SAMPLE_RATE) / 1000));
      if (lead > 0) pcm.append(new Int16Array(lead));
      const source = context.createMediaStreamSource(mic);
      const worklet = new AudioWorkletNode(context, PCM_WORKLET_NAME, {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCount: 1,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
      });
      worklet.port.onmessage = (event: MessageEvent<{ pcm?: Int16Array }>) => {
        if (event.data?.pcm?.length) pcm.append(event.data.pcm);
      };
      source.connect(worklet);
      this.audio = context;
      this.pcm = pcm;
    } catch (error) {
      console.warn("[show-stella] no sound for the transcript:", (error as Error)?.message);
    }
  }

  private beginVideo(screen: MediaStream, mic: MediaStream | null): void {
    const type = VIDEO_TYPES.find((candidate) => MediaRecorder.isTypeSupported(candidate));
    const stream = new MediaStream([
      ...screen.getVideoTracks(),
      ...(mic?.getAudioTracks() ?? []),
    ]);
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        ...(type ? { mimeType: type } : {}),
        videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
      });
    } catch (error) {
      console.warn("[show-stella] no video file:", (error as Error)?.message);
      return;
    }
    this.mimeType = recorder.mimeType || type || "video/webm";
    const mimeType = this.mimeType;
    recorder.ondataavailable = (event) => {
      if (!event.data || event.data.size === 0) return;
      const blob = event.data;
      this.chunkSends = this.chunkSends.then(async () => {
        const chunk = await blob.arrayBuffer();
        api()?.sendVideoChunk({ captureId: this.start.captureId, chunk, mimeType });
      });
    };
    this.recorderDone = new Promise((resolve) => {
      recorder.onstop = () => resolve();
      recorder.onerror = () => resolve();
    });
    recorder.start(VIDEO_TIMESLICE_MS);
    this.recorder = recorder;
  }

  private beginFrames(track: MediaStreamTrack): void {
    const Ctor = (globalThis as { ImageCapture?: ImageCaptureCtor }).ImageCapture;
    if (!Ctor) throw new Error("This window can't read frames from the screen recording.");
    this.grabber = new Ctor(track);
    const grab = () => void this.grabFrame();
    grab();
    this.frameTimer = setInterval(grab, this.start.frameIntervalMs);
  }

  private async grabFrame(): Promise<void> {
    if (this.stopped || !this.grabber || this.framesInFlight >= MAX_FRAMES_IN_FLIGHT) return;
    this.framesInFlight += 1;
    const t = this.now();
    try {
      const bitmap = await this.grabber.grabFrame();
      const edge = this.start.frameEdge;
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height, 1));
      const width = Math.max(1, Math.round(bitmap.width * scale));
      const height = Math.max(1, Math.round(bitmap.height * scale));
      if (!this.canvas || this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas = new OffscreenCanvas(width, height);
      }
      const context = this.canvas.getContext("2d");
      if (!context) throw new Error("no canvas");
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, 0, 0, width, height);
      bitmap.close();
      const blob = await this.canvas.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY });
      const jpeg = await blob.arrayBuffer();
      api()?.sendFrame({ captureId: this.start.captureId, t, jpeg });
    } catch (error) {
      if (!this.stopped) console.debug("[show-stella] frame skipped:", (error as Error)?.message);
    } finally {
      this.framesInFlight -= 1;
    }
  }

  async stop(): Promise<ShowStellaRecorderResult> {
    this.stopped = true;
    if (this.frameTimer) clearInterval(this.frameTimer);
    this.frameTimer = null;
    if (this.recorder && this.recorder.state !== "inactive") {
      try {
        this.recorder.requestData();
      } catch {
        // Stopping flushes the rest.
      }
      this.recorder.stop();
    }
    await this.recorderDone;
    await this.chunkSends.catch(() => undefined);
    for (const stream of [this.screen, this.mic]) stream?.getTracks().forEach((track) => track.stop());
    await this.audio?.close().catch(() => undefined);
    const wav = this.pcm && this.pcm.sampleCount > 0 ? this.pcm.toWav() : null;
    return {
      captureId: this.start.captureId,
      wav,
      videoMimeType: this.recorder ? this.mimeType : null,
    };
  }
}
