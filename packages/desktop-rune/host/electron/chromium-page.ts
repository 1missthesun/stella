// A page in the on-demand Chromium, standing behind one WebContents: navigation and load events,
// script evaluation, screenshots, input, screencast frames, and webContents.debugger as its own
// flat CDP session (with the child sessions it auto-attaches) so agents get the real protocol.

import { EventEmitter } from "node:events";
import { chromiumFor, CdpError, userAgentMetadataFor, type CdpMessage, type ChromiumProcess } from "./chromium";

export type PageEvents = {
  loadStart(): void;
  requestedNavigation(url: string, prevent: () => void): void;
  navigated(url: string, sameDocument: boolean, status: number): void;
  domReady(): void;
  loaded(): void;
  loadStop(): void;
  loadFailed(code: number, description: string, url: string): void;
  title(title: string): void;
  crashed(): void;
  closed(): void;
  popup(targetId: string, url: string): void;
};

export type ScreencastFrame = { jpeg: Uint8Array; width: number; height: number; scale: number };

export type Mods = { shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean };
export type PagePointer = { kind: "move" | "down" | "up" | "leave"; x: number; y: number; button: string | null; buttons: number; clicks: number; mods: Mods };
export type PageWheel = { x: number; y: number; dx: number; dy: number; mode: "pixel" | "line"; mods: Mods };
export type PageKey = { type: "down" | "up"; key: string; text: string | null; mods: Mods };

const LINE_PX = 40;
const modsMask = (m: Mods) => (m.alt ? 1 : 0) | (m.ctrl ? 2 : 0) | (m.meta ? 4 : 0) | (m.shift ? 8 : 0);
const CDP_BUTTONS = new Set(["left", "right", "middle", "back", "forward"]);

type ElectronInput = {
  type: string;
  x?: number; y?: number; button?: "left" | "middle" | "right"; clickCount?: number;
  deltaX?: number; deltaY?: number; keyCode?: string; modifiers?: string[]; text?: string;
};

const TITLE_POLL_MS = 1500;

/** Answers a request to one of the host's custom schemes (`protocol.handle`), or null. */
export type SchemeServer = { schemes: readonly string[]; fetch(request: Request): Promise<Response | null> };

/**
 * Chromium knows nothing of the host's custom schemes, so a page loads `scheme://host/path` from
 * `https://host.scheme.localhost/path` (a secure origin per scheme host, which relative URLs keep)
 * and the host answers those requests through CDP Fetch. A host that isn't one lowercase DNS label
 * (a draft named `Fix_v2.1`) travels hex-encoded as `x--<hex>`.
 */
const standInHost = (scheme: string, host: string) => `${encodeHost(host)}.${scheme}.localhost`;
const LABEL = /^[a-z0-9-]+$/;
const ENCODED = "x--";
const encodeHost = (host: string) => (LABEL.test(host) && !host.startsWith(ENCODED) ? host : ENCODED + Buffer.from(host, "utf8").toString("hex"));
const decodeHost = (label: string) => (label.startsWith(ENCODED) && /^[0-9a-f]*$/.test(label.slice(ENCODED.length)) ? Buffer.from(label.slice(ENCODED.length), "hex").toString("utf8") : label);

export const toStandIn = (url: string, schemes: readonly string[]): string => {
  let u: URL;
  try { u = new URL(url); } catch { return url; }
  const scheme = u.protocol.slice(0, -1).toLowerCase();
  if (!schemes.includes(scheme) || !LABEL.test(scheme) || !u.hostname) return url;
  return `https://${standInHost(scheme, u.hostname)}${u.pathname || "/"}${u.search}${u.hash}`;
};

export const fromStandIn = (url: string, schemes: readonly string[]): string => {
  let u: URL;
  try { u = new URL(url); } catch { return url; }
  if (u.protocol !== "https:") return url;
  const scheme = schemes.find((s) => u.hostname.endsWith(`.${s}.localhost`));
  if (!scheme) return url;
  return `${scheme}://${decodeHost(u.hostname.slice(0, -`.${scheme}.localhost`.length))}${u.pathname}${u.search}${u.hash}`;
};

