// WebContents for Rune. An "app" contents (Stella's renderer origin) is a React tree in this
// process: send() reaches its RendererIpc, executeJavaScript runs in the host realm. Any other
// URL is web content: an engine <webview> when shown in a window, otherwise a Chromium-only
// capability (debugger, offscreen paint, capturePage) that reports itself as unavailable.

import { EventEmitter } from "node:events";
import { RendererIpc } from "./ipc";
import { sessionFor, type Session } from "./session";
import { warnOnce } from "./engine";

export const APP_SCHEME = "stella-app:";

export type ContentsKind = "app" | "web";

export const contentsKindOf = (url: string): ContentsKind => (url.startsWith(APP_SCHEME) ? "app" : "web");

export type WebContentsHost = {
  onNavigate?(contents: WebContents, url: string): void;
  onReload?(contents: WebContents): void;
  onFocus?(contents: WebContents): void;
  evaluateWeb?(contents: WebContents, code: string): Promise<unknown>;
};

const all = new Map<number, WebContents>();
let nextId = 1;

class Debugger extends EventEmitter {
  private attached = false;
  constructor(private readonly contents: WebContents) { super(); }
  attach() {
    warnOnce("debugger", `webContents.debugger needs Chromium (CDP); ${this.contents.getURL() || "page"} runs on the on-demand browser`);
    throw new Error("The DevTools protocol is available only in the on-demand Chromium browser.");
  }
  isAttached() { return this.attached; }
  detach() { this.attached = false; }
  async sendCommand(method: string): Promise<never> {
    throw new Error(`CDP ${method} is available only in the on-demand Chromium browser.`);
  }
}

class NavigationHistory {
  private readonly entries: string[] = [];
  private index = -1;
  push(url: string) { this.entries.splice(this.index + 1); this.entries.push(url); this.index = this.entries.length - 1; }
  canGoBack() { return this.index > 0; }
  canGoForward() { return this.index < this.entries.length - 1; }
  canGoToOffset(offset: number) { const i = this.index + offset; return i >= 0 && i < this.entries.length; }
  goBack() { return this.canGoBack() ? this.entries[--this.index] : null; }
  goForward() { return this.canGoForward() ? this.entries[++this.index] : null; }
  getActiveIndex() { return this.index; }
  length() { return this.entries.length; }
  getEntryAtIndex(i: number) { const url = this.entries[i]; return url ? { url, title: "" } : null; }
  clear() { this.entries.length = 0; this.index = -1; }
  getAllEntries() { return this.entries.map((url) => ({ url, title: "" })); }
}

export class WebContents extends EventEmitter {
  static host: WebContentsHost = {};

  readonly id = nextId++;
  readonly session: Session;
  readonly ipc: RendererIpc;
  readonly debugger: Debugger;
  readonly navigationHistory = new NavigationHistory();
  readonly hostWebContents = null;
  readonly mainFrame: { url: string; origin: string; routingId: number; processId: number; frameTreeNodeId: number; executeJavaScript: (code: string) => Promise<unknown>; isDestroyed: () => boolean; send: (channel: string, ...args: unknown[]) => void; frames: unknown[]; framesInSubtree: unknown[] };
  owner: { id: number } | null = null;
  audioMuted = false;
  zoomFactor = 1;
  zoomLevel = 0;
  userAgent = `Mozilla/5.0 Stella/${process.versions.bun} (Rune)`;
  backgroundThrottling = true;
  private url = "";
  private title = "";
  private loading = false;
  private destroyed = false;
  private focused = false;
  private windowOpenHandler: ((details: unknown) => unknown) | null = null;
  private devToolsOpen = false;

  constructor(options: { partition?: string; session?: Session; offscreen?: boolean } = {}) {
    super();
    this.setMaxListeners(0);
    this.session = options.session ?? sessionFor(options.partition);
    this.ipc = new RendererIpc(this);
    this.debugger = new Debugger(this);
    const self = this;
    this.mainFrame = {
      get url() { return self.url; },
      get origin() { try { return new URL(self.url).origin; } catch { return ""; } },
      routingId: this.id,
      processId: process.pid,
      frameTreeNodeId: this.id,
      executeJavaScript: (code: string) => this.executeJavaScript(code),
      isDestroyed: () => this.destroyed,
      send: (channel: string, ...args: unknown[]) => this.send(channel, ...args),
      frames: [],
      framesInSubtree: [],
    };
    all.set(this.id, this);
  }

  get kind(): ContentsKind { return contentsKindOf(this.url); }

