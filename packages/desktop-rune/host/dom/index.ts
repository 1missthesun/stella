// Browser globals for desktop-ui's logic modules running in the Bun host: window, document
// (documentElement with classList/dataset/style), matchMedia, storage, animation frames,
// navigator.clipboard, location/history, observers. Nothing here renders; the engine draws.

import { createDomDocument, DomElement, type DomDocument } from "./document";
import { createMatchMedia, type MediaEnvironment } from "./media";
import { MemoryStorage, UiStateStorage, type UiStateBackend } from "./storage";
import { audioDevices } from "../electron/audio-player";
import { installIntlGlue } from "./intl";
import { installMediaElements } from "./media-element";
import { installTaskWebSocket } from "./websocket";

export type DomAppearance = { dark: boolean; reducedMotion?: boolean; highContrast?: boolean };
export type DomViewport = { width: number; height: number; devicePixelRatio: number; x?: number; y?: number };

export type DomHostOptions = {
  url: string;
  appearance: DomAppearance;
  viewport: DomViewport;
  uiState?: UiStateBackend;
  clipboard?: DomClipboard;
  openExternal?: (url: string) => void;
  /** window.open; returns null like a blocked popup when absent or refused. */
  open?: (url: string, target: string, features: string) => unknown;
  reload?: () => void;
};

export type DomClipboard = {
  readText(): Promise<string>;
  writeText(text: string): Promise<void>;
  readImagePng?(): Promise<Uint8Array | null>;
  writeImagePng?(png: Uint8Array): Promise<void>;
};

export type DomHost = {
  document: DomDocument;
  setAppearance(next: Partial<DomAppearance>): void;
  setViewport(next: Partial<DomViewport>): void;
  setVisible(visible: boolean): void;
  setFocused(focused: boolean): void;
  appearance(): DomAppearance;
};

let installed: DomHost | null = null;

export function domHost(): DomHost | null {
  return installed;
}

export function installDom(options: DomHostOptions): DomHost {
  if (installed) return installed;
  installIntlGlue();
  installTaskWebSocket();
  const g = globalThis as Record<string, any>;
  const env: MediaEnvironment = {
    appearance: { reducedMotion: false, highContrast: false, ...options.appearance },
    viewport: { x: 0, y: 0, ...options.viewport },
  };
  const media = createMatchMedia(env);
  const document = createDomDocument({ title: "Stella" });
  let focused = true;
  let visible = true;

  const fire = (target: { dispatchEvent(e: Event): boolean }, type: string) => target.dispatchEvent(new Event(type));

  g.window = g;
  g.document = document;
  g.matchMedia = media.matchMedia;
  g.localStorage = options.uiState ? new UiStateStorage(options.uiState) : new MemoryStorage();
  g.sessionStorage = new MemoryStorage();
  g.location = createLocation(options.url, () => options.reload?.());
  g.history = createHistory(() => fire(g as any, "popstate"));
  g.getComputedStyle = (el: DomElement) => el?.style ?? document.documentElement.style;
  g.getSelection = () => document.getSelection();
  g.open = (url?: string | URL, target?: string, features?: string) => {
    if (options.open) return options.open(url === undefined ? "about:blank" : String(url), target ?? "", features ?? "");
    if (url) options.openExternal?.(String(url));
    return null;
  };
  g.focus = () => {};
  g.blur = () => {};
  g.scrollTo = () => {};
  g.scrollBy = () => {};
  g.print = () => {};
  g.alert = (message?: unknown) => console.error("[dom] alert:", message);
  g.confirm = () => false;
  g.prompt = () => null;
  g.frames = g;
  g.parent = g;
  g.top = g;
  g.opener = null;
  g.name = "";
  g.isSecureContext = true;
  g.origin = new URL(options.url).origin;
  defineViewport(g, env);

  installAnimationFrames(g);
  installObservers(g);
  installMediaElements(g, () => g.location.href);
  installElementClasses(g);
  installNavigator(g, options);
  g.CSS ??= { supports: () => false, escape: (value: string) => String(value).replace(/[^\w-]/g, (c) => `\\${c}`) };

  installed = {
    document,
    appearance: () => ({ ...env.appearance }),
    setAppearance(next) {
      const before = { ...env.appearance };
      Object.assign(env.appearance, next);
      media.reevaluate(before.dark !== env.appearance.dark || before.reducedMotion !== env.appearance.reducedMotion || before.highContrast !== env.appearance.highContrast);
    },
    setViewport(next) {
      const resized = (next.width !== undefined && next.width !== env.viewport.width) || (next.height !== undefined && next.height !== env.viewport.height);
      const rescaled = next.devicePixelRatio !== undefined && next.devicePixelRatio !== env.viewport.devicePixelRatio;
      Object.assign(env.viewport, next);
      if (resized || rescaled) media.reevaluate(true);
      if (resized) fire(g as any, "resize");
    },
    setVisible(next) {
      if (visible === next) return;
      visible = next;
      document.visibilityState = next ? "visible" : "hidden";
      fire(document, "visibilitychange");
    },
    setFocused(next) {
      if (focused === next) return;
      focused = next;
      document.focused = next;
      fire(g as any, next ? "focus" : "blur");
    },
  };
  return installed;
}

