// desktop-ui's dictation records through an AudioContext and an AudioWorklet when no native
// microphone helper runs (Linux, or macOS without packages/native's mic_capture). Rune's UI realm
// has neither, so these stand-ins run that pipeline in the media page, on the page's microphone
// stream, and hand the worklet's messages back here.

import type { PageObject } from "../../host/media/media-page";
import { PageMediaStream, useMediaPage } from "./media-client";

type Pipeline = { object: PageObject; release: () => void };
type PortListener = ((event: { data: unknown }) => void) | null;

const STAND_IN = Symbol.for("stella.rune.pageAudio");

const pcmOf = (data: string) => {
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  return new Int16Array(bytes.buffer, 0, bytes.byteLength >> 1);
};

class PageAudioContext {
  state: "suspended" | "running" | "closed" = "running";
  readonly audioWorklet = { addModule: (url: string) => this.addModule(url) };
  private readonly nodes = new Set<PageAudioWorkletNode>();
  readonly pipeline: Promise<Pipeline>;

  constructor() {
    this.pipeline = useMediaPage().then(async ({ media, release }) => {
      try {
        const object = await media.create("PcmWorkletPipeline", [], (name, args) => {
          if (name !== "frame") return;
          const data = { pcm: pcmOf(String(args[0])), rms: Number(args[1]) };
          for (const node of this.nodes) node.port.onmessage?.({ data });
        });
        return { object, release };
      } catch (error) {
        release();
        throw error;
      }
    });
    void this.pipeline.catch(() => {});
  }

  private async addModule(url: string) {
    const file = new URL(url, "stella-media://page/").pathname.split("/").pop() ?? "";
    await (await this.pipeline).object.call("addModule", [file]);
  }

  async resume() {
    await (await this.pipeline).object.call("resume");
    this.state = "running";
  }

  createMediaStreamSource(stream: MediaStream) {
    return new PageMediaStreamSource(this, stream);
  }

  attach(node: PageAudioWorkletNode, stream: MediaStream) {
    if (!(stream instanceof PageMediaStream)) throw new Error("Only a microphone stream from the media page can feed this AudioContext.");
    this.nodes.add(node);
    void this.pipeline.then(({ object }) => object.call("connect", [stream.ref, node.processor, node.options])).catch((error: Error) => console.error("[page-audio] connect failed:", error.message));
  }

  detach(node: PageAudioWorkletNode) {
    if (!this.nodes.delete(node)) return;
    void this.pipeline.then(({ object }) => object.call("disconnect")).catch(() => {});
  }

  async close() {
    if (this.state === "closed") return;
    this.state = "closed";
    this.nodes.clear();
    const pipeline = await this.pipeline.catch(() => null);
    if (!pipeline) return;
    await pipeline.object.call("close").catch(() => {});
    pipeline.object.drop();
    pipeline.release();
  }
}

class PageMediaStreamSource {
  constructor(private readonly context: PageAudioContext, private readonly stream: MediaStream) {}

  connect(node: PageAudioWorkletNode) {
    this.context.attach(node, this.stream);
    return node;
  }

  disconnect() {}
}

class PageAudioWorkletNode {
  readonly port = { onmessage: null as PortListener, close() {} };

  constructor(private readonly context: PageAudioContext, readonly processor: string, readonly options: Record<string, unknown> = {}) {}

  disconnect() {
    this.context.detach(this);
  }
}

/** Installs the stand-ins where the realm has no AudioContext of its own (Rune's host; a browser keeps its own). */
export function installPageAudio() {
  const g = globalThis as Record<string, unknown>;
  const current = g.AudioContext as { [STAND_IN]?: boolean } | undefined;
  if (current && !current[STAND_IN]) return;
  Object.assign(PageAudioContext, { [STAND_IN]: true });
  g.AudioContext = PageAudioContext;
  g.AudioWorkletNode = PageAudioWorkletNode;
}
