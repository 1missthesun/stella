// desktop-ui's MicCapture (ScriptProcessor PCM capture) runs in the media page on the page's
// microphone stream; its chunks come back here.

import type { MicCaptureOptions } from "@/features/voice/services/realtime/audio-pipeline/mic-capture";
import type { PageObject } from "../../../../../../../host/media/media-page";
import { analyserOf, pageRef, useMediaPage, type PageAnalyser } from "../../../../../../host/media-client";

export * from "@/features/voice/services/realtime/audio-pipeline/mic-capture";

export class MicCapture {
  private object: PageObject | null = null;
  private readonly ready: Promise<PageObject | null>;
  private release: (() => void) | null = null;
  private disposed = false;
  private readonly analysers = new Map<string, PageAnalyser>();

  constructor(options: MicCaptureOptions) {
    const { onChunk, ...rest } = options;
    this.ready = useMediaPage()
      .then(async ({ media, release }) => {
        this.release = release;
        const object = await media.create("MicCapture", [rest], (name, args) => {
          if (name === "chunk" && !this.disposed) onChunk(String(args[0]));
        });
        this.object = object;
        return object;
      })
      .catch((error: Error) => {
        console.debug("[mic-capture] media page unavailable:", error.message);
        return null;
      });
  }

  private queue(method: string, args: unknown[] = []) {
    void this.ready.then((object) => object?.notify(method, args));
  }

  attach(stream: MediaStream): void {
    this.queue("attach", [pageRef(stream)]);
  }

  start(): void {
    this.queue("start");
  }

  stop(): void {
    this.queue("stop");
  }

  setSoftMute(muted: boolean): void {
    this.queue("setSoftMute", [muted]);
  }

  getAnalyser(): AnalyserNode | null {
    return analyserOf(this.object, "mic", this.analysers);
  }

  detach(): void {
    this.queue("detach");
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const object = await this.ready;
    this.object = null;
    this.analysers.clear();
    if (object) {
      await object.call("dispose").catch(() => undefined);
      object.drop();
    }
    this.release?.();
    this.release = null;
  }
}
