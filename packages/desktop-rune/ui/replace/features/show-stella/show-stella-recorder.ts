import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  ShowStellaRecorderResult,
  ShowStellaRecorderStart,
} from "@stella/contracts/desktop/show-stella";
import { PcmRecording } from "@/features/dictation/services/pcm-recording";
import type { engine as BridgeEngine } from "../../../../host/bridge";

const SAMPLE_RATE = 16_000;
const JPEG_QUALITY = 0.8;
const MAX_FRAME_RATE = 30;
const VIDEO_CHUNK_BYTES = 1 << 20;

type CaptureFrame = { id: string; kind: "frame"; at: number; path: string };
type Host = {
  engine: typeof BridgeEngine;
  on: (t: "capture", fn: (event: CaptureFrame) => void) => () => void;
};

type ShowStellaApi = NonNullable<NonNullable<typeof window.electronAPI>["showStella"]>;

const host = () => (globalThis as { stella?: Host }).stella;

const bytesOf = (file: string): ArrayBuffer | null => {
  try {
    const data = readFileSync(file);
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  } catch {
    return null;
  } finally {
    rmSync(file, { force: true });
  }
};

/** Show Stella's recorder on the engine: ScreenCaptureKit records the display (and, from macOS 15,
 *  the microphone) and hands over the MP4, periodic JPEG frames and 16 kHz PCM. */
export class ShowStellaRecorder {
  private readonly dir: string;
  private started = false;
  private stopped = false;
  private off: (() => void) | null = null;

  /** `api` is the overlay window's own `showStella` API: the main process takes recorder calls only from the overlay. */
  constructor(
    private readonly start: ShowStellaRecorderStart,
    private readonly api: ShowStellaApi | undefined = window.electronAPI?.showStella,
  ) {
    this.dir = path.join(tmpdir(), "stella-rune-capture", start.captureId);
  }

  async begin(): Promise<void> {
    const stella = host();
    if (!stella) throw new Error("This window can't record the screen.");
    const { captureId, display } = this.start;
    rmSync(this.dir, { recursive: true, force: true });
    mkdirSync(path.join(this.dir, "frames"), { recursive: true, mode: 0o700 });
    this.off = stella.on("capture", (event) => {
      if (event.id === captureId && event.kind === "frame") this.forwardFrame(event);
    });
    const started = await stella.engine.capture.start({
      id: captureId,
      sourceId: this.start.sourceId,
      width: Math.round(display.width * display.scaleFactor),
      height: Math.round(display.height * display.scaleFactor),
      fps: MAX_FRAME_RATE,
      file: path.join(this.dir, "recording.mp4"),
      framesDir: path.join(this.dir, "frames"),
      frameIntervalMs: this.start.frameIntervalMs,
      frameEdge: this.start.frameEdge,
      jpegQuality: JPEG_QUALITY,
      microphone: this.start.microphone,
    }).catch((error: unknown) => {
      this.cleanUp();
      throw error;
    });
    if (this.stopped) {
      await stella.engine.capture.stop(captureId).catch(() => undefined);
      this.cleanUp();
      return;
    }
    this.started = true;
    if (this.start.microphone && !started.microphone) {
      console.warn("[show-stella] no microphone: screen capture records it from macOS 15");
    }
    this.api?.recorderStarted({ captureId, atMs: Date.now() });
  }

  private forwardFrame(event: CaptureFrame): void {
    const jpeg = bytesOf(event.path);
    if (!jpeg) return;
    const t = Math.max(0, Math.round(event.at - this.start.startedAtMs));
    this.api?.sendFrame({ captureId: this.start.captureId, t, jpeg });
  }

  private sendVideo(file: string): boolean {
    const video = bytesOf(file);
    if (!video || video.byteLength === 0) return false;
    for (let at = 0; at < video.byteLength; at += VIDEO_CHUNK_BYTES) {
      const chunk = video.slice(at, Math.min(video.byteLength, at + VIDEO_CHUNK_BYTES));
      this.api?.sendVideoChunk({ captureId: this.start.captureId, chunk, mimeType: "video/mp4" });
    }
    return true;
  }

  private wavOf(file: string, startedAt: number | null): ArrayBuffer | null {
    const bytes = bytesOf(file);
    if (!bytes || bytes.byteLength < 2) return null;
    const pcm = new PcmRecording();
    const lead = Math.max(0, Math.round((((startedAt ?? this.start.startedAtMs) - this.start.startedAtMs) * SAMPLE_RATE) / 1000));
    if (lead > 0) pcm.append(new Int16Array(lead));
    pcm.append(new Int16Array(bytes, 0, bytes.byteLength >> 1));
    return pcm.sampleCount > 0 ? pcm.toWav() : null;
  }

  private cleanUp(): void {
    this.off?.();
    this.off = null;
    rmSync(this.dir, { recursive: true, force: true });
  }

  async stop(): Promise<ShowStellaRecorderResult> {
    this.stopped = true;
    let wav: ArrayBuffer | null = null;
    let videoMimeType: string | null = null;
    const stella = host();
    if (stella && this.started) {
      try {
        const out = await stella.engine.capture.stop(this.start.captureId);
        if (out.file && this.sendVideo(out.file)) videoMimeType = "video/mp4";
        if (out.pcm) wav = this.wavOf(out.pcm, out.pcmStartAt);
      } catch (error) {
        console.warn("[show-stella] the recording didn't finish:", (error as Error)?.message);
      }
    }
    if (this.started || !stella) this.cleanUp();
    return { captureId: this.start.captureId, wav, videoMimeType };
  }
}
