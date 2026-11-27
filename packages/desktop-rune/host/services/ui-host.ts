// `globalThis.stella.host`: what the UI's root needs to render Electron main's windows. The window
// registry, each window's electronAPI, the message-box queue main raises, and the plumbing of web
// windows' `<webview>`s (custom schemes, navigation, executeJavaScript).

import path from "node:path";
import { blob, freeBlob } from "../bridge";
import { BrowserWindow, hostWindows, openWindowFrom, type WindowSnapshot } from "../electron/browser-window";
import { engine } from "../electron/engine";
import { hostDialogs, type HostDialogRequest } from "../electron/native";
import { defaultSession, fetchProtocolIn } from "../electron/session";
import { WebContents } from "../electron/web-contents";
import type { PageKey, PagePointer, PageWheel } from "../electron/chromium-page";
import { rendererApiFor, type ElectronApi } from "./renderer-api";
import { mediaPage, voicePage, type MediaPage } from "../media/media-page";
import type { P2pApi } from "@stella/contracts/p2p";
import { p2pApi } from "./p2p";

export type ImagePreview = { dataUrl: string; width: number; height: number };

export type HostMessageBox = Omit<HostDialogRequest, "resolve">;

export type WebviewRequest = { rid: number; scheme: string; url: string; method: string; headers: Record<string, string>; body?: string | null };

export type UiHost = {
  /** The WebView running desktop-ui's WebRTC, WebAudio and MediaSource modules (ui/host/MediaWebView.tsx). */
  media: MediaPage;
  /** The page realtime voice runs in: `media`, or on Linux its own page in the on-demand Chromium. */
  voice: MediaPage;
  /** An image file decoded off the UI thread and scaled to fit `maxEdge`: a WebP data URL and the full image's size, or null when it isn't an image. */
  imagePreview(file: string, maxEdge: number): Promise<ImagePreview | null>;
  windows: { subscribe(listener: () => void): () => void; snapshot(): WindowSnapshot[] };
  apiFor(windowId: string): ElectronApi | null;
  /** Pairing with phones and other computers directly, without an account (services/p2p). */
  p2p: P2pApi;
  /** Focus changes of a host window (a DOM window's `focus` / `blur` for an aux window's tree); returns the stop. */
  onFocusChange(windowId: string, listener: (focused: boolean) => void): () => void;
  isFocused(windowId: string): boolean;
  /** window.open from the page in `openerId` (a viewer window, an auth popup); main's open handler decides. */
  open(openerId: string, url: string, frameName?: string, features?: string): string | null;
  /** The UI mounted / unmounted the `<window>` with this engine id. */
  mounted(engineId: string): void;
  unmounted(engineId: string): void;
  dialogs: {
    subscribe(listener: () => void): () => void;
    pending(): HostMessageBox[];
    answer(id: number, response: number, checkboxChecked?: boolean): void;
  };
  web: {
    /** The `<webview id>` of a web window's contents. */
    elementId(contentsId: number): string;
    /** Custom schemes the contents' session serves; without a contents (a UI-owned `<webview>`), the default session's. */
    schemes(contentsId?: number): string[];
    request(contentsId: number | undefined, request: WebviewRequest): void;
    /** A navigation the page made; only one the engine marks `mainFrame` counts (WKWebView asks for iframes too and can't say which). */
    navigated(contentsId: number, url: string, mainFrame?: boolean): void;
    titled(contentsId: number, title: string): void;
    /** The page's main-frame load `started` (at `url`) or `finished`. */
    /** `kept`: a remount kept the page; it reports its finished load again without loading. */
    loaded(contentsId: number, phase: string, url?: string, kept?: boolean): void;
    message(contentsId: number, data: unknown): void;
  };
  browser: {
    /**
     * The frames of a Chromium-backed contents (an in-app browser tab, a popup) as `blob:N` image
     * sources while the UI shows it; returns the stop.
     */
    frames(contentsId: number, listener: (src: string) => void, maxSize?: { width: number; height: number }): () => void;
    /** Electron input events (sendInputEvent shapes) for the page. */
    input(contentsId: number, event: Record<string, unknown>): void;
    /** A `<surface>`'s pointer, wheel and key events, in the page's CSS px. */
    surface(contentsId: number, event: { pointer: PagePointer } | { wheel: PageWheel } | { key: PageKey }): void;
    insertText(contentsId: number, text: string): void;
    focus(contentsId: number): void;
  };
};

const FRAME_INTERVAL_MS = 1000 / 60;

let previewWorker: Worker | null = null;
let previewSeq = 0;
const previewWaiters = new Map<number, (preview: ImagePreview | null) => void>();

