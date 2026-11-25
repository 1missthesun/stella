// WebContents for Rune. An "app" contents (Stella's renderer origin) is a React tree in this
// process: send() reaches its RendererIpc, executeJavaScript runs in the host realm. Web content
// in a window is an engine <webview>. Web content in a WebContentsView or an offscreen window (the
// in-app browser's tabs, page snapshots, media probes) is a page in the on-demand Chromium, with
// the real DevTools protocol behind webContents.debugger.

import { EventEmitter } from "node:events";
import { RendererIpc } from "./ipc";
import { sessionFor, type Session } from "./session";
import { warnOnce } from "./engine";
import { ChromiumPage, type PageKey, type PagePointer, type PageWheel, type ScreencastFrame } from "./chromium-page";
import { chromiumTargetFor } from "./chromium-profiles";
import { nativeImage } from "./native-image";

export const APP_SCHEME = "stella-app:";

export type ContentsKind = "app" | "web";

export const contentsKindOf = (url: string): ContentsKind => (url.startsWith(APP_SCHEME) ? "app" : "web");

export type WebContentsHost = {
  onNavigate?(contents: WebContents, url: string): void;
  onPopup?(opener: WebContents, targetId: string, url: string): void;
  onReload?(contents: WebContents): void;
  onFocus?(contents: WebContents): void;
  evaluateWeb?(contents: WebContents, code: string): Promise<unknown>;
};

const all = new Map<number, WebContents>();
let nextId = 1;

type DebuggerSession = Awaited<ReturnType<ChromiumPage["attachDebugger"]>>;

