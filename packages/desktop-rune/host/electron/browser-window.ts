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
  parentId: string | null;
  modal: boolean;
  views: Array<{ contentsId: number; url: string; bounds: Rectangle; visible: boolean }>;
};

type Listener = () => void;

class HostWindows {
  private readonly byId = new Map<string, BrowserWindow>();
  private readonly listeners = new Set<Listener>();
  private cached: WindowSnapshot[] | null = null;

  add(win: BrowserWindow) { this.byId.set(win.hostId, win); this.changed(); }
  remove(win: BrowserWindow) { this.byId.delete(win.hostId); this.changed(); }
  get(id: string) { return this.byId.get(id) ?? null; }
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
  constructor(options: { webPreferences?: { partition?: string; session?: any; offscreen?: boolean } } = {}) {
    super(options);
    this.webContents = new WebContents({ partition: options.webPreferences?.partition, session: options.webPreferences?.session });
    this.webContents.owner = this as unknown as { id: number };
    this.webContents.on("did-start-loading", () => viewChanged());
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
  webPreferences?: { partition?: string; session?: any; offscreen?: boolean; preload?: string };
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
    this.webContents = new WebContents({ partition: options.webPreferences?.partition, session: options.webPreferences?.session });
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
          views.push({ contentsId: child.webContents.id, url: child.webContents.getURL(), bounds: child.getBounds(), visible: child.getVisible() });
        }
        walk(child);
      }
    };
    walk(this.contentView);
    return {
      id: this.hostId,
      contentsId: this.webContents.id,
      kind: contentsKindOf(url),
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
      parentId: this.parent?.hostId ?? null,
      modal: o.modal === true,
      views,
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

  private engineCall(name: string, call: (e: NonNullable<ReturnType<typeof engine>>) => Promise<unknown>) {
    const e = engine();
    if (!e) return;
    call(e).catch((error) => warnOnce(`window-${name}`, `engine.window.${name} failed: ${error instanceof Error ? error.message : String(error)}`));
  }

  handleEngineEvent(kind: string, bounds?: EngineBounds) {
    if (bounds) this.state.bounds = { ...bounds };
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
      case "fullscreen": this.state.fullscreen = !this.state.fullscreen; this.emit(this.state.fullscreen ? "enter-full-screen" : "leave-full-screen"); break;
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
  setOverlayIcon() {}
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
    this.engineCall("setBounds", (e) => e.window.setBounds(this.hostId, bounds));
    this.emit("resize");
    this.emit("move");
  }
  setContentBounds(bounds: Partial<Rectangle>) { this.setBounds(bounds); }
  setSize(width: number, height: number) { this.setBounds({ width, height }); }
  setContentSize(width: number, height: number) { this.setBounds({ width, height }); }
  setPosition(x: number, y: number) { this.setBounds({ x, y }); }
  center() { this.engineCall("center", (e) => e.window.center(this.hostId)); }

  show() {
    if (this.destroyed) return;
    const wasVisible = this.state.visible;
    this.set({ visible: true, minimized: false });
    this.engineCall("show", (e) => e.window.show(this.hostId));
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
    this.engineCall("hide", (e) => e.window.hide(this.hostId));
    this.emit("hide");
  }
  focus() {
    if (this.destroyed || !this.state.focusable) return;
    for (const other of BrowserWindow.getAllWindows()) if (other !== this && other.state.focused) other.handleEngineEvent("blur");
    if (!this.state.focused) {
      this.state.focused = true;
      this.webContents.markFocused(true);
      this.emit("focus");
    }
    this.engineCall("focus", (e) => e.window.focus(this.hostId));
  }
  blur() { if (this.state.focused) this.handleEngineEvent("blur"); }
  moveTop() { this.focus(); }
  moveAbove() {}
  minimize() { this.set({ minimized: true }); this.engineCall("minimize", (e) => e.window.minimize(this.hostId)); this.emit("minimize"); }
  restore() { this.set({ minimized: false }); this.engineCall("show", (e) => e.window.show(this.hostId)); this.emit("restore"); }
  maximize() { this.set({ maximized: true }); this.engineCall("maximize", (e) => e.window.maximize(this.hostId)); this.emit("maximize"); }
  unmaximize() { this.set({ maximized: false }); this.engineCall("unmaximize", (e) => e.window.unmaximize(this.hostId)); this.emit("unmaximize"); }
  setFullScreen(on: boolean) { this.set({ fullscreen: on }); this.engineCall("setFullScreen", (e) => e.window.setFullScreen(this.hostId, on)); this.emit(on ? "enter-full-screen" : "leave-full-screen"); }
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

onEngine("window", (event) => {
  hostWindows.get(event.id)?.handleEngineEvent(event.kind, event.bounds);
});

WebContents.host.onReload = (contents) => {
  const owner = BrowserWindow.getAllWindows().find((w) => w.webContents === contents);
  owner?.bumpReload();
};
WebContents.host.onFocus = (contents) => {
  BrowserWindow.getAllWindows().find((w) => w.webContents === contents)?.focus();
};
