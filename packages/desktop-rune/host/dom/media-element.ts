// HTMLMediaElement / HTMLAudioElement / Audio for audio files: playback through the native player
// (AVPlayer on macOS) with Chromium's setSinkId semantics over CoreAudio output UIDs. Elsewhere,
// play() ends at once, as before.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { audioDevices } from "../electron/macos-media";
import { playAudioFile, type NativeAudioPlayback } from "../electron/macos-audio-player";

const PUBLIC_DIR = path.resolve(import.meta.dir, "../../../desktop-ui/public");
const FETCHED_DIR = path.join(os.tmpdir(), "stella-rune-audio");
const EVENT_HANDLERS = ["play", "playing", "pause", "ended", "error", "loadstart", "loadeddata", "canplay", "canplaythrough", "volumechange", "timeupdate", "emptied"];

const extensionFor = (type: string, url: string) => {
  const fromUrl = /\.(mp3|wav|m4a|aac|aiff?|caf|ogg|flac|mp4)(?:$|[?#])/i.exec(url)?.[1];
  if (fromUrl) return fromUrl.toLowerCase();
  if (type.includes("wav")) return "wav";
  if (type.includes("mp4") || type.includes("aac") || type.includes("m4a")) return "m4a";
  return "mp3";
};

async function localFile(src: string, base: string): Promise<string> {
  const url = new URL(src, base);
  if (url.protocol === "file:") return fileURLToPath(url);
  if (url.origin === new URL(base).origin) {
    const file = path.join(PUBLIC_DIR, decodeURIComponent(url.pathname));
    if (file.startsWith(PUBLIC_DIR) && existsSync(file)) return file;
  }
  const response = await fetch(url.href);
  if (!response.ok) throw new Error(`${response.status} for ${url.href.slice(0, 80)}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const name = `${createHash("sha256").update(bytes).digest("hex").slice(0, 24)}.${extensionFor(response.headers.get("content-type") ?? "", url.href)}`;
  mkdirSync(FETCHED_DIR, { recursive: true });
  const file = path.join(FETCHED_DIR, name);
  if (!existsSync(file)) writeFileSync(file, bytes);
  return file;
}

const outputUid = (sinkId: string) => (sinkId === "" || sinkId === "default" ? null : sinkId);

export function installMediaElements(g: Record<string, any>, baseUrl: () => string) {
  class HTMLMediaElement extends EventTarget {
    src = "";
    preload = "auto";
    autoplay = false;
    loop = false;
    paused = true;
    ended = false;
    duration = NaN;
    readyState = 0;
    error: { code: number; message: string } | null = null;
    #volume = 1;
    #muted = false;
    #sinkId = "";
    #playback: NativeAudioPlayback | null = null;
    #offset = 0;

    get volume() { return this.#volume; }
    set volume(value: number) {
      this.#volume = Math.max(0, Math.min(1, Number(value)));
      this.#playback?.setVolume(this.#muted ? 0 : this.#volume);
      this.#emit("volumechange");
    }
    get muted() { return this.#muted; }
    set muted(value: boolean) {
      this.#muted = Boolean(value);
      this.#playback?.setVolume(this.#muted ? 0 : this.#volume);
      this.#emit("volumechange");
    }
    get currentTime() { return this.#offset + (this.#playback?.elapsedSeconds ?? 0); }
    set currentTime(value: number) {
      if (Number(value) === 0 && this.#playback) { this.#playback.stop(); this.#playback = null; this.paused = true; }
      this.#offset = 0;
    }
    get sinkId() { return this.#sinkId; }

    async setSinkId(sinkId: string) {
      const id = String(sinkId ?? "");
      if (outputUid(id) && !audioDevices().some((d) => d.kind === "audiooutput" && d.deviceId === id)) {
        throw new DOMException(`Requested device not found: ${id}`, "NotFoundError");
      }
      this.#sinkId = id;
      this.#playback?.setOutput(outputUid(id));
    }

    async play() {
      if (this.#playback && !this.paused) return;
      if (this.#playback) {
        this.#playback.resume();
        this.paused = false;
        this.#emit("play");
        this.#emit("playing");
        return;
      }
      this.paused = false;
      this.ended = false;
      this.#emit("play");
      let file: string;
      try {
        if (!this.src) throw new Error("No source");
        file = await localFile(this.src, baseUrl());
      } catch (error) {
        this.#fail(error);
        throw new DOMException("Failed to load because no supported source was found.", "NotSupportedError");
      }
      const playback = playAudioFile(file, { volume: this.#muted ? 0 : this.#volume, deviceUid: outputUid(this.#sinkId) });
      if (!playback) {
        this.paused = true;
        this.ended = true;
        this.#emit("ended");
        return;
      }
      this.#playback = playback;
      this.readyState = 4;
      void playback.finished.then((end) => {
        if (this.#playback !== playback) return;
        this.#playback = null;
        if (end === "failed") return this.#fail(new Error("The audio could not be played."));
        if (end !== "ended") return;
        if (this.loop) { this.paused = true; void this.play().catch(() => {}); return; }
        this.paused = true;
        this.ended = true;
        this.#emit("pause");
        this.#emit("ended");
      });
      if (!(await playback.playing)) throw new DOMException("The audio could not be played.", "NotSupportedError");
      this.#emit("playing");
    }

    pause() {
      if (this.paused) return;
      this.paused = true;
      this.#playback?.pause();
      this.#emit("pause");
    }

    load() {
      this.#playback?.stop();
      this.#playback = null;
      this.paused = true;
      this.#emit("emptied");
    }

    canPlayType(type: string) { return /^audio\//i.test(type) ? "maybe" : ""; }

    #fail(error: unknown) {
      this.paused = true;
      this.error = { code: 4, message: error instanceof Error ? error.message : String(error) };
      this.#emit("error");
    }

    #emit(type: string) {
      const event = new Event(type);
      this.dispatchEvent(event);
      const handler = (this as unknown as Record<string, unknown>)[`on${type}`];
      if (typeof handler === "function") handler.call(this, event);
    }
  }
  for (const type of EVENT_HANDLERS) (HTMLMediaElement.prototype as unknown as Record<string, unknown>)[`on${type}`] = null;

  class HTMLAudioElement extends HTMLMediaElement {}
  class Audio extends HTMLAudioElement {
    constructor(src?: string) { super(); if (src) this.src = src; }
  }
  g.HTMLMediaElement = HTMLMediaElement;
  g.HTMLAudioElement = HTMLAudioElement;
  g.Audio = Audio;
}