function imagePreview(file: string, maxEdge: number): Promise<ImagePreview | null> {
  if (!previewWorker) {
    previewWorker = new Worker(path.join(import.meta.dir, "image-preview-worker.ts"));
    previewWorker.onmessage = (e: MessageEvent<{ id: number; preview: ImagePreview | null }>) => {
      previewWaiters.get(e.data.id)?.(e.data.preview);
      previewWaiters.delete(e.data.id);
    };
    (previewWorker as Worker & { unref(): void }).unref();
  }
  const id = ++previewSeq;
  return new Promise((resolve) => {
    previewWaiters.set(id, resolve);
    previewWorker!.postMessage({ id, file, maxEdge });
  });
}

const STANDARD_SCHEMES = new Set(["http", "https", "file", "data", "blob", "about", "javascript", "ws", "wss"]);

const contentsById = (id: number) => {
  for (const win of BrowserWindow.getAllWindows()) if (win.webContents.id === id) return win.webContents;
  return WebContents.fromId(id);
};

/** The renderer's session (Electron main registers the app's schemes on its partition), for webviews the UI owns. */
const rendererSession = () => {
  const windows = BrowserWindow.getAllWindows().filter((win) => !win.isDestroyed() && win.webContents.kind === "app");
  return (windows.find((win) => win.webContents.id === hostWindows.snapshot().find((w) => w.engineId === "main")?.contentsId) ?? windows[0])?.webContents.session;
};

function streamFrames(contentsId: number, listener: (src: string) => void, maxSize?: { width: number; height: number }) {
  const contents = WebContents.fromId(contentsId);
  if (!contents?.isBrowserBacked) return () => {};
  let latest: Uint8Array | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastPush = 0;
  let current = 0;
  let stopped = false;
  const push = () => {
    timer = null;
    if (stopped || !latest) return;
    const previous = current;
    current = blob(latest);
    latest = null;
    lastPush = performance.now();
    listener(`blob:${current}`);
    if (previous) freeBlob(previous);
  };
  const stop = contents.streamFrames((frame) => {
    latest = frame.jpeg;
    if (timer) return;
    timer = setTimeout(push, Math.max(0, FRAME_INTERVAL_MS - (performance.now() - lastPush)));
  }, maxSize);
  return () => {
    stopped = true;
    stop();
    if (timer) clearTimeout(timer);
    if (current) freeBlob(current);
  };
}

const elementId = (contentsId: number) => `web-${contentsId}`;

const pendingEvals = new Map<string, { resolve(value: unknown): void; reject(error: Error): void }>();
let nextEval = 1;
const VIEW_WAIT_MS = 30_000;
const viewWaiters = new Map<number, Set<() => void>>();

function viewAppeared(contentsId: number) {
  const waiters = viewWaiters.get(contentsId);
  if (!waiters) return;
  viewWaiters.delete(contentsId);
  for (const wake of waiters) wake();
}

function nextViewEvent(contentsId: number): Promise<void> {
  return new Promise((resolve) => {
    const waiters = viewWaiters.get(contentsId) ?? new Set();
    viewWaiters.set(contentsId, waiters);
    const wake = () => { clearTimeout(timer); waiters.delete(wake); resolve(); };
    const timer = setTimeout(wake, VIEW_WAIT_MS);
    waiters.add(wake);
  });
}

