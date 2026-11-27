// What the UI's audio modules (ui/replace/features/voice/**) use to reach the media page: the
// page itself, the ui-state values its modules read, and stand-ins for the page's AnalyserNodes
// and MediaStreams.

import { uiState } from "@/platform/ui-state";
import type { MediaPage, PageObject } from "../../host/media/media-page";
import type { AnalyserFrame, HandleRef } from "../../host/media/protocol";

const UI_STATE_KEYS = ["stella-preferred-speaker-id", "stella-preferred-mic-id", "stella-mic-enabled"];

export const mediaPage = (): MediaPage | null => globalThis.stella?.host?.media ?? null;

export const voiceMediaPage = (): MediaPage | null => globalThis.stella?.host?.voice ?? null;

export const pushUiState = (media: MediaPage) =>
  media.setUiState(Object.fromEntries(UI_STATE_KEYS.map((key) => [key, uiState.getItem(key)])));

/** The running media page and the release that lets it go. */
export async function useMediaPage(page: () => MediaPage | null = mediaPage): Promise<{ media: MediaPage; release: () => void }> {
  const media = page();
  if (!media) throw new Error("Audio is unavailable in this window.");
  const release = await media.use();
  pushUiState(media);
  return { media, release };
}

const decoded = new WeakMap<AnalyserFrame, { freq: Uint8Array; time: Uint8Array }>();
const bytesOf = (data: string) => Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
const decode = (frame: AnalyserFrame) => {
  let bytes = decoded.get(frame);
  if (!bytes) decoded.set(frame, (bytes = { freq: bytesOf(frame.freq), time: bytesOf(frame.time) }));
  return bytes;
};

/** An AnalyserNode of the page (fftSize 256, as every desktop-ui analyser): its latest frame, read synchronously. */
export class PageAnalyser {
  fftSize = 256;
  minDecibels = -100;
  maxDecibels = -30;
  smoothingTimeConstant = 0.8;

  constructor(private readonly object: PageObject, private readonly name: string) {}

  get frequencyBinCount() {
    return this.fftSize / 2;
  }

  private bytes() {
    const frame = this.object.frame(this.name);
    return frame ? decode(frame) : null;
  }

  getByteFrequencyData(array: Uint8Array) {
    const bytes = this.bytes();
    if (bytes) array.set(bytes.freq.subarray(0, array.length));
    else array.fill(0);
  }

  getByteTimeDomainData(array: Uint8Array) {
    const bytes = this.bytes();
    if (bytes) array.set(bytes.time.subarray(0, array.length));
    else array.fill(128);
  }

  getFloatFrequencyData(array: Float32Array) {
    const bytes = this.bytes();
    const span = this.maxDecibels - this.minDecibels;
    for (let i = 0; i < array.length; i++) array[i] = bytes ? this.minDecibels + ((bytes.freq[i] ?? 0) / 255) * span : -Infinity;
  }

  getFloatTimeDomainData(array: Float32Array) {
    const bytes = this.bytes();
    for (let i = 0; i < array.length; i++) array[i] = bytes ? ((bytes.time[i] ?? 128) - 128) / 128 : 0;
  }

  connect() {
    return this;
  }

  disconnect() {}
}

/** The page analyser `name` of `object` once the page has one (null until then, as in desktop-ui). */
export function analyserOf(object: PageObject | null, name: string, cache: Map<string, PageAnalyser>): AnalyserNode | null {
  if (!object) return null;
  if (!object.frame(name)) return null;
  let analyser = cache.get(name);
  if (!analyser) cache.set(name, (analyser = new PageAnalyser(object, name)));
  return analyser as unknown as AnalyserNode;
}

type TrackStandIn = { kind: "audio"; enabled: boolean; readonly readyState: "live" | "ended"; stop(): void };

/** A MediaStream of the page (a microphone lease's): enough for the code that holds and stops it. */
export class PageMediaStream {
  private ended = false;
  private readonly track: TrackStandIn;

  constructor(readonly ref: HandleRef, private readonly media: MediaPage) {
    const stream = this;
    this.track = {
      kind: "audio",
      enabled: true,
      get readyState() {
        return stream.ended ? "ended" : "live";
      },
      stop: () => stream.stop(),
    };
  }

  private stop() {
    if (this.ended) return;
    this.ended = true;
    void this.media.invoke("stopStream", [this.ref]).catch(() => {});
  }

  getTracks() {
    return [this.track];
  }

  getAudioTracks() {
    return [this.track];
  }
}

export const pageRef = (value: unknown): HandleRef | unknown => (value instanceof PageMediaStream ? value.ref : value);
