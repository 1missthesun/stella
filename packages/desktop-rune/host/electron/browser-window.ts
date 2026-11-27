// BrowserWindow / BaseWindow / View / WebContentsView over the engine's <window> elements.
// Each window is an entry in `hostWindows`; the host root renders one <window id> per visible
// entry (an app window mounts the Stella UI for its mode, a web window an engine <webview>), and
// the engine's window events come back here as Electron events.

import { EventEmitter } from "node:events";
import { WebContents, contentsKindOf, type ContentsKind } from "./web-contents";
import { engine, onEngine, warnOnce, type EngineBounds } from "./engine";
import { primaryDisplaySync } from "./screen";
import { app } from "./app";

export type Rectangle = { x: number; y: number; width: number; height: number };

export type WindowSnapshot = {
  id: string;
  /** The `<window id>` to render: "main" for the app window bound to the engine's launch window. */
  engineId: string;
  contentsId: number;
  kind: ContentsKind;
  mode: string | null;
  url: string;
  title: string;
  visible: boolean;
  focusable: boolean;
  alwaysOnTop: boolean;
  opacity: number;
  ignoreMouseEvents: boolean;
  bounds: Rectangle;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  resizable: boolean;
  frameless: boolean;
  transparent: boolean;
  backgroundColor?: string;
  skipTaskbar: boolean;
  windowKind: "main" | "panel" | "overlay";
  fullscreen: boolean;
  reloadToken: number;
  /** The page's zoom factor (`webContents.setZoomFactor`). */
  zoom: number;
  parentId: string | null;
  /** The window whose page opened this one with window.open, and the name it gave. */
  openerId: string | null;
  frameName: string | null;
  modal: boolean;
  views: Array<{ contentsId: number; url: string; bounds: Rectangle; visible: boolean; browser: boolean }>;
  /** The window's own page is a Chromium page (a popup from the in-app browser): drawn from its frames. */
  browser: boolean;
  /** Renders offscreen or has never loaded anything (a drawable host): there is nothing to show. */
  drawsNothing: boolean;
};

type Listener = () => void;

class HostWindows {
  private readonly byId = new Map<string, BrowserWindow>();
  private readonly listeners = new Set<Listener>();
  private cached: WindowSnapshot[] | null = null;

  private mainId: string | null = null;
  private readonly mountedIds = new Set<string>();
  private readonly deferred = new Map<string, Map<string, () => void>>();

  add(win: BrowserWindow) { this.byId.set(win.hostId, win); this.changed(); }
  remove(win: BrowserWindow) {
    this.byId.delete(win.hostId);
    this.deferred.delete(win.engineId);
    this.mountedIds.delete(win.engineId);
    if (this.mainId === win.hostId) this.mainId = null;
    this.changed();
  }
  get(id: string) { return this.byId.get(id === "main" && this.mainId ? this.mainId : id) ?? null; }

  /** Binds `win` to the native window the engine opened at launch (`<window id="main">`). */
  bindMain(win: BrowserWindow) {
    this.mainId = win.hostId;
    this.mounted("main");
    this.changed();
  }
  isMain(win: BrowserWindow) { return this.mainId === win.hostId; }

  /** The UI reports a `<window>` it mounted; window commands issued before then run now. */
  mounted(engineId: string) {
    this.mountedIds.add(engineId);
    const calls = this.deferred.get(engineId);
    this.deferred.delete(engineId);
    for (const run of calls?.values() ?? []) run();
  }
  unmounted(engineId: string) { this.mountedIds.delete(engineId); }

  /** Runs `run` now when the window's element exists, else once it mounts (latest call per name). */
  whenMounted(engineId: string, name: string, run: () => void) {
    if (this.mountedIds.has(engineId)) return run();
    let calls = this.deferred.get(engineId);
    if (!calls) this.deferred.set(engineId, (calls = new Map()));
    calls.set(name, run);
  }
  all() { return [...this.byId.values()]; }

  changed() {
    this.cached = null;
    for (const l of [...this.listeners]) l();
  }

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /** Stable between changes, for useSyncExternalStore. */
  snapshot = (): WindowSnapshot[] => {
    this.cached ??= this.all().map((w) => w.snapshot());
    return this.cached;
  };
}