function defineViewport(g: Record<string, any>, env: MediaEnvironment) {
  const v = env.viewport;
  const read = (get: () => number) => ({ get, configurable: true });
  Object.defineProperties(g, {
    innerWidth: read(() => v.width),
    innerHeight: read(() => v.height),
    outerWidth: read(() => v.width),
    outerHeight: read(() => v.height),
    devicePixelRatio: read(() => v.devicePixelRatio),
    screenX: read(() => v.x ?? 0),
    screenY: read(() => v.y ?? 0),
    screenLeft: read(() => v.x ?? 0),
    screenTop: read(() => v.y ?? 0),
    scrollX: read(() => 0),
    scrollY: read(() => 0),
    pageXOffset: read(() => 0),
    pageYOffset: read(() => 0),
  });
  g.screen ??= {
    get width() { return v.width; },
    get height() { return v.height; },
    get availWidth() { return v.width; },
    get availHeight() { return v.height; },
    colorDepth: 24,
    pixelDepth: 24,
    orientation: { type: "landscape-primary", angle: 0, addEventListener() {}, removeEventListener() {} },
  };
}

const FRAME_MS = 1000 / 60;

function installAnimationFrames(g: Record<string, any>) {
  let nextHandle = 1;
  const frameCallbacks = new Map<number, (t: number) => void>();
  let frameTimer: ReturnType<typeof setTimeout> | null = null;
  const runFrame = () => {
    frameTimer = null;
    const callbacks = [...frameCallbacks.values()];
    frameCallbacks.clear();
    const t = performance.now();
    for (const cb of callbacks) {
      try { cb(t); } catch (error) { console.error("[dom] animation frame callback failed:", error); }
    }
  };
  g.requestAnimationFrame = (cb: (t: number) => void) => {
    const handle = nextHandle++;
    frameCallbacks.set(handle, cb);
    if (!frameTimer) {
      const now = performance.now();
      frameTimer = setTimeout(runFrame, Math.max(0, FRAME_MS - (now % FRAME_MS)));
    }
    return handle;
  };
  g.cancelAnimationFrame = (handle: number) => { frameCallbacks.delete(handle); };

  const idle = new Map<number, ReturnType<typeof setTimeout>>();
  g.requestIdleCallback = (cb: (deadline: { didTimeout: boolean; timeRemaining(): number }) => void, opts?: { timeout?: number }) => {
    const handle = nextHandle++;
    const start = performance.now();
    idle.set(handle, setTimeout(() => {
      idle.delete(handle);
      cb({ didTimeout: false, timeRemaining: () => Math.max(0, 50 - (performance.now() - start)) });
    }, Math.min(opts?.timeout ?? 1, 50)));
    return handle;
  };
  g.cancelIdleCallback = (handle: number) => {
    const timer = idle.get(handle);
    if (timer) clearTimeout(timer);
    idle.delete(handle);
  };
}

function installObservers(g: Record<string, any>) {
  class InertObserver {
    constructor(_callback?: unknown, _options?: unknown) {}
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  }
  g.ResizeObserver ??= InertObserver;
  g.IntersectionObserver ??= InertObserver;
  g.MutationObserver ??= InertObserver;
  g.PerformanceObserver ??= class extends InertObserver { static supportedEntryTypes = []; };
}

function installElementClasses(g: Record<string, any>) {
  for (const name of [
    "Node", "Element", "HTMLElement", "SVGElement", "HTMLDivElement", "HTMLSpanElement", "HTMLInputElement",
    "HTMLTextAreaElement", "HTMLButtonElement", "HTMLAnchorElement", "HTMLImageElement", "HTMLVideoElement",
    "HTMLAudioElement", "HTMLMediaElement", "HTMLCanvasElement", "HTMLIFrameElement", "HTMLFormElement",
    "HTMLSelectElement", "HTMLLabelElement", "HTMLScriptElement", "HTMLStyleElement", "HTMLLinkElement",
    "HTMLBodyElement", "HTMLHtmlElement", "HTMLHeadElement", "DocumentFragment", "Text", "Comment",
  ]) {
    g[name] ??= DomElement;
  }
  g.Document ??= Object.getPrototypeOf(g.document).constructor;
  g.HTMLDocument ??= g.Document;
  g.Window ??= Object;
  g.DOMParser ??= class { parseFromString() { return createDomDocument({ title: "" }); } };
  g.Image ??= class extends DomElement {
    constructor(width?: number, height?: number) {
      super("img");
      if (width) this.setAttribute("width", String(width));
      if (height) this.setAttribute("height", String(height));
    }
  };
}

