// The media page's host side: mounts a system WebView on demand (ui/host/MediaWebView.tsx
// renders it in a background window while `wanted()`), serves it the page built from host/media/page, and carries calls,
// events, host callbacks, pulled byte streams and analyser frames over its message channel.
// The page stays while anything uses it and is dropped a minute after the last user leaves.

import { spawn } from "node:child_process";
import path from "node:path";
import { engine } from "../electron/engine";
import type { AnalyserFrame, FromPage, HandleRef, MediaPageCaps, ToPage } from "./protocol";

const ELEMENT_ID = "stella-media-page";
const SCHEME = "stella-media";
const PAGE_URL = `${SCHEME}://page/index.html`;
const LINGER_MS = 60_000;
const READY_TIMEOUT_MS = 15_000;
const SAMPLE_INTERVAL_MS = 33;
const SAMPLE_IDLE_MS = 500;
const BUILD_SCRIPT = path.join(import.meta.dir, "build.ts");

type Waiter = { resolve(value: unknown): void; reject(error: Error): void };
type EventSink = (name: string, args: unknown[]) => void;
type CallbackHandler = (name: string, args: unknown[]) => unknown;

export type MediaPageRequest = { rid: number; url: string };

const buildPage = () =>
  new Promise<string>((resolve, reject) => {
    const child = spawn(process.execPath, [BUILD_SCRIPT], { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => err.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(Buffer.concat(out).toString("utf8"));
      else reject(new Error(`media page build failed (${code}): ${Buffer.concat(err).toString("utf8").slice(0, 2000)}`));
    });
  });

