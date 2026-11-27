// desktop-ui's PcmPlayer (scheduled WebAudio PCM playback) runs in the media page.

import type { PcmPlayerOptions } from "@/features/voice/services/realtime/audio-pipeline/pcm-player";
import type { PageObject } from "../../../../../../../host/media/media-page";
import { analyserOf, pushUiState, useMediaPage, type PageAnalyser } from "../../../../../../host/media-client";

export * from "@/features/voice/services/realtime/audio-pipeline/pcm-player";

export class PcmPlayer {
  private object: PageObject | null = null;
  private readonly ready: Promise<PageObject | null>;
  private release: (() => void) | null = null;
  private readonly analysers = new Map<string, PageAnalyser>();

  constructor(options: PcmPlayerOptions) {
    this.ready = useMediaPage()
      .then(async ({ media, release }) => {
        this.release = release;
        pushUiState(media);
        const object = await media.create("PcmPlayer", [{ inputSampleRate: options.inputSampleRate }], (name) => {
          if (name === "speakingStart") options.onSpeakingStart?.();
          else if (name === "speakingEnd") options.onSpeakingEnd?.();
        });
        this.object = object;
        return object;
      })
      .catch((error: Error) => {
        console.debug("[pcm-player] media page unavailable:", error.message);
        return null;
      });
  }

  pushBase64Pcm16(base64: string): void {
    void this.ready.then((object) => object?.notify("pushBase64Pcm16", [base64]));
  }

  flush(): void {
    void this.ready.then((object) => object?.notify("flush"));
  }

  getAnalyser(): AnalyserNode | null {
    return analyserOf(this.object, "output", this.analysers);
  }

  async dispose(): Promise<void> {
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