class Debugger extends EventEmitter {
  private session: Promise<DebuggerSession> | null = null;
  constructor(private readonly contents: WebContents) { super(); this.setMaxListeners(0); }
  attach(_protocolVersion?: string) {
    if (this.session) throw new Error("Another debugger is already attached to this target.");
    if (!this.contents.isBrowserBacked) {
      warnOnce("debugger", `webContents.debugger needs a Chromium page; ${this.contents.getURL() || "this page"} is not one`);
      throw new Error("The DevTools protocol is available only for pages in the on-demand Chromium browser.");
    }
    const session = this.contents.chromiumPage().then((page) => page.attachDebugger(
      (method, params, sessionId) => this.emit("message", { preventDefault() {} }, method, params, sessionId),
      (reason) => {
        if (this.session !== session) return;
        this.session = null;
        this.emit("detach", { preventDefault() {} }, reason);
      },
    ));
    session.catch((error) => {
      if (this.session !== session) return;
      this.session = null;
      this.emit("detach", { preventDefault() {} }, `target closed: ${error instanceof Error ? error.message : String(error)}`);
    });
    this.session = session;
  }
  isAttached() { return this.session !== null; }
  detach() {
    const session = this.session;
    if (!session) throw new Error("No debugger is attached.");
    this.session = null;
    void session.then((s) => s.detach(), () => {});
  }
  async sendCommand(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<any> {
    if (!this.session) throw new Error("No target available");
    return await (await this.session).send(method, params, sessionId);
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
  replace(entries: string[], index: number) { this.entries.splice(0, this.entries.length, ...entries); this.index = index; }
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
  private userAgent = "";
  backgroundThrottling = true;
  private url = "";
  private title = "";
  private loading = false;
  private destroyed = false;
  private focused = false;
  private windowOpenHandler: ((details: unknown) => unknown) | null = null;
  private devToolsOpen = false;
  private readonly browser: boolean;
  private readonly offscreen: boolean;
  private readonly adoptTarget: string | undefined;
  private page: Promise<ChromiumPage> | null = null;
  private livePage: ChromiumPage | null = null;
  private userAgentSet = false;
  private viewport: { width: number; height: number } | null = null;

  /**
   * `browser`: web pages load in the on-demand Chromium (a WebContentsView, an offscreen window, a
   * popup a Chromium page opened). `adoptTarget` binds the contents to a page Chromium already has.
   */
  constructor(options: { partition?: string; session?: Session; offscreen?: boolean; browser?: boolean; adoptTarget?: string } = {}) {
    super();
    this.offscreen = options.offscreen ?? false;
    this.browser = options.browser ?? this.offscreen;
    this.adoptTarget = options.adoptTarget;
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

  /** Its web pages are Chromium pages: debugger, capturePage and input are the real ones. */
  get isBrowserBacked() { return this.browser && this.kind === "web"; }

  /** The Chromium page behind this contents, opened on first use. */
  chromiumPage(): Promise<ChromiumPage> {
    if (this.destroyed) return Promise.reject(new Error("WebContents was destroyed"));
    if (this.page) return this.page;
    const opening = (async () => {
      const target = await chromiumTargetFor(this.session);
      const page = await ChromiumPage.open({ ...target, targetId: this.adoptTarget });
      if (this.destroyed) {
        void page.close();
        throw new Error("WebContents was destroyed");
      }
      this.bindPage(page);
      if (this.viewport) await page.setViewport(this.viewport.width, this.viewport.height).catch(() => {});
      await page.setUserAgent(this.userAgentSet ? this.userAgent : this.session.getUserAgent()).catch(() => {});
      return page;
    })();
    this.page = opening;
    opening.catch((error) => {
      if (this.page === opening) this.page = null;
      console.error(`[chromium] page for contents ${this.id} failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    return opening;
  }

  private bindPage(page: ChromiumPage) {
    this.livePage = page;
    page.on("loadStart", () => {
      if (this.loading) return;
      this.loading = true;
      this.emit("did-start-loading");
    });
    page.on("requestedNavigation", (url: string, prevent: () => void) => {
      let prevented = false;
      const event = { url, isMainFrame: true, isSameDocument: false, frame: this.mainFrame, preventDefault() { prevented = true; }, get defaultPrevented() { return prevented; } };
      this.emit("will-navigate", event, url);
      if (prevented) prevent();
      else this.emit("did-start-navigation", event, url, false, true);
    });
    page.on("navigated", (url: string, sameDocument: boolean, status: number) => {
      this.url = url;
      if (sameDocument) this.emit("did-navigate-in-page", { url, isMainFrame: true }, url, true, process.pid, this.id);
      else this.emit("did-navigate", { url }, url, status, "OK");
      WebContents.host.onNavigate?.(this, url);
      void page.history().then((h) => {
        this.navigationHistory.replace(h.entries.map((e) => e.url), h.currentIndex);
      }, () => {});
    });
    page.on("domReady", () => this.emit("dom-ready"));
    page.on("loaded", () => {
      this.emit("did-frame-finish-load", {}, true, process.pid, this.id);
      this.emit("did-finish-load");
    });
    page.on("loadStop", () => {
      if (!this.loading) return;
      this.loading = false;
      this.emit("did-stop-loading");
    });
    page.on("loadFailed", (code: number, description: string, url: string) => {
      this.emit("did-fail-load", { preventDefault() {} }, code, description, url, true, process.pid, this.id);
    });
    page.on("title", (title: string) => { if (title && title !== this.title) this.setTitle(title); });
    page.on("crashed", () => this.emit("render-process-gone", { preventDefault() {} }, { reason: "crashed", exitCode: 0 }));
    page.on("popup", (targetId: string, url: string) => WebContents.host.onPopup?.(this, targetId, url));
    page.on("closed", () => {
      if (this.livePage !== page) return;
      this.livePage = null;
      this.page = null;
      if (this.loading) { this.loading = false; this.emit("did-stop-loading"); }
      if (!this.destroyed) this.emit("render-process-gone", { preventDefault() {} }, { reason: "killed", exitCode: 0 });
    });
  }

  /** Sizes the page's viewport (CSS px), as a WebContentsView's bounds or an offscreen window's size would. */
  setPageSize(width: number, height: number) {
    if (width < 1 || height < 1) return;
    this.viewport = { width: Math.round(width), height: Math.round(height) };
    void this.livePage?.setViewport(this.viewport.width, this.viewport.height).catch(() => {});
  }

  /** Input from the UI's surface for this page (CSS px). */
  surfaceInput(event: { pointer: PagePointer } | { wheel: PageWheel } | { key: PageKey }) {
    const page = this.livePage;
    if (!page) return;
    const sent = "pointer" in event ? page.pointer(event.pointer) : "wheel" in event ? page.wheel(event.wheel) : page.key(event.key);
    sent.catch(() => {});
    if ("pointer" in event && event.pointer.kind === "down") this.focus();
  }

  /** Streams the page's frames (JPEG) while the UI shows it; returns the stop. */
  streamFrames(listener: (frame: ScreencastFrame) => void, maxSize?: { width: number; height: number }) {
    let stopped = false;
    let started: ChromiumPage | null = null;
    void this.chromiumPage().then(async (page) => {
      if (stopped) return;
      started = page;
      await page.startScreencast(listener, maxSize);
    }).catch(() => {});
    return () => {
      stopped = true;
      void started?.stopScreencast();
    };
  }

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
  isOffscreen() { return this.offscreen; }
  isPainting() { return true; }
  isBeingCaptured() { return false; }
  isCurrentlyAudible() { return false; }
  isAudioMuted() { return this.audioMuted; }
  setAudioMuted(muted: boolean) { this.audioMuted = muted; }
  getOSProcessId() { return this.livePage?.proc.child.pid ?? process.pid; }
  getProcessId() { return process.pid; }
  getType() { return "window"; }
  getUserAgent() { return this.userAgentSet ? this.userAgent : this.session.getUserAgent(); }
  setUserAgent(ua: string) {
    this.userAgent = ua;
    this.userAgentSet = true;
    void this.livePage?.setUserAgent(ua).catch(() => {});
  }
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
  async insertText(text: string) {
    if (this.isBrowserBacked) await (await this.chromiumPage()).insertText(text);
  }
  findInPage() { return 0; }
  stopFindInPage() {}
  sendInputEvent(event: unknown) {
    if (!this.isBrowserBacked) return void this.emit("rune-input-event", event);
    void this.chromiumPage().then((page) => page.input(event as Parameters<ChromiumPage["input"]>[0])).catch(() => {});
  }
  beginFrameSubscription() {}
  endFrameSubscription() {}
  downloadURL() {}
  getPrintersAsync() { return Promise.resolve([]); }
  print(_opts?: unknown, cb?: (ok: boolean, reason: string) => void) { cb?.(false, "Printing is not available."); }
  printToPDF(): Promise<Buffer> { return Promise.reject(new Error("printToPDF needs the on-demand Chromium browser.")); }
  savePage() { return Promise.reject(new Error("savePage is not available.")); }
  async capturePage(rect?: { x: number; y: number; width: number; height: number }) {
    if (!this.isBrowserBacked) {
      warnOnce("capturePage", "webContents.capturePage needs a Chromium page; this contents is not one");
      throw new Error("capturePage is available only for pages in the on-demand Chromium browser.");
    }
    const usable = rect && rect.width > 0 && rect.height > 0 ? rect : undefined;
    return nativeImage.createFromBuffer(await (await this.chromiumPage()).capture(usable));
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
    if (this.livePage) void this.livePage.focus();
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
    if (this.isBrowserBacked) return await (await this.chromiumPage()).evaluate(code, _userGesture ?? true);
    if (WebContents.host.evaluateWeb) return await WebContents.host.evaluateWeb(this, code);
    throw new Error(`executeJavaScript on ${this.url || "about:blank"} needs a WebView or the on-demand Chromium browser.`);
  }

  executeJavaScriptInIsolatedWorld(_world: number, scripts: Array<{ code: string }>) {
    return this.executeJavaScript(scripts.map((s) => s.code).join(";\n"));
  }

  async loadURL(url: string, _options?: unknown): Promise<void> {
    if (this.destroyed) throw new Error("WebContents was destroyed");
    if (this.browser && contentsKindOf(String(url)) === "web") return await this.loadInChromium(String(url));
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

  private async loadInChromium(url: string) {
    const page = await this.chromiumPage();
    const event = { url, isMainFrame: true, isSameDocument: false, frame: this.mainFrame, preventDefault() {} };
    this.emit("did-start-navigation", event, url, false, true);
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        page.off("loaded", done);
        page.off("loadStop", done);
        page.off("loadFailed", failed);
        page.off("closed", gone);
      };
      const done = () => { cleanup(); resolve(); };
      const failed = (code: number, description: string, failedUrl: string) => {
        cleanup();
        reject(Object.assign(new Error(`${description} (${code}) loading '${failedUrl}'`), { code: description, errno: code, url: failedUrl }));
      };
      const gone = () => { cleanup(); reject(new Error(`The page closed while loading '${url}'`)); };
      page.on("loaded", done);
      page.on("loadStop", done);
      page.on("loadFailed", failed);
      page.on("closed", gone);
      page.navigate(url).then((r) => { if (r.sameDocument) done(); }, (error) => { cleanup(); reject(error); });
    });
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
    if (this.livePage) return void this.livePage.reload().catch(() => {});
    this.loading = true;
    this.emit("did-start-loading");
    WebContents.host.onReload?.(this);
    setTimeout(() => { if (!this.destroyed) this.finishLoad(); }, 0);
  }

  reloadIgnoringCache() {
    if (this.livePage) return void this.livePage.reload(true).catch(() => {});
    this.reload();
  }
  stop() {
    if (this.livePage) return void this.livePage.stop().catch(() => {});
    this.loading = false;
    this.emit("did-stop-loading");
  }
  canGoBack() { return this.navigationHistory.canGoBack(); }
  canGoForward() { return this.navigationHistory.canGoForward(); }
  goBack() { if (this.livePage) return void this.livePage.go(-1).catch(() => {}); const url = this.navigationHistory.goBack(); if (url) { this.url = url; WebContents.host.onNavigate?.(this, url); } }
  goForward() { if (this.livePage) return void this.livePage.go(1).catch(() => {}); const url = this.navigationHistory.goForward(); if (url) { this.url = url; WebContents.host.onNavigate?.(this, url); } }
  clearHistory() { this.navigationHistory.clear(); }

  close() { this.destroy(); }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    const page = this.livePage;
    this.livePage = null;
    this.page = null;
    if (page) void page.close();
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
  create: (options?: { partition?: string; session?: Session }) => new WebContents({ ...options, browser: true }),
};
