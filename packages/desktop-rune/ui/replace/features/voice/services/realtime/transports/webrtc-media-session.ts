// desktop-ui's WebRTCMediaSession runs unchanged in the media page (a system WebView with WebRTC);
// this stand-in carries its calls there, its data-channel events back, the SDP exchange to the
// transport's fetcher here, and its analysers as page analysers.

import {
  abortReason,
  type WebRTCMediaSessionHandlers,
  type WebRTCMediaSessionOptions,
} from "@/features/voice/services/realtime/transports/webrtc-media-session";
import type { PageObject } from "../../../../../../../host/media/media-page";
import { analyserOf, pushUiState, useMediaPage, type PageAnalyser } from "../../../../../../host/media-client";

export * from "@/features/voice/services/realtime/transports/webrtc-media-session";

export class WebRTCMediaSession {
  private readonly options: WebRTCMediaSessionOptions;
  private handlers: WebRTCMediaSessionHandlers | null = null;
  private object: PageObject | null = null;
  private release: (() => void) | null = null;
  private openSignal: AbortSignal | null = null;
  private channelOpen = false;
  private micEnabled = false;
  private closed = false;
  private readonly analysers = new Map<string, PageAnalyser>();

  constructor(options: WebRTCMediaSessionOptions) {
    this.options = options;
  }

  attach(handlers: WebRTCMediaSessionHandlers): void {
    this.handlers = handlers;
  }

  detach(): void {
    this.handlers = null;
  }

  get isChannelOpen(): boolean {
    return this.channelOpen;
  }

  async open(signal: AbortSignal): Promise<void> {
    this.throwIfCanceled(signal);
    this.openSignal = signal;
    const { media, release } = await useMediaPage();
    if (this.closed || signal.aborted) {
      release();
      this.throwIfCanceled(signal);
    }
    this.release = release;
    this.object = await media.create(
      "WebRTCMediaSession",
      [{ dataChannelLabel: this.options.dataChannelLabel, logPrefix: this.options.logPrefix }],
      (name, args) => this.onEvent(name, args),
      (name, args) => {
        if (name !== "sdpFetch") throw new Error(`Unknown callback ${name}`);
        return this.options.sdpFetch(String(args[0] ?? ""), this.openSignal ?? signal);
      },
    );
    if (this.closed) {
      await this.dispose();
      this.throwIfCanceled(signal);
    }
    if (this.micEnabled) await this.object.call("setMicEnabled", [true]);
    await this.object.call("open", [], signal);
    this.throwIfCanceled(signal);
  }

  private onEvent(name: string, args: unknown[]) {
    if (this.closed) return;
    if (name === "channelOpen") {
      this.channelOpen = true;
      this.handlers?.onChannelOpen();
    } else if (name === "message") {
      this.handlers?.onMessage(args[0] as Record<string, unknown>);
    } else if (name === "channelDown") {
      this.channelOpen = false;
      this.handlers?.onChannelDown(String(args[0]), args[1] === "error" ? "error" : "close");
    } else if (name === "pageClosed") {
      const wasOpen = this.channelOpen;
      this.channelOpen = false;
      this.object = null;
      if (wasOpen) this.handlers?.onChannelDown("Data channel failed", "error");
    }
  }

  send(event: Record<string, unknown>): boolean {
    if (!this.channelOpen || !this.object) return false;
    this.object.notify("send", [event]);
    return true;
  }

  setMicEnabled(enabled: boolean): Promise<void> {
    this.micEnabled = enabled;
    const object = this.object;
    if (!object) return Promise.resolve();
    const media = globalThis.stella?.host?.media;
    if (media) pushUiState(media);
    return object.call<void>("setMicEnabled", [enabled]);
  }

  applySoftInputMute(muted: boolean): void {
    this.object?.notify("applySoftInputMute", [muted]);
  }

  getMicAnalyser(): AnalyserNode | null {
    return analyserOf(this.object, "mic", this.analysers);
  }

  getOutputAnalyser(): AnalyserNode | null {
    return analyserOf(this.object, "output", this.analysers);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.handlers = null;
    this.channelOpen = false;
    await this.dispose();
  }

  private async dispose() {
    const object = this.object;
    this.object = null;
    this.analysers.clear();
    if (object) {
      await object.call("close").catch(() => undefined);
      object.drop();
    }
    this.release?.();
    this.release = null;
  }

  private throwIfCanceled(signal: AbortSignal): void {
    if (!this.closed && !signal.aborted) return;
    throw abortReason(signal);
  }
}