export function createUiHost(): UiHost {
  let dialogCache: HostMessageBox[] | null = null;
  const dialogListeners = new Set<() => void>();
  const dialogsChanged = () => {
    dialogCache = null;
    for (const listener of [...dialogListeners]) listener();
  };
  const onRequest = () => dialogsChanged();

  WebContents.host.onNavigate = () => hostWindows.changed();
  WebContents.host.evaluateWeb = async (contents, code) => {
    const e = engine();
    if (!e) throw new Error("No engine to run page scripts in.");
    const id = `e${nextEval++}`;
    const wrapped = `(async () => { let m; try { m = { __runeEval: ${JSON.stringify(id)}, ok: true, value: await (0, eval)(${JSON.stringify(code)}) }; } catch (error) { m = { __runeEval: ${JSON.stringify(id)}, ok: false, error: String(error && error.message || error) }; } const send = () => window.ipc.postMessage(JSON.stringify({ data: m, targetOrigin: "*" })); try { send(); } catch (_) { m.value = null; send(); } })();`;
    const result = new Promise<unknown>((resolve, reject) => pendingEvals.set(id, { resolve, reject }));
    const deadline = Date.now() + VIEW_WAIT_MS;
    for (;;) {
      try {
        await e.webview.eval(elementId(contents.id), wrapped);
        return await result;
      } catch (error) {
        const missing = (error as Error).message === "no such webview";
        if (!missing || contents.isDestroyed() || Date.now() >= deadline) {
          pendingEvals.delete(id);
          throw error;
        }
        await nextViewEvent(contents.id);
      }
    }
  };

  return {
    media: mediaPage,
    voice: voicePage,
    imagePreview,
    windows: { subscribe: hostWindows.subscribe, snapshot: hostWindows.snapshot },
    apiFor(windowId) {
      const win = hostWindows.get(windowId);
      return win ? rendererApiFor(win.webContents) : null;
    },
    p2p: p2pApi(),
    onFocusChange(windowId, listener) {
      const win = hostWindows.get(windowId);
      if (!win) return () => {};
      const focus = () => listener(true);
      const blur = () => listener(false);
      win.on("focus", focus);
      win.on("blur", blur);
      return () => {
        win.off("focus", focus);
        win.off("blur", blur);
      };
    },
    isFocused: (windowId) => hostWindows.get(windowId)?.isFocused() ?? false,
    open(openerId, url, frameName = "", features = "") {
      const opener = hostWindows.get(openerId);
      return opener ? openWindowFrom(opener, url, frameName, features)?.hostId ?? null : null;
    },
    mounted: (id) => hostWindows.mounted(id),
    unmounted: (id) => hostWindows.unmounted(id),
    dialogs: {
      subscribe(listener) {
        if (dialogListeners.size === 0) {
          hostDialogs.on("request", onRequest);
          hostDialogs.on("resolved", onRequest);
        }
        dialogListeners.add(listener);
        return () => {
          dialogListeners.delete(listener);
          if (dialogListeners.size === 0) {
            hostDialogs.off("request", onRequest);
            hostDialogs.off("resolved", onRequest);
          }
        };
      },
      pending() {
        dialogCache ??= [...hostDialogs.pending.values()].map(({ resolve: _resolve, ...view }) => view);
        return dialogCache;
      },
      answer(id, response, checkboxChecked = false) {
        hostDialogs.pending.get(id)?.resolve({ response, checkboxChecked });
      },
    },
    web: {
      elementId,
      schemes(contentsId) {
        const contents = contentsId === undefined ? undefined : contentsById(contentsId);
        const schemes = new Set<string>();
        for (const session of [contents?.session ?? rendererSession(), defaultSession()]) {
          for (const scheme of session?.protocol.handlers.keys() ?? []) if (!STANDARD_SCHEMES.has(scheme)) schemes.add(scheme);
        }
        return [...schemes];
      },
      request(contentsId, req) {
        const e = engine();
        if (!e) return;
        const respond = (status: number, headers: Record<string, string>, body: string | Uint8Array) => void e.webview.respond(req.rid, { status, headers, body }).catch(() => {});
        const session = contentsId === undefined ? rendererSession() ?? defaultSession() : contentsById(contentsId)?.session;
        if (!session) return respond(404, {}, "");
        const hasBody = req.body !== undefined && req.method !== "GET" && req.method !== "HEAD";
        fetchProtocolIn(session, new Request(req.url, { method: req.method, headers: req.headers, body: hasBody ? req.body ?? undefined : undefined }))
          .then(async (response) => {
            if (!response) return respond(404, { "content-type": "text/plain" }, "Not found");
            const headers: Record<string, string> = {};
            response.headers.forEach((value, key) => { headers[key] = value; });
            respond(response.status, headers, new Uint8Array(await response.arrayBuffer()));
          })
          .catch((error) => respond(500, { "content-type": "text/plain" }, String(error)));
      },
      navigated(contentsId, url, mainFrame) {
        if (mainFrame === true) contentsById(contentsId)?.markNavigated(url);
      },
      titled(contentsId, title) {
        contentsById(contentsId)?.setTitle(title);
        hostWindows.changed();
      },
      loaded(contentsId, phase, url, kept) {
        viewAppeared(contentsId);
        if (kept) return;
        if (phase === "started" && url) contentsById(contentsId)?.markNavigated(url);
        if (phase === "finished") contentsById(contentsId)?.markLoaded();
      },
      message(_contentsId, data) {
        let parsed: unknown = data;
        if (typeof data === "string") { try { parsed = JSON.parse(data); } catch {} }
        const m = parsed as { __runeEval?: string; ok?: boolean; value?: unknown; error?: string } | null;
        if (!m?.__runeEval) return;
        const waiter = pendingEvals.get(m.__runeEval);
        pendingEvals.delete(m.__runeEval);
        if (m.ok) waiter?.resolve(m.value);
        else waiter?.reject(new Error(m.error ?? "Script failed"));
      },
    },
    browser: {
      frames: streamFrames,
      input(contentsId, event) { WebContents.fromId(contentsId)?.sendInputEvent(event); },
      surface(contentsId, event) { WebContents.fromId(contentsId)?.surfaceInput(event); },
      insertText(contentsId, text) { void WebContents.fromId(contentsId)?.insertText(text).catch(() => {}); },
      focus(contentsId) { WebContents.fromId(contentsId)?.focus(); },
    },
  };
}