  static getAllWebContents() { return [...all.values()].filter((c) => !c.destroyed); }
  static fromId(id: number) { return all.get(id) ?? null; }
  static getFocusedWebContents() { return [...all.values()].find((c) => c.focused && !c.destroyed) ?? null; }
  static fromFrame() { return null; }
  static fromDevToolsTargetId() { return null; }

  getURL() { return this.url; }
  getTitle() { return this.title; }
  setTitle(title: string) { this.title = title; this.emit("page-title-updated", { preventDefault() {} }, title, true); }
  isLoading() { return this.loading; }
  isLoadingMainFrame() { return this.loading; }
  isWaitingForResponse() { return false; }
  isDestroyed() { return this.destroyed; }
  isCrashed() { return false; }
  isFocused() { return this.focused; }
  isOffscreen() { return false; }
  isPainting() { return true; }
  isBeingCaptured() { return false; }
  isCurrentlyAudible() { return false; }
  isAudioMuted() { return this.audioMuted; }
  setAudioMuted(muted: boolean) { this.audioMuted = muted; }
  getOSProcessId() { return process.pid; }
  getProcessId() { return process.pid; }
  getType() { return "window"; }
  getUserAgent() { return this.userAgent; }
  setUserAgent(ua: string) { this.userAgent = ua; }
  getZoomFactor() { return this.zoomFactor; }
  setZoomFactor(f: number) { this.zoomFactor = f; }
  getZoomLevel() { return this.zoomLevel; }
  setZoomLevel(l: number) { this.zoomLevel = l; }
  setVisualZoomLevelLimits() { return Promise.resolve(); }
  getBackgroundThrottling() { return this.backgroundThrottling; }
  setBackgroundThrottling(on: boolean) { this.backgroundThrottling = on; }
  setFrameRate() {}
  getFrameRate() { return 60; }
  invalidate() {}
  startPainting() {}
  stopPainting() {}
  setIgnoreMenuShortcuts() {}
  setWebRTCIPHandlingPolicy() {}
  setWindowOpenHandler(handler: (details: unknown) => unknown) { this.windowOpenHandler = handler; }
  getWindowOpenHandler() { return this.windowOpenHandler; }
  setDevToolsWebContents() {}
  openDevTools() { this.devToolsOpen = true; warnOnce("devtools", "DevTools: inspect the host with `bun --inspect` (STELLA_RUNE_INSPECT=1)"); }
  closeDevTools() { this.devToolsOpen = false; }
  isDevToolsOpened() { return this.devToolsOpen; }
  isDevToolsFocused() { return false; }
  toggleDevTools() { this.devToolsOpen = !this.devToolsOpen; }
  inspectElement() {}
  insertCSS() { return Promise.resolve(""); }
  removeInsertedCSS() { return Promise.resolve(); }
  copy() {}
  cut() {}
  paste() {}
  pasteAndMatchStyle() {}
  selectAll() {}
  unselect() {}
  undo() {}
  redo() {}
  delete() {}
  replace() {}
  replaceMisspelling() {}
  insertText() { return Promise.resolve(); }
  findInPage() { return 0; }
  stopFindInPage() {}
  sendInputEvent(event: unknown) { this.emit("rune-input-event", event); }
  beginFrameSubscription() {}
  endFrameSubscription() {}
  downloadURL() {}
  getPrintersAsync() { return Promise.resolve([]); }
  print(_opts?: unknown, cb?: (ok: boolean, reason: string) => void) { cb?.(false, "Printing is not available."); }
  printToPDF(): Promise<Buffer> { return Promise.reject(new Error("printToPDF needs the on-demand Chromium browser.")); }
  savePage() { return Promise.reject(new Error("savePage is not available.")); }
  capturePage(): Promise<never> {
    warnOnce("capturePage", "webContents.capturePage needs Chromium; web snapshots run on the on-demand browser");
    return Promise.reject(new Error("capturePage is available only in the on-demand Chromium browser."));
  }
  getMediaSourceId() { return `rune:${this.id}`; }
  forcefullyCrashRenderer() {}
  setImageAnimationPolicy() {}
  centerSelection() {}
  scrollToTop() {}
  scrollToBottom() {}
  adjustSelection() {}
  showDefinitionForSelection() {}
  isFocusedWebContents() { return this.focused; }

  focus() {
    this.focused = true;
    WebContents.host.onFocus?.(this);
    this.emit("focus");
  }

  markFocused(focused: boolean) {
    if (this.focused === focused) return;
    this.focused = focused;
    this.emit(focused ? "focus" : "blur");
  }