const NET_ERRORS: Record<string, number> = {
  ERR_FAILED: -2, ERR_ABORTED: -3, ERR_TIMED_OUT: -7, ERR_FILE_NOT_FOUND: -6, ERR_ACCESS_DENIED: -10, ERR_BLOCKED_BY_CLIENT: -20,
  ERR_BLOCKED_BY_RESPONSE: -27, ERR_CONNECTION_CLOSED: -100, ERR_CONNECTION_RESET: -101, ERR_CONNECTION_REFUSED: -102,
  ERR_CONNECTION_ABORTED: -103, ERR_CONNECTION_FAILED: -104, ERR_NAME_NOT_RESOLVED: -105, ERR_INTERNET_DISCONNECTED: -106,
  ERR_SSL_PROTOCOL_ERROR: -107, ERR_ADDRESS_UNREACHABLE: -109, ERR_CONNECTION_TIMED_OUT: -118, ERR_CERT_COMMON_NAME_INVALID: -200,
  ERR_CERT_DATE_INVALID: -201, ERR_CERT_AUTHORITY_INVALID: -202, ERR_INVALID_URL: -300, ERR_UNKNOWN_URL_SCHEME: -302,
  ERR_TOO_MANY_REDIRECTS: -310, ERR_INVALID_RESPONSE: -320, ERR_EMPTY_RESPONSE: -324,
};

const MODIFIER_BITS: Record<string, number> = { alt: 1, control: 2, ctrl: 2, meta: 4, command: 4, cmd: 4, shift: 8 };
const modifierMask = (mods: string[] = []) => mods.reduce((m, k) => m | (MODIFIER_BITS[k.toLowerCase()] ?? 0), 0);
const buttonsMask = (mods: string[] = []) =>
  (mods.includes("leftbuttondown") ? 1 : 0) | (mods.includes("rightbuttondown") ? 2 : 0) | (mods.includes("middlebuttondown") ? 4 : 0);

const KEY_CODES: Record<string, { key: string; code: string; vk: number }> = {
  Enter: { key: "Enter", code: "Enter", vk: 13 }, Return: { key: "Enter", code: "Enter", vk: 13 },
  Tab: { key: "Tab", code: "Tab", vk: 9 }, Backspace: { key: "Backspace", code: "Backspace", vk: 8 },
  Escape: { key: "Escape", code: "Escape", vk: 27 }, Delete: { key: "Delete", code: "Delete", vk: 46 },
  Space: { key: " ", code: "Space", vk: 32 }, " ": { key: " ", code: "Space", vk: 32 }, Up: { key: "ArrowUp", code: "ArrowUp", vk: 38 },
  Down: { key: "ArrowDown", code: "ArrowDown", vk: 40 }, Left: { key: "ArrowLeft", code: "ArrowLeft", vk: 37 },
  Right: { key: "ArrowRight", code: "ArrowRight", vk: 39 }, Home: { key: "Home", code: "Home", vk: 36 },
  End: { key: "End", code: "End", vk: 35 }, PageUp: { key: "PageUp", code: "PageUp", vk: 33 },
  PageDown: { key: "PageDown", code: "PageDown", vk: 34 },
};

const keyOf = (keyCode: string) => {
  const named = KEY_CODES[keyCode] ?? KEY_CODES[keyCode.replace(/^Arrow/, "")];
  if (named) return named;
  if (keyCode.length === 1) {
    const upper = keyCode.toUpperCase();
    const code = /[A-Z]/.test(upper) ? `Key${upper}` : /[0-9]/.test(upper) ? `Digit${upper}` : "";
    return { key: keyCode, code, vk: upper.charCodeAt(0) };
  }
  return { key: keyCode, code: keyCode, vk: 0 };
};

export class ChromiumPage extends EventEmitter {
  readonly proc: ChromiumProcess;
  readonly targetId: string;
  readonly sessionId: string;
  private mainFrameId = "";
  private closed = false;
  private readonly offSession: () => void;
  private readonly onBrowserEvent: (m: CdpMessage) => void;
  private screencastListener: ((frame: ScreencastFrame) => void) | null = null;
  /** The screencast asked for, and whether Chromium took it: a page that hasn't committed its first document yet refuses one ("Not attached to an active page"), so it starts again on the main frame's next commit. */
  private screencast: { params: Record<string, unknown>; running: boolean } | null = null;
  private viewport = { width: 1280, height: 720 };
  private titlePoll: ReturnType<typeof setInterval> | null = null;
  private schemes: SchemeServer | null = null;