function installNavigator(g: Record<string, any>, options: DomHostOptions) {
  const nav = g.navigator as Record<string, any>;
  const define = (key: string, value: unknown) => {
    try { Object.defineProperty(nav, key, { value, configurable: true, writable: true }); } catch {}
  };
  const locale = Intl.DateTimeFormat().resolvedOptions().locale || "en-US";
  define("language", locale);
  define("languages", [locale]);
  define("onLine", true);
  define("cookieEnabled", false);
  define("maxTouchPoints", 0);
  define("platform", process.platform === "darwin" ? "MacIntel" : process.platform === "win32" ? "Win32" : "Linux x86_64");
  define("userAgentData", { platform: process.platform === "darwin" ? "macOS" : process.platform === "win32" ? "Windows" : "Linux", mobile: false, brands: [] });
  define("vendor", "Stella");
  define("pdfViewerEnabled", false);
  define("vibrate", () => false);
  define("sendBeacon", (url: string, data?: BodyInit) => {
    void fetch(url, { method: "POST", body: data ?? null, keepalive: true }).catch(() => {});
    return true;
  });
  define("permissions", { query: async () => ({ state: "prompt", addEventListener() {}, removeEventListener() {} }) });
  define("mediaDevices", {
    enumerateDevices: async () => (await audioDevices()).map((device) => ({ ...device, toJSON: () => device })),
    getUserMedia: async () => { throw new DOMException("Media capture runs in the on-demand media WebView.", "NotSupportedError"); },
    getDisplayMedia: async () => { throw new DOMException("Screen capture runs in the on-demand media WebView.", "NotSupportedError"); },
    addEventListener() {},
    removeEventListener() {},
  });
  const clip = options.clipboard;
  define("clipboard", {
    readText: () => clip?.readText() ?? Promise.resolve(""),
    writeText: (text: string) => clip?.writeText(String(text)) ?? Promise.resolve(),
    async write(items: Array<{ types: string[]; getType(type: string): Promise<Blob> }>) {
      for (const item of items ?? []) {
        if (item.types.includes("image/png") && clip?.writeImagePng) {
          await clip.writeImagePng(new Uint8Array(await (await item.getType("image/png")).arrayBuffer()));
          return;
        }
        if (item.types.includes("text/plain")) {
          await clip?.writeText(await (await item.getType("text/plain")).text());
          return;
        }
      }
    },
    async read() {
      const items: Array<{ types: string[]; getType(type: string): Promise<Blob> }> = [];
      const png = await clip?.readImagePng?.();
      if (png) items.push({ types: ["image/png"], getType: async () => new Blob([png as Uint8Array<ArrayBuffer>], { type: "image/png" }) });
      const text = (await clip?.readText()) ?? "";
      if (text) items.push({ types: ["text/plain"], getType: async () => new Blob([text], { type: "text/plain" }) });
      return items;
    },
  });
  g.ClipboardItem ??= class {
    readonly types: string[];
    constructor(private readonly data: Record<string, Blob | string | Promise<Blob | string>>) { this.types = Object.keys(data); }
    async getType(type: string) {
      const value = await this.data[type];
      return typeof value === "string" ? new Blob([value], { type }) : value;
    }
  };
}

function createLocation(initial: string, reload: () => void) {
  let url = new URL(initial);
  return {
    get href() { return url.href; },
    set href(next: string) { url = new URL(next, url); },
    get origin() { return url.origin; },
    get protocol() { return url.protocol; },
    get host() { return url.host; },
    get hostname() { return url.hostname; },
    get port() { return url.port; },
    get pathname() { return url.pathname; },
    get search() { return url.search; },
    get hash() { return url.hash; },
    set hash(next: string) { url.hash = next; },
    assign(next: string) { url = new URL(next, url); },
    replace(next: string) { url = new URL(next, url); },
    reload,
    toString() { return url.href; },
  };
}

function createHistory(onPop: () => void) {
  const entries: Array<{ state: unknown; url?: string }> = [{ state: null }];
  let index = 0;
  return {
    get length() { return entries.length; },
    get state() { return entries[index]?.state ?? null; },
    scrollRestoration: "manual",
    pushState(state: unknown, _title: string, url?: string) {
      entries.splice(index + 1, entries.length, { state, url });
      index = entries.length - 1;
    },
    replaceState(state: unknown, _title: string, url?: string) { entries[index] = { state, url }; },
    go(delta = 0) {
      const next = Math.min(entries.length - 1, Math.max(0, index + delta));
      if (next === index) return;
      index = next;
      queueMicrotask(onPop);
    },
    back() { this.go(-1); },
    forward() { this.go(1); },
  };
}