  send(channel: string, ...args: unknown[]) {
    if (this.destroyed) return;
    this.ipc.deliver(channel, args);
  }

  sendToFrame(_frame: unknown, channel: string, ...args: unknown[]) {
    this.send(channel, ...args);
  }

  postMessage(channel: string, message: unknown) {
    this.send(channel, message);
  }

  async executeJavaScript(code: string, _userGesture?: boolean): Promise<unknown> {
    if (this.destroyed) throw new Error("WebContents was destroyed");
    if (this.kind === "app") return await (0, eval)(code);
    if (WebContents.host.evaluateWeb) return await WebContents.host.evaluateWeb(this, code);
    throw new Error(`executeJavaScript on ${this.url || "about:blank"} needs a WebView or the on-demand Chromium browser.`);
  }

  executeJavaScriptInIsolatedWorld(_world: number, scripts: Array<{ code: string }>) {
    return this.executeJavaScript(scripts.map((s) => s.code).join(";\n"));
  }

  async loadURL(url: string, _options?: unknown): Promise<void> {
    if (this.destroyed) throw new Error("WebContents was destroyed");
    const previous = this.url;
    this.url = String(url);
    this.loading = true;
    this.navigationHistory.push(this.url);
    this.emit("did-start-loading");
    this.emit("did-start-navigation", { url: this.url, isMainFrame: true, isSameDocument: false, frame: this.mainFrame, preventDefault() {} }, this.url, false, true);
    WebContents.host.onNavigate?.(this, this.url);
    if (previous && previous !== this.url) this.emit("did-navigate", { url: this.url }, this.url, 200, "OK");
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (this.destroyed) return;
    this.finishLoad();
  }

  loadFile(file: string, options?: { query?: Record<string, string>; hash?: string; search?: string }) {
    const url = new URL(`file://${file.startsWith("/") ? "" : "/"}${file.replaceAll("\\", "/")}`);
    for (const [k, v] of Object.entries(options?.query ?? {})) url.searchParams.set(k, v);
    if (options?.search) url.search = options.search;
    if (options?.hash) url.hash = options.hash;
    return this.loadURL(url.toString());
  }

  /** The page navigated on its own (a link, a redirect): record it without loading it again. */
  markNavigated(url: string) {
    if (this.destroyed || url === this.url) return;
    let prevented = false;
    const event = { url, isMainFrame: true, frame: this.mainFrame, preventDefault() { prevented = true; }, get defaultPrevented() { return prevented; } };
    this.emit("will-navigate", event, url);
    if (!prevented && !this.destroyed) this.emit("will-redirect", event, url, false, true);
    if (prevented || this.destroyed) return;
    this.url = url;
    this.navigationHistory.push(url);
    this.emit("did-navigate", { url }, url, 200, "OK");
  }

  /** The page's own load finished (web contents). */
  markLoaded() {
    if (this.destroyed) return;
    this.emit("did-finish-load");
  }

  private finishLoad() {
    this.loading = false;
    this.emit("did-navigate", { url: this.url }, this.url, 200, "OK");
    this.emit("dom-ready");
    this.emit("did-frame-finish-load", {}, true);
    this.emit("did-finish-load");
    this.emit("did-stop-loading");
  }

  reload() {
    if (this.destroyed) return;
    this.loading = true;
    this.emit("did-start-loading");
    WebContents.host.onReload?.(this);
    setTimeout(() => { if (!this.destroyed) this.finishLoad(); }, 0);
  }

  reloadIgnoringCache() { this.reload(); }
  stop() { this.loading = false; this.emit("did-stop-loading"); }
  canGoBack() { return this.navigationHistory.canGoBack(); }
  canGoForward() { return this.navigationHistory.canGoForward(); }
  goBack() { const url = this.navigationHistory.goBack(); if (url) { this.url = url; WebContents.host.onNavigate?.(this, url); } }
  goForward() { const url = this.navigationHistory.goForward(); if (url) { this.url = url; WebContents.host.onNavigate?.(this, url); } }
  clearHistory() { this.navigationHistory.clear(); }

  close() { this.destroy(); }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.ipc.removeAllListeners();
    all.delete(this.id);
    this.emit("destroyed");
    this.removeAllListeners();
  }
}

export const webContents = {
  getAllWebContents: () => WebContents.getAllWebContents(),
  getFocusedWebContents: () => WebContents.getFocusedWebContents(),
  fromId: (id: number) => WebContents.fromId(id),
  fromFrame: () => null,
  fromDevToolsTargetId: () => null,
  create: (options?: { partition?: string }) => new WebContents(options),
};