  static async open(options: { profileDir: string; url?: string; targetId?: string; browserContextId?: string }): Promise<ChromiumPage> {
    const proc = await chromiumFor(options.profileDir);
    const targetId = options.targetId ?? (await proc.send<{ targetId: string }>("Target.createTarget", {
      url: "about:blank",
      ...(options.browserContextId ? { browserContextId: options.browserContextId } : {}),
    })).targetId;
    const { sessionId } = await proc.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
    const page = new ChromiumPage(proc, targetId, sessionId);
    await page.init();
    if (options.url && options.url !== "about:blank") await page.navigate(options.url);
    return page;
  }

  private constructor(proc: ChromiumProcess, targetId: string, sessionId: string) {
    super();
    this.setMaxListeners(0);
    this.proc = proc;
    this.targetId = targetId;
    this.sessionId = sessionId;
    proc.retainPage();
    this.offSession = proc.onSession(sessionId, (m) => this.onPageEvent(m));
    this.onBrowserEvent = (m) => this.onBrowser(m);
    proc.on("event", this.onBrowserEvent);
    proc.once("exit", () => this.markClosed());
  }

  private send<T = any>(method: string, params: Record<string, unknown> = {}) {
    return this.proc.send<T>(method, params, this.sessionId);
  }

  private async init() {
    const [{ frameTree }] = await Promise.all([
      this.send<{ frameTree: { frame: { id: string } } }>("Page.getFrameTree"),
      this.send("Page.enable"),
      this.send("Page.setLifecycleEventsEnabled", { enabled: true }),
      this.send("Inspector.enable").catch(() => {}),
      this.send("Emulation.setDeviceMetricsOverride", { width: this.viewport.width, height: this.viewport.height, deviceScaleFactor: 1, mobile: false }),
    ]);
    this.mainFrameId = frameTree.frame.id;
  }

  private onPageEvent(m: CdpMessage) {
    const p = (m.params ?? {}) as Record<string, any>;
    switch (m.method) {
      case "Page.frameStartedLoading":
        if (p.frameId === this.mainFrameId) this.emit("loadStart");
        break;
      case "Page.frameRequestedNavigation":
        if (p.frameId === this.mainFrameId) {
          let prevented = false;
          this.emit("requestedNavigation", this.hostUrl(p.url), () => { prevented = true; });
          if (prevented) void this.send("Page.stopLoading").catch(() => {});
        }
        break;
      case "Page.frameNavigated":
        if (!p.frame?.parentId) {
          this.mainFrameId = p.frame.id;
          if (this.screencast && !this.screencast.running) void this.sendScreencast();
          this.emit("navigated", this.hostUrl(p.frame.url + (p.frame.urlFragment ?? "")), false, 200);
        }
        break;
      case "Page.navigatedWithinDocument":
        if (p.frameId === this.mainFrameId) {
          this.emit("navigated", this.hostUrl(p.url), true, 200);
          this.refreshTitle();
        }
        break;
      case "Page.domContentEventFired":
        this.emit("domReady");
        this.refreshTitle();
        break;
      case "Page.loadEventFired":
        this.emit("loaded");
        this.refreshTitle();
        break;
      case "Page.frameStoppedLoading":
        if (p.frameId === this.mainFrameId) this.emit("loadStop");
        break;
      case "Inspector.targetCrashed":
        this.emit("crashed");
        break;
      case "Fetch.requestPaused":
        void this.answerScheme(p.requestId as string, p.request as { url: string; method: string; headers: Record<string, string>; postData?: string });
        break;
      case "Page.javascriptDialogOpening":
        setTimeout(() => {
          if (this.closed) return;
          void this.send("Page.handleJavaScriptDialog", { accept: p.type === "alert" || p.type === "beforeunload" }).catch(() => {});
        }, 250);
        break;
      case "Page.screencastFrame": {
        void this.send("Page.screencastFrameAck", { sessionId: p.sessionId }).catch(() => {});
        const meta = p.metadata ?? {};
        this.screencastListener?.({
          jpeg: Buffer.from(p.data as string, "base64"),
          width: Math.round((meta.deviceWidth ?? this.viewport.width) * (meta.pageScaleFactor ?? 1)),
          height: Math.round((meta.deviceHeight ?? this.viewport.height) * (meta.pageScaleFactor ?? 1)),
          scale: meta.pageScaleFactor ?? 1,
        });
        break;
      }
    }
  }