export const hostWindows = new HostWindows();

let nextWindow = 1;
const viewChanged = () => hostWindows.changed();

const modeOf = (url: string): string | null => {
  if (contentsKindOf(url) !== "app") return null;
  try {
    const u = new URL(url);
    const page = u.pathname.replace(/^\//, "");
    return u.searchParams.get("window") ?? (page.startsWith("overlay") ? "overlay" : page.startsWith("companion") ? "companion" : "full");
  } catch {
    return null;
  }
};

export class View extends EventEmitter {
  readonly children: View[] = [];
  protected bounds: Rectangle = { x: 0, y: 0, width: 0, height: 0 };
  protected visible = true;
  protected backgroundColor = "#00000000";
  constructor(_options?: unknown) { super(); }
  addChildView(view: View, index?: number) {
    const at = this.children.indexOf(view);
    if (at >= 0) this.children.splice(at, 1);
    if (index === undefined) this.children.push(view); else this.children.splice(index, 0, view);
    viewChanged();
  }
  removeChildView(view: View) {
    const at = this.children.indexOf(view);
    if (at >= 0) this.children.splice(at, 1);
    viewChanged();
  }
  setBounds(bounds: Rectangle) { this.bounds = { ...bounds }; this.emit("bounds-changed"); viewChanged(); }
  getBounds() { return { ...this.bounds }; }
  setVisible(visible: boolean) { this.visible = visible; viewChanged(); }
  getVisible() { return this.visible; }
  setBackgroundColor(color: string) { this.backgroundColor = color; }
  setBorderRadius() {}
}

export class WebContentsView extends View {
  readonly webContents: WebContents;
  constructor(options: { webPreferences?: { partition?: string; session?: any; offscreen?: boolean | object } } = {}) {
    super(options);
    this.webContents = new WebContents({
      partition: options.webPreferences?.partition,
      session: options.webPreferences?.session,
      offscreen: Boolean(options.webPreferences?.offscreen),
      browser: true,
    });
    this.webContents.owner = this as unknown as { id: number };
    this.webContents.on("did-start-loading", () => viewChanged());
    this.on("bounds-changed", () => this.webContents.setPageSize(this.bounds.width, this.bounds.height));
  }
}

type WindowOptions = {
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  show?: boolean;
  frame?: boolean;
  transparent?: boolean;
  backgroundColor?: string;
  alwaysOnTop?: boolean;
  focusable?: boolean;
  resizable?: boolean;
  skipTaskbar?: boolean;
  title?: string;
  parent?: BrowserWindow;
  modal?: boolean;
  type?: string;
  fullscreen?: boolean;
  opacity?: number;
  titleBarStyle?: string;
  webPreferences?: { partition?: string; session?: any; offscreen?: boolean | object; preload?: string };
  /** A page Chromium already opened (a popup) that this window shows. */
  adoptTarget?: string;
};

type PreventableEvent = { preventDefault(): void; defaultPrevented: boolean; sender?: unknown };
const preventable = (sender: unknown): PreventableEvent => {
  const e: PreventableEvent = { defaultPrevented: false, sender, preventDefault() { e.defaultPrevented = true; } };
  return e;
};

export class BaseWindow extends EventEmitter {
  static getAllWindows() { return BrowserWindow.getAllWindows(); }
  static getFocusedWindow() { return BrowserWindow.getFocusedWindow(); }
  static fromId(id: number) { return BrowserWindow.fromId(id); }
}

export class BrowserWindow extends BaseWindow {
  readonly id = nextWindow++;
  readonly hostId = `w${this.id}`;
  opener: { window: BrowserWindow; frameName: string } | null = null;
  get engineId() { return hostWindows.isMain(this) ? "main" : this.hostId; }
  readonly webContents: WebContents;
  readonly contentView = new View();
  private readonly options: WindowOptions;
  private state: {
    title: string;
    visible: boolean;
    focused: boolean;
    focusable: boolean;
    alwaysOnTop: boolean;
    opacity: number;
    ignoreMouseEvents: boolean;
    bounds: Rectangle;
    resizable: boolean;
    minimized: boolean;
    maximized: boolean;
    fullscreen: boolean;
    skipTaskbar: boolean;
    reloadToken: number;
    minSize: [number, number];
    maxSize: [number, number];
    contentProtection: boolean;
    menuBarVisible: boolean;
    representedFilename: string;
    documentEdited: boolean;
  };
  private destroyed = false;
  private parent: BrowserWindow | null;
  private readonly shownOnce: { value: boolean } = { value: false };

  static getAllWindows(): BrowserWindow[] {
    return hostWindows.all().filter((w) => !w.isDestroyed());
  }
  static getFocusedWindow(): BrowserWindow | null {
    return BrowserWindow.getAllWindows().find((w) => w.isFocused()) ?? null;
  }
  static fromId(id: number): BrowserWindow | null {
    return BrowserWindow.getAllWindows().find((w) => w.id === id) ?? null;
  }
  static fromWebContents(contents: WebContents): BrowserWindow | null {
    return BrowserWindow.getAllWindows().find((w) => w.webContents === contents || w.hasView(contents)) ?? null;
  }
  static fromBrowserView() { return null; }

  constructor(options: WindowOptions = {}) {
    super();
    this.setMaxListeners(0);
    this.options = options;
    const offscreen = Boolean(options.webPreferences?.offscreen);
    this.webContents = new WebContents({
      partition: options.webPreferences?.partition,
      session: options.webPreferences?.session,
      offscreen,
      browser: offscreen || options.adoptTarget !== undefined,
      adoptTarget: options.adoptTarget,
    });
    this.webContents.owner = this;
    this.parent = options.parent ?? null;
    const work = primaryDisplaySync().workArea;
    const width = options.width ?? 800;
    const height = options.height ?? 600;
    this.state = {
      title: options.title ?? "Stella",
      visible: false,
      focused: false,
      focusable: options.focusable ?? true,
      alwaysOnTop: options.alwaysOnTop ?? false,
      opacity: options.opacity ?? 1,
      ignoreMouseEvents: false,
      bounds: {
        x: options.x ?? Math.round(work.x + (work.width - width) / 2),
        y: options.y ?? Math.round(work.y + (work.height - height) / 2),
        width,
        height,
      },
      resizable: options.resizable ?? true,
      minimized: false,
      maximized: false,
      fullscreen: options.fullscreen ?? false,
      skipTaskbar: options.skipTaskbar ?? false,
      reloadToken: 0,
      minSize: [options.minWidth ?? 0, options.minHeight ?? 0],
      maxSize: [options.maxWidth ?? 0, options.maxHeight ?? 0],
      contentProtection: false,
      menuBarVisible: false,
      representedFilename: "",
      documentEdited: false,
    };
    this.webContents.on("did-start-loading", () => hostWindows.changed());
    this.webContents.on("did-finish-load", () => {
      if (!this.shownOnce.value) {
        this.shownOnce.value = true;
        this.emit("ready-to-show");
      }
    });
    this.webContents.on("page-title-updated", (_e: unknown, title: string) => { this.state.title = title; hostWindows.changed(); });
    if (this.webContents.isOffscreen() || options.adoptTarget) {
      this.webContents.setPageSize(width, height);
      this.on("resize", () => this.webContents.setPageSize(this.state.bounds.width, this.state.bounds.height));
    }
    hostWindows.add(this);
    app.emit("web-contents-created", {}, this.webContents);
    app.emit("browser-window-created", {}, this);
    if (options.show !== false) this.show();
  }

  snapshot(): WindowSnapshot {
    const url = this.webContents.getURL();
    const mode = modeOf(url);
    const o = this.options;
    const views: WindowSnapshot["views"] = [];
    const walk = (view: View) => {
      for (const child of view.children) {
        if (child instanceof WebContentsView && !child.webContents.isDestroyed()) {
          views.push({ contentsId: child.webContents.id, url: child.webContents.getURL(), bounds: child.getBounds(), visible: child.getVisible(), browser: child.webContents.isBrowserBacked });
        }
        walk(child);
      }
    };
    walk(this.contentView);
    return {
      id: this.hostId,
      engineId: this.engineId,
      contentsId: this.webContents.id,
      kind: this.opener && (url === "about:blank" || url === "") ? this.opener.window.snapshot().kind : contentsKindOf(url),
      mode,
      url,
      title: this.state.title,
      visible: this.state.visible && !this.state.minimized,
      focusable: this.state.focusable,
      alwaysOnTop: this.state.alwaysOnTop,
      opacity: this.state.opacity,
      ignoreMouseEvents: this.state.ignoreMouseEvents,
      bounds: { ...this.state.bounds },
      minWidth: this.state.minSize[0] || undefined,
      minHeight: this.state.minSize[1] || undefined,
      maxWidth: this.state.maxSize[0] || undefined,
      maxHeight: this.state.maxSize[1] || undefined,
      resizable: this.state.resizable,
      frameless: o.frame === false,
      transparent: o.transparent === true,
      backgroundColor: o.backgroundColor,
      skipTaskbar: this.state.skipTaskbar,
      windowKind: mode === "overlay" ? "overlay" : mode === "companion" || mode === "companion-panel" || o.type === "panel" ? "panel" : "main",
      fullscreen: this.state.fullscreen,
      reloadToken: this.state.reloadToken,
      zoom: this.webContents.zoomFactor,
      parentId: this.parent?.hostId ?? null,
      openerId: this.opener?.window.hostId ?? null,
      frameName: this.opener?.frameName ?? null,
      modal: o.modal === true,
      views,
      browser: this.webContents.isBrowserBacked,
      drawsNothing: this.webContents.isOffscreen() || (url === "" && !this.opener),
    };
  }

  hasView(contents: WebContents): boolean {
    const walk = (view: View): boolean => view.children.some((c) => (c instanceof WebContentsView && c.webContents === contents) || walk(c));
    return walk(this.contentView);
  }

  private set(patch: Partial<BrowserWindow["state"]>) {
    Object.assign(this.state, patch);
    hostWindows.changed();
  }

  private engineCall(name: string, call: (e: NonNullable<ReturnType<typeof engine>>, id: string) => Promise<unknown>) {
    const e = engine();
    if (!e) return;
    hostWindows.whenMounted(this.engineId, name, () => {
      call(e, this.engineId).catch((error) => warnOnce(`window-${name}`, `engine.window.${name} failed: ${error instanceof Error ? error.message : String(error)}`));
    });
  }

  handleEngineEvent(kind: string, bounds?: EngineBounds, size?: { w?: number; h?: number }) {
    if (bounds) this.state.bounds = { ...bounds };
    if (size?.w !== undefined && size.h !== undefined) this.state.bounds = { ...this.state.bounds, width: size.w, height: size.h };
    switch (kind) {
      case "close-requested": this.close(); return;
      case "closed": this.destroy(); return;
      case "focus": this.state.focused = true; this.webContents.markFocused(true); this.emit("focus"); break;
      case "blur": this.state.focused = false; this.webContents.markFocused(false); this.emit("blur"); break;
      case "resize": this.emit("resize"); this.emit("resized"); break;
      case "move": this.emit("move"); this.emit("moved"); break;
      case "maximize": this.state.maximized = true; this.emit("maximize"); break;
      case "unmaximize": this.state.maximized = false; this.emit("unmaximize"); break;
      case "minimize": this.state.minimized = true; this.emit("minimize"); break;
      case "restore": this.state.minimized = false; this.emit("restore"); break;
      case "enter-full-screen": this.state.fullscreen = true; this.emit("enter-full-screen"); break;
      case "leave-full-screen": this.state.fullscreen = false; this.emit("leave-full-screen"); break;
      case "show": this.state.visible = true; this.emit("show"); break;
      case "hide": this.state.visible = false; this.emit("hide"); break;
    }
    hostWindows.changed();
  }

  isDestroyed() { return this.destroyed; }
  isVisible() { return this.state.visible && !this.state.minimized; }
  isFocused() { return this.state.focused; }
  isMinimized() { return this.state.minimized; }
  isMaximized() { return this.state.maximized; }
  isFullScreen() { return this.state.fullscreen; }
  isSimpleFullScreen() { return this.state.fullscreen; }
  isNormal() { return !this.state.minimized && !this.state.maximized && !this.state.fullscreen; }
  isAlwaysOnTop() { return this.state.alwaysOnTop; }
  isFocusable() { return this.state.focusable; }
  isResizable() { return this.state.resizable; }
  isMovable() { return true; }
  isMinimizable() { return true; }
  isMaximizable() { return true; }
  isClosable() { return true; }
  isFullScreenable() { return true; }
  isModal() { return this.options.modal === true; }
  isKiosk() { return false; }
  isEnabled() { return true; }
  isMenuBarVisible() { return this.state.menuBarVisible; }
  isMenuBarAutoHide() { return true; }
  isVisibleOnAllWorkspaces() { return false; }
  isDocumentEdited() { return this.state.documentEdited; }
  isTabletMode() { return false; }
  getTitle() { return this.state.title; }
  getOpacity() { return this.state.opacity; }
  getParentWindow() { return this.parent; }
  getChildWindows() { return BrowserWindow.getAllWindows().filter((w) => w.parent === this); }
  getNativeWindowHandle() { return Buffer.alloc(8); }
  getMediaSourceId() { return `window:${this.id}:0`; }
  getBackgroundColor() { return this.options.backgroundColor ?? "#FFFFFF"; }
  getRepresentedFilename() { return this.state.representedFilename; }
  getBounds(): Rectangle { return { ...this.state.bounds }; }
  getContentBounds(): Rectangle { return { ...this.state.bounds }; }
  getNormalBounds(): Rectangle { return { ...this.state.bounds }; }
  getSize(): [number, number] { return [this.state.bounds.width, this.state.bounds.height]; }
  getContentSize(): [number, number] { return [this.state.bounds.width, this.state.bounds.height]; }
  getPosition(): [number, number] { return [this.state.bounds.x, this.state.bounds.y]; }
  getMinimumSize(): [number, number] { return [...this.state.minSize]; }
  getMaximumSize(): [number, number] { return [...this.state.maxSize]; }
  getBrowserView() { return null; }
  getBrowserViews() { return []; }

  setTitle(title: string) { this.set({ title }); }
  setOpacity(opacity: number) { this.set({ opacity }); }
  setAlwaysOnTop(on: boolean) { this.set({ alwaysOnTop: on }); }
  setFocusable(on: boolean) { this.set({ focusable: on }); }
  setResizable(on: boolean) { this.set({ resizable: on }); }
  setSkipTaskbar(on: boolean) { this.set({ skipTaskbar: on }); }
  setIgnoreMouseEvents(ignore: boolean, _opts?: unknown) { this.set({ ignoreMouseEvents: ignore }); }
  setContentProtection(on: boolean) { this.set({ contentProtection: on }); }
  setMinimumSize(w: number, h: number) { this.set({ minSize: [w, h] }); }
  setMaximumSize(w: number, h: number) { this.set({ maxSize: [w, h] }); }
  setMenuBarVisibility(v: boolean) { this.state.menuBarVisible = v; }
  setAutoHideMenuBar() {}
  setMenu() {}
  removeMenu() {}
  setBackgroundColor(color: string) { this.options.backgroundColor = color; hostWindows.changed(); }
  setHasShadow() {}
  hasShadow() { return true; }
  setVibrancy() {}
  setBackgroundMaterial() {}
  setVisualEffectState() {}
  setVisibleOnAllWorkspaces() {}
  setWindowButtonVisibility() {}
  setWindowButtonPosition() {}
  getWindowButtonPosition() { return null; }
  setTrafficLightPosition() {}
  setTitleBarOverlay() {}
  setIcon() {}
  setOverlayIcon(overlay: unknown, description = "") {
    const count = Number(/^\d+/.exec(description)?.[0] ?? (overlay ? 1 : 0));
    app.showBadge(count > 0 ? String(count) : "", count);
  }
  setThumbarButtons() { return true; }
  setThumbnailClip() {}
  setThumbnailToolTip() {}
  setAppDetails() {}
  setProgressBar() {}
  setRepresentedFilename(f: string) { this.state.representedFilename = f; }
  setDocumentEdited(e: boolean) { this.state.documentEdited = e; }
  setKiosk() {}
  setEnabled() {}
  setMovable() {}
  setMinimizable() {}
  setMaximizable() {}
  setClosable() {}
  setFullScreenable() {}
  setAspectRatio() {}
  setShape() {}
  setParentWindow(parent: BrowserWindow | null) { this.parent = parent; hostWindows.changed(); }
  setSheetOffset() {}
  setAccentColor() {}
  previewFile() {}
  closeFilePreview() {}
  addTabbedWindow() {}
  selectPreviousTab() {}
  selectNextTab() {}
  mergeAllWindows() {}
  moveTabToNewWindow() {}
  toggleTabBar() {}
  setTouchBar() {}
  invalidateShadow() {}
  hookWindowMessage() {}
  isWindowMessageHooked() { return false; }
  unhookWindowMessage() {}
  unhookAllWindowMessages() {}
  flashFrame() {}
  capturePage() { return this.webContents.capturePage(); }
  loadURL(url: string, options?: unknown) { return this.webContents.loadURL(url, options); }
  loadFile(file: string, options?: { query?: Record<string, string>; hash?: string; search?: string }) { return this.webContents.loadFile(file, options); }
  reload() { this.webContents.reload(); }
  setContentView(view: View) { this.contentView.children.length = 0; this.contentView.addChildView(view); }
  addBrowserView() { warnOnce("browserview", "BrowserView is not supported; use WebContentsView"); }
  removeBrowserView() {}
  setBrowserView() {}
  setTopBrowserView() {}

  setBounds(bounds: Partial<Rectangle>, _animate?: boolean) {
    this.set({ bounds: { ...this.state.bounds, ...bounds } });
    this.engineCall("setBounds", (e, id) => e.window.setBounds(id, bounds));
    this.emit("resize");
    this.emit("move");
  }
  setContentBounds(bounds: Partial<Rectangle>) { this.setBounds(bounds); }
  setSize(width: number, height: number) { this.setBounds({ width, height }); }
  setContentSize(width: number, height: number) { this.setBounds({ width, height }); }
  setPosition(x: number, y: number) { this.setBounds({ x, y }); }
  center() { this.engineCall("center", (e, id) => e.window.center(id)); }

  show() {
    if (this.destroyed) return;
    const wasVisible = this.state.visible;
    this.set({ visible: true, minimized: false });
    this.engineCall("show", (e, id) => e.window.show(id));
    if (this.state.focusable) this.focus();
    if (!wasVisible) this.emit("show");
  }
  showInactive() {
    if (this.destroyed) return;
    const wasVisible = this.state.visible;
    this.set({ visible: true, minimized: false });
    if (!wasVisible) this.emit("show");
  }
  hide() {
    if (this.destroyed || !this.state.visible) return;
    this.set({ visible: false, focused: false });
    this.engineCall("hide", (e, id) => e.window.hide(id));
    this.emit("hide");
  }
  focus() {
    if (this.destroyed || !this.state.focusable) return;
    // Focus is the window manager's to grant (Hyprland, GNOME and macOS may refuse it): only the engine's focus event marks it.
    this.engineCall("focus", (e, id) => e.window.focus(id));
  }
  blur() { if (this.state.focused) this.handleEngineEvent("blur"); }
  moveTop() { this.focus(); }
  moveAbove() {}
  minimize() { this.set({ minimized: true }); this.engineCall("minimize", (e, id) => e.window.minimize(id)); this.emit("minimize"); }
  restore() { this.set({ minimized: false }); this.engineCall("show", (e, id) => e.window.show(id)); this.emit("restore"); }
  maximize() { this.set({ maximized: true }); this.engineCall("maximize", (e, id) => e.window.maximize(id)); this.emit("maximize"); }
  unmaximize() { this.set({ maximized: false }); this.engineCall("unmaximize", (e, id) => e.window.unmaximize(id)); this.emit("unmaximize"); }
  setFullScreen(on: boolean) { this.set({ fullscreen: on }); this.engineCall("setFullScreen", (e, id) => e.window.setFullScreen(id, on)); this.emit(on ? "enter-full-screen" : "leave-full-screen"); }
  setSimpleFullScreen(on: boolean) { this.setFullScreen(on); }

  bumpReload() { this.set({ reloadToken: this.state.reloadToken + 1 }); }

  close() {
    if (this.destroyed) return;
    const event = preventable(this);
    this.emit("close", event);
    if (event.defaultPrevented) return;
    this.destroy();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.state.visible = false;
    hostWindows.remove(this);
    this.emit("closed");
    this.webContents.destroy();
    this.removeAllListeners();
    queueMicrotask(() => {
      if (BrowserWindow.getAllWindows().length === 0) windowsAllClosed();
    });
  }
}

let windowsAllClosed: () => void = () => {};

export function onWindowsAllClosed(handler: () => void) {
  windowsAllClosed = handler;
}

type WindowOpenResponse = { action: "allow" | "deny"; overrideBrowserWindowOptions?: WindowOptions; outlivesOpener?: boolean };

/**
 * window.open from a page: main's window-open handler decides, as in Electron. An allowed window
 * becomes a BrowserWindow whose opener is `openerWindow` ("did-create-window" fires on the opener).
 */
/** A page in the on-demand Chromium opened a window; main's handler on the opener decides, as in Electron. */
export function openChromiumPopup(opener: WebContents, targetId: string, url: string) {
  const handler = opener.getWindowOpenHandler() as ((details: unknown) => WindowOpenResponse) | null;
  const details = { url, frameName: "", features: "", disposition: "foreground-tab", referrer: { url: opener.getURL(), policy: "strict-origin-when-cross-origin" }, postBody: undefined };
  const decision: WindowOpenResponse = handler ? handler(details) ?? { action: "deny" } : { action: "allow" };
  if (decision.action !== "allow") {
    void opener.chromiumPage().then((page) => page.proc.send("Target.closeTarget", { targetId })).catch(() => {});
    return null;
  }
  const options = decision.overrideBrowserWindowOptions ?? {};
  const win = new BrowserWindow({ ...options, webPreferences: { session: opener.session, ...options.webPreferences }, adoptTarget: targetId });
  const openerWindow = BrowserWindow.fromWebContents(opener);
  if (openerWindow) win.opener = { window: openerWindow, frameName: "" };
  opener.emit("did-create-window", win, { url, frameName: "", options, disposition: "foreground-tab" });
  void win.webContents.chromiumPage();
  hostWindows.changed();
  return win;
}

/** window.open's `left,top,width,height` features as window options, under the open handler's overrides (as in Electron). */
function featureOptions(features: string): Record<string, number> {
  const keys: Record<string, string> = { left: "x", top: "y", width: "width", height: "height" };
  const options: Record<string, number> = {};
  for (const part of features.split(",")) {
    const [key, value] = part.split("=").map((s) => s.trim());
    const option = key ? keys[key] : undefined;
    const n = Number(value);
    if (option && value && Number.isFinite(n)) options[option] = Math.round(n);
  }
  return options;
}

export function openWindowFrom(openerWindow: BrowserWindow, url: string, frameName = "", features = ""): BrowserWindow | null {
  const opener = openerWindow.webContents;
  const handler = opener.getWindowOpenHandler() as ((details: unknown) => WindowOpenResponse) | null;
  const details = { url, frameName, features, disposition: "new-window", referrer: { url: opener.getURL(), policy: "default" }, postBody: undefined };
  const decision: WindowOpenResponse = handler ? handler(details) ?? { action: "deny" } : { action: "allow" };
  if (decision.action !== "allow") return null;
  const win = new BrowserWindow({ ...featureOptions(features), ...(decision.overrideBrowserWindowOptions ?? {}) });
  win.opener = { window: openerWindow, frameName };
  opener.emit("did-create-window", win, { url, frameName, options: decision.overrideBrowserWindowOptions ?? {}, disposition: "new-window" });
  void win.webContents.loadURL(url || "about:blank");
  hostWindows.changed();
  return win;
}

onEngine("window", (event) => {
  hostWindows.get(event.id)?.handleEngineEvent(event.kind, event.bounds, event);
});

WebContents.host.onPopup = (opener, targetId, url) => { openChromiumPopup(opener, targetId, url); };
WebContents.host.onReload = (contents) => {
  const owner = BrowserWindow.getAllWindows().find((w) => w.webContents === contents);
  owner?.bumpReload();
};
WebContents.host.onZoom = () => hostWindows.changed();
WebContents.host.onFocus = (contents) => {
  BrowserWindow.getAllWindows().find((w) => w.webContents === contents)?.focus();
};