const pageHtml = (script: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><title>Stella media</title></head><body><script>${script.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;

class MediaPage {
  private users = 0;
  private mounted = false;
  private lingerTimer: ReturnType<typeof setTimeout> | null = null;
  private readyPromise: Promise<MediaPageCaps> | null = null;
  private readyWaiter: Waiter | null = null;
  private source: Promise<string> | null = null;
  private listeners = new Set<() => void>();
  private nextId = 1;
  private nextHandle = 1;
  private pending = new Map<number, Waiter>();
  private sinks = new Map<number, EventSink>();
  private handlers = new Map<number, CallbackHandler>();
  private streams = new Map<number, ReadableStreamDefaultReader<Uint8Array>>();
  private frames = new Map<string, AnalyserFrame | null>();
  private sampleTimer: ReturnType<typeof setInterval> | null = null;
  private lastSampleWanted = 0;
  caps: MediaPageCaps | null = null;

  readonly elementId = ELEMENT_ID;
  readonly scheme = SCHEME;
  readonly url = PAGE_URL;

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  wanted() {
    return this.mounted;
  }

  /** The page has started and takes messages. */
  get running() {
    return this.mounted && this.caps !== null;
  }

  private setMounted(mounted: boolean) {
    if (this.mounted === mounted) return;
    this.mounted = mounted;
    for (const listener of this.listeners) listener();
  }

  /** Keeps the page alive until the returned release; resolves once the page runs. */
  async use(): Promise<() => void> {
    this.users++;
    if (this.lingerTimer) {
      clearTimeout(this.lingerTimer);
      this.lingerTimer = null;
    }
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.users--;
      if (this.users === 0) this.linger();
    };
    try {
      await this.ready();
    } catch (error) {
      release();
      throw error;
    }
    return release;
  }

  private linger() {
    if (this.lingerTimer) clearTimeout(this.lingerTimer);
    this.lingerTimer = setTimeout(() => {
      this.lingerTimer = null;
      if (this.users === 0) this.unmount("idle");
    }, LINGER_MS);
    this.lingerTimer.unref?.();
  }

  private unmount(reason: string) {
    this.dropPageState(reason);
    this.readyWaiter?.reject(new Error(`Media page closed (${reason}).`));
    this.readyWaiter = null;
    this.readyPromise = null;
    this.caps = null;
    this.setMounted(false);
  }

  /** Everything the page held is gone: its objects, pending calls, streams and frames. */
  private dropPageState(reason: string) {
    for (const waiter of this.pending.values()) waiter.reject(new Error(`Media page closed (${reason}).`));
    this.pending.clear();
    for (const sink of this.sinks.values()) sink("pageClosed", [reason]);
    this.sinks.clear();
    this.handlers.clear();
    for (const reader of this.streams.values()) void reader.cancel().catch(() => {});
    this.streams.clear();
    this.frames.clear();
    this.stopSampling();
  }

  private ready(): Promise<MediaPageCaps> {
    if (this.readyPromise) return this.readyPromise;
    this.source ??= buildPage().catch((error) => {
      this.source = null;
      throw error;
    });
    const promise = new Promise<MediaPageCaps>((resolve, reject) => {
      this.readyWaiter = { resolve: resolve as (value: unknown) => void, reject };
    });
    this.readyPromise = promise;
    const timer = setTimeout(() => {
      if (this.readyPromise === promise && !this.caps) this.unmount("the page did not start");
    }, READY_TIMEOUT_MS);
    timer.unref?.();
    void promise.finally(() => clearTimeout(timer)).catch(() => {});
    this.setMounted(true);
    return promise;
  }

  /** The WebView asked for the page (its custom scheme). */
  request(request: MediaPageRequest) {
    const e = engine();
    if (!e) return;
    const respond = (status: number, body: string) =>
      void e.webview.respond(request.rid, { status, headers: { "content-type": status === 200 ? "text/html; charset=utf-8" : "text/plain" }, body }).catch(() => {});
    if (!request.url.startsWith(PAGE_URL)) return respond(404, "Not found");
    (this.source ?? Promise.reject(new Error("no page")))
      .then((script) => respond(200, pageHtml(script)))
      .catch((error: Error) => {
        respond(500, error.message);
        this.unmount(error.message);
      });
  }

  /** The WebView failed to start. */
  failed(error: string) {
    this.unmount(error);
  }

  private post(message: ToPage) {
    const e = engine();
    if (!e || !this.mounted || !this.caps) throw new Error("The media page is not running.");
    void e.webview.post(ELEMENT_ID, message).catch((error: Error) => console.error("[media] post failed:", error.message));
  }

  /** A message from the page. */
  message(data: unknown) {
    let message = data as FromPage | null;
    if (typeof data === "string") {
      try { message = JSON.parse(data) as FromPage; } catch { return; }
    }
    if (!message || typeof message !== "object" || !("t" in message)) return;
    switch (message.t) {
      case "hello":
        if (this.caps) this.dropPageState("the page reloaded");
        this.caps = message.caps;
        console.error(`[media] page ready: ${JSON.stringify(message.caps)}`);
        this.readyWaiter?.resolve(message.caps);
        this.readyWaiter = null;
        return;
      case "ret": {
        const waiter = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (!waiter) return;
        if (message.ok) waiter.resolve(message.value);
        else {
          const error = new Error(message.error ?? "Media call failed");
          if (message.name) error.name = message.name;
          waiter.reject(error);
        }
        return;
      }
      case "event":
        this.sinks.get(message.handle)?.(message.name, message.args);
        return;
      case "cb": {
        const handler = this.handlers.get(message.handle);
        const reply = (ok: boolean, value?: unknown, error?: string) => {
          if (this.running) this.post({ t: "cbret", id: message.id, ok, value, error });
        };
        if (!handler) return reply(false, undefined, "No host handler");
        Promise.resolve()
          .then(() => handler(message.name, message.args))
          .then((value) => reply(true, value), (error: Error) => reply(false, undefined, error?.message ?? String(error)));
        return;
      }
      case "pull":
        return this.pull(message.stream);
      case "samples":
        for (const [key, frame] of Object.entries(message.frames)) this.frames.set(key, frame);
        return;
      case "log":
        console.error(`[media] ${message.level}: ${message.text}`);
        return;
    }
  }

  private call<T>(handle: number, method: string, args: unknown[], signal?: AbortSignal): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      if (signal) {
        const abort = () => this.running && this.post({ t: "abort", id });
        if (signal.aborted) abort();
        else signal.addEventListener("abort", abort, { once: true });
      }
      try {
        this.post({ t: "call", id, handle, method, args });
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  /** A module function in the page (voice cues, read-aloud, the shared microphone). */
  invoke<T = unknown>(method: string, args: unknown[] = [], signal?: AbortSignal): Promise<T> {
    return this.call<T>(0, method, args, signal);
  }

  /** Events of page-level functions (read-aloud playing state and ends). */
  onFunctionEvent(sink: EventSink) {
    this.sinks.set(0, sink);
  }

  /** A page object of `cls`; `events` hears its events, `callbacks` answers its calls to the host. */
  async create(cls: string, args: unknown[], events: EventSink, callbacks?: CallbackHandler): Promise<PageObject> {
    const handle = this.nextHandle++;
    this.sinks.set(handle, events);
    if (callbacks) this.handlers.set(handle, callbacks);
    const id = this.nextId++;
    await new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.post({ t: "new", id, handle, cls, args });
    });
    return new PageObject(this, handle);
  }

  /** @internal */
  callOn<T>(handle: number, method: string, args: unknown[], signal?: AbortSignal) {
    return this.call<T>(handle, method, args, signal);
  }

  /** @internal */
  notifyOn(handle: number, method: string, args: unknown[]) {
    if (!this.running) return;
    void this.call(handle, method, args).catch(() => {});
  }

  /** @internal */
  drop(handle: number) {
    this.sinks.delete(handle);
    this.handlers.delete(handle);
    for (const key of this.frames.keys()) if (key.startsWith(`${handle}:`)) this.frames.delete(key);
    if (this.running) this.post({ t: "drop", handle });
  }

  setUiState(values: Record<string, string | null>) {
    if (this.running) this.post({ t: "state", values });
  }

  /** A byte stream the page reads as a `Response` body; returns its id for a call's arguments. */
  openStream(body: ReadableStream<Uint8Array>): number {
    const id = this.nextHandle++;
    this.streams.set(id, body.getReader());
    return id;
  }

  private pull(stream: number) {
    if (stream < 0) {
      const reader = this.streams.get(-stream);
      this.streams.delete(-stream);
      void reader?.cancel().catch(() => {});
      return;
    }
    const reader = this.streams.get(stream);
    if (!reader) return;
    reader.read().then(
      ({ done, value }) => {
        if (!this.running) return;
        if (done) {
          this.streams.delete(stream);
          this.post({ t: "chunk", stream, done: true });
        } else {
          this.post({ t: "chunk", stream, data: value ? Buffer.from(value).toString("base64") : "" });
        }
      },
      (error: Error) => {
        this.streams.delete(stream);
        if (this.running) this.post({ t: "chunk", stream, error: error?.message ?? String(error) });
      },
    );
  }

  /** The latest analyser frame of a page object's analyser; asks the page for fresh ones while read. */
  frame(handle: number, name: string): AnalyserFrame | null | undefined {
    this.lastSampleWanted = Date.now();
    this.startSampling();
    return this.frames.get(`${handle}:${name}`);
  }

  private startSampling() {
    if (this.sampleTimer || !this.running) return;
    this.sampleTimer = setInterval(() => {
      if (!this.running || Date.now() - this.lastSampleWanted > SAMPLE_IDLE_MS) return this.stopSampling();
      this.post({ t: "sample" });
    }, SAMPLE_INTERVAL_MS);
    this.post({ t: "sample" });
  }

  private stopSampling() {
    if (this.sampleTimer) clearInterval(this.sampleTimer);
    this.sampleTimer = null;
  }
}

export class PageObject {
  constructor(private readonly page: MediaPage, readonly handle: number) {}

  call<T = unknown>(method: string, args: unknown[] = [], signal?: AbortSignal) {
    return this.page.callOn<T>(this.handle, method, args, signal);
  }

  notify(method: string, args: unknown[] = []) {
    this.page.notifyOn(this.handle, method, args);
  }

  frame(name: string) {
    return this.page.frame(this.handle, name);
  }

  get ref(): HandleRef {
    return { $h: this.handle };
  }

  drop() {
    this.page.drop(this.handle);
  }
}

export type { MediaPage };
export const mediaPage = new MediaPage();