  private lastTitle = "";

  /** Chromium reports a page's title in targetInfoChanged only now and then; ask for it instead. */
  refreshTitle() {
    if (this.closed) return;
    void this.proc.send<{ targetInfo: { title: string } }>("Target.getTargetInfo", { targetId: this.targetId }).then(({ targetInfo }) => {
      if (targetInfo.title === this.lastTitle) return;
      this.lastTitle = targetInfo.title;
      this.emit("title", targetInfo.title);
    }, () => {});
  }

  private onBrowser(m: CdpMessage) {
    const p = (m.params ?? {}) as Record<string, any>;
    if (m.sessionId) return;
    if (m.method === "Target.targetInfoChanged" && p.targetInfo?.targetId === this.targetId) {
      this.refreshTitle();
    } else if (m.method === "Target.targetDestroyed" && p.targetId === this.targetId) {
      this.markClosed();
    } else if (m.method === "Target.detachedFromTarget" && p.sessionId === this.sessionId) {
      this.markClosed();
    } else if (m.method === "Target.targetCreated" && p.targetInfo?.openerId === this.targetId && p.targetInfo.type === "page") {
      this.emit("popup", p.targetInfo.targetId, p.targetInfo.url ?? "");
    }
  }

  private markClosed() {
    if (this.closed) return;
    this.closed = true;
    if (this.titlePoll) { clearInterval(this.titlePoll); this.titlePoll = null; }
    this.offSession();
    this.proc.off("event", this.onBrowserEvent);
    this.proc.releasePage();
    this.emit("closed");
  }

  get isClosed() { return this.closed; }

  /** Loads the host's custom schemes in this page from now on. */
  async serveSchemes(server: SchemeServer) {
    const schemes = server.schemes.filter((s) => LABEL.test(s));
    this.schemes = { schemes, fetch: server.fetch };
    if (schemes.length === 0) return;
    await this.send("Fetch.enable", { patterns: schemes.map((s) => ({ urlPattern: `https://*.${s}.localhost/*`, requestStage: "Request" })) });
  }

  servesScheme(scheme: string) {
    return this.schemes?.schemes.includes(scheme) ?? false;
  }

  private hostUrl(url: string) {
    return this.schemes ? fromStandIn(url, this.schemes.schemes) : url;
  }

  private async answerScheme(requestId: string, request: { url: string; method: string; headers: Record<string, string>; postData?: string }) {
    const server = this.schemes;
    const fail = () => this.send("Fetch.failRequest", { requestId, errorReason: "Failed" }).catch(() => {});
    if (!server) return void fail();
    try {
      const body = request.postData !== undefined && request.method !== "GET" && request.method !== "HEAD" ? request.postData : undefined;
      const response = await server.fetch(new Request(fromStandIn(request.url, server.schemes), { method: request.method, headers: request.headers, body }));
      if (!response) return void fail();
      const bytes = new Uint8Array(await response.arrayBuffer());
      await this.send("Fetch.fulfillRequest", {
        requestId,
        responseCode: response.status,
        responseHeaders: [...response.headers].map(([name, value]) => ({ name, value })),
        body: Buffer.from(bytes).toString("base64"),
      });
    } catch {
      await fail();
    }
  }

  async navigate(hostUrl: string): Promise<{ sameDocument: boolean }> {
    const url = this.schemes ? toStandIn(hostUrl, this.schemes.schemes) : hostUrl;
    const r = await this.send<{ errorText?: string; loaderId?: string }>("Page.navigate", { url });
    if (r.errorText && r.errorText !== "net::ERR_ABORTED") {
      const name = r.errorText.replace(/^net::/, "");
      this.emit("loadFailed", NET_ERRORS[name] ?? -2, name, hostUrl);
    }
    return { sameDocument: !r.errorText && !r.loaderId };
  }

  reload(ignoreCache = false) { return this.send("Page.reload", { ignoreCache }); }
  stop() { return this.send("Page.stopLoading"); }

  /** The page's history without the about:blank every new target starts on. */
  async history() {
    const h = await this.send<{ currentIndex: number; entries: Array<{ id: number; url: string; title: string }> }>("Page.getNavigationHistory");
    if (h.entries.length > 1 && h.entries[0]!.url === "about:blank") return { currentIndex: Math.max(0, h.currentIndex - 1), entries: h.entries.slice(1) };
    return h;
  }

  async go(offset: number) {
    const h = await this.history();
    const entry = h.entries[h.currentIndex + offset];
    if (entry) await this.send("Page.navigateToHistoryEntry", { entryId: entry.id });
  }

  async evaluate(code: string, userGesture = true): Promise<unknown> {
    const r = await this.send<{ result: { value?: unknown; description?: string }; exceptionDetails?: { text: string; exception?: { description?: string } } }>("Runtime.evaluate", {
      expression: code, awaitPromise: true, returnByValue: true, userGesture,
    });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result.value;
  }

  async capture(rect?: { x: number; y: number; width: number; height: number }): Promise<Uint8Array> {
    const r = await this.send<{ data: string }>("Page.captureScreenshot", {
      format: "png",
      ...(rect ? { clip: { ...rect, scale: 1 } } : {}),
    });
    return Buffer.from(r.data, "base64");
  }

  async input(event: ElectronInput) {
    const modifiers = modifierMask(event.modifiers);
    const t = event.type;
    if (t === "mouseDown" || t === "mouseUp" || t === "mouseMove" || t === "mouseEnter" || t === "mouseLeave") {
      const type = t === "mouseDown" ? "mousePressed" : t === "mouseUp" ? "mouseReleased" : "mouseMoved";
      await this.send("Input.dispatchMouseEvent", {
        type, x: event.x ?? 0, y: event.y ?? 0, modifiers,
        button: t === "mouseMove" || t === "mouseEnter" || t === "mouseLeave" ? (buttonsMask(event.modifiers) ? "left" : "none") : event.button ?? "left",
        buttons: buttonsMask(event.modifiers), clickCount: event.clickCount ?? (type === "mouseMoved" ? 0 : 1),
      });
    } else if (t === "mouseWheel") {
      await this.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: event.x ?? 0, y: event.y ?? 0, deltaX: -(event.deltaX ?? 0), deltaY: -(event.deltaY ?? 0), modifiers });
    } else if (t === "keyDown" || t === "keyUp" || t === "rawKeyDown") {
      const k = keyOf(event.keyCode ?? "");
      const printable = k.key.length === 1 && !(modifiers & 6);
      await this.send("Input.dispatchKeyEvent", {
        type: t === "keyUp" ? "keyUp" : printable ? "keyDown" : "rawKeyDown",
        key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers,
        ...(t !== "keyUp" && printable ? { text: k.key, unmodifiedText: k.key } : {}),
      });
    } else if (t === "char") {
      const text = event.keyCode ?? event.text ?? "";
      if (text.length === 1 && !(modifiers & 6)) return;
      await this.send("Input.dispatchKeyEvent", { type: "char", text, modifiers });
    }
  }

  insertText(text: string) { return this.send("Input.insertText", { text }); }

  /** Pointer input from the UI's surface, in CSS px of the page. */
  pointer(e: PagePointer) {
    const type = e.kind === "down" ? "mousePressed" : e.kind === "up" ? "mouseReleased" : "mouseMoved";
    const button = e.button && CDP_BUTTONS.has(e.button) ? e.button : "none";
    return this.send("Input.dispatchMouseEvent", {
      type, x: e.x, y: e.y, modifiers: modsMask(e.mods), buttons: e.buttons,
      button: type === "mouseMoved" ? "none" : button, clickCount: type === "mouseMoved" ? 0 : Math.max(1, e.clicks),
    });
  }

  /** A surface wheel: positive dy scrolls up (towards the top), as the engine reports it. */
  wheel(e: PageWheel) {
    const scale = e.mode === "line" ? LINE_PX : 1;
    return this.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: e.x, y: e.y, deltaX: -e.dx * scale, deltaY: -e.dy * scale, modifiers: modsMask(e.mods) });
  }

  key(e: PageKey) {
    const k = keyOf(e.key);
    const modifiers = modsMask(e.mods);
    const text = e.type === "down" ? e.text ?? (k.key === "Enter" ? "\r" : null) : null;
    return this.send("Input.dispatchKeyEvent", {
      type: e.type === "up" ? "keyUp" : text ? "keyDown" : "rawKeyDown",
      key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers,
      ...(text ? { text, unmodifiedText: text } : {}),
    });
  }
  setUserAgent(userAgent: string) {
    return this.send("Emulation.setUserAgentOverride", { userAgent, userAgentMetadata: userAgentMetadataFor(userAgent) });
  }
  focus() { return this.send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {}); }

  async setViewport(width: number, height: number) {
    width = Math.max(1, Math.round(width));
    height = Math.max(1, Math.round(height));
    if (width === this.viewport.width && height === this.viewport.height) return;
    this.viewport = { width, height };
    await this.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  }

  get size() { return { ...this.viewport }; }

  /** Streams frames to `listener` until stopped; one listener at a time. */
  async startScreencast(listener: (frame: ScreencastFrame) => void, maxSize?: { width: number; height: number }) {
    this.screencastListener = listener;
    if (!this.titlePoll) {
      this.titlePoll = setInterval(() => this.refreshTitle(), TITLE_POLL_MS);
      this.titlePoll.unref();
    }
    this.screencast = {
      params: { format: "jpeg", quality: 80, everyNthFrame: 1, maxWidth: maxSize?.width ?? this.viewport.width, maxHeight: maxSize?.height ?? this.viewport.height },
      running: false,
    };
    await this.sendScreencast();
  }

  private async sendScreencast() {
    const wanted = this.screencast;
    if (!wanted || this.closed) return;
    try {
      await this.send("Page.startScreencast", wanted.params);
      wanted.running = true;
    } catch {
      wanted.running = false;
    }
  }

  async stopScreencast() {
    this.screencastListener = null;
    this.screencast = null;
    if (this.titlePoll) { clearInterval(this.titlePoll); this.titlePoll = null; }
    if (!this.closed) await this.send("Page.stopScreencast").catch(() => {});
  }

  async close() {
    if (this.closed) return;
    await this.proc.send("Target.closeTarget", { targetId: this.targetId }).catch(() => {});
    this.markClosed();
  }

  /** A debugger session of its own on this page; `onMessage` gets its events and its child sessions'. */
  async attachDebugger(onMessage: (method: string, params: unknown, childSessionId: string | undefined) => void, onDetach: (reason: string) => void) {
    const { sessionId } = await this.proc.send<{ sessionId: string }>("Target.attachToTarget", { targetId: this.targetId, flatten: true });
    const children = new Set<string>();
    const offs = new Map<string, () => void>();
    const route = (child: string | undefined) => (m: CdpMessage) => {
      if (!m.method) return;
      const p = m.params as Record<string, any> | undefined;
      if (m.method === "Target.attachedToTarget" && p?.sessionId && !children.has(p.sessionId)) {
        children.add(p.sessionId);
        offs.set(p.sessionId, this.proc.onSession(p.sessionId, route(p.sessionId)));
      } else if (m.method === "Target.detachedFromTarget" && p?.sessionId && children.has(p.sessionId)) {
        children.delete(p.sessionId);
        offs.get(p.sessionId)?.();
        offs.delete(p.sessionId);
      }
      onMessage(m.method, m.params ?? {}, child);
    };
    offs.set(sessionId, this.proc.onSession(sessionId, route(undefined)));
    const onDetached = (m: CdpMessage) => {
      if (m.method === "Target.detachedFromTarget" && !m.sessionId && (m.params as any)?.sessionId === sessionId) finish("target closed");
    };
    this.proc.on("event", onDetached);
    let done = false;
    const finish = (reason: string) => {
      if (done) return;
      done = true;
      this.proc.off("event", onDetached);
      for (const off of offs.values()) off();
      onDetach(reason);
    };
    this.once("closed", () => finish("target closed"));
    return {
      send: (method: string, params?: Record<string, unknown>, child?: string) => {
        if (done) return Promise.reject(new CdpError(method, -32001, "Debugger is not attached"));
        return this.proc.send(method, params ?? {}, child ?? sessionId);
      },
      detach: () => {
        void this.proc.send("Target.detachFromTarget", { sessionId }).catch(() => {});
        finish("canceled_by_user");
      },
    };
  }
}
