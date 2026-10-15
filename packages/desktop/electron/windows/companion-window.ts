import {
  BrowserWindow,
  Menu,
  screen,
  type Display,
  type IpcMainEvent,
  type Rectangle,
  type WebContents,
} from "electron";
import {
  COMPANION_COMPACT_SIZE,
  COMPANION_FULL_SIZE,
  COMPANION_MARK_BOTTOM_INSET,
  COMPANION_MARK_SIZE,
  EMPTY_COMPANION_STATE,
  type CompanionActivity,
  type CompanionAnchor,
  type CompanionDragMove,
  type CompanionEdgeH,
  type CompanionEdgeV,
  type CompanionLayout,
  type CompanionPanelStatus,
  type CompanionState,
  type CompanionWindowKind,
} from "@stella/contracts/desktop/companion";
import {
  IPC_COMPANION_ACTIVITY,
  IPC_COMPANION_DRAG_END,
  IPC_COMPANION_DRAG_MOVE,
  IPC_COMPANION_DRAG_START,
  IPC_COMPANION_FOCUS,
  IPC_COMPANION_HELLO,
  IPC_COMPANION_HOVER,
  IPC_COMPANION_LAYOUT,
  IPC_COMPANION_OPEN_MAIN,
  IPC_COMPANION_PANEL_STATUS,
  IPC_COMPANION_SET_EXPANDED,
  IPC_COMPANION_SHOW_CONTEXT_MENU,
  IPC_COMPANION_STATE,
  IPC_COMPANION_TOGGLE_EXPANDED,
} from "@stella/contracts/desktop/ipc-channels";
import {
  getCompanionAnchor,
  setCompanionAnchor,
  setCompanionEnabled,
} from "@stella/runtime/kernel/preferences/local-preferences";
import { t } from "../services/i18n-service.js";
import { STELLA_CAPTURE_EXCLUDED_TITLE_PREFIXES } from "../window-capture.js";
import { createSharedWebPreferences } from "./shared-window-preferences.js";
import { loadWindow } from "./window-load.js";
import {
  HyprlandIpc,
  isNativeWayland,
  type HyprlandDispatch,
  type HyprlandMonitor,
} from "./hyprland-ipc.js";
import { onIpc, offIpc } from "../ipc/typed-ipc.js";

export type CompanionWindowOptions = {
  preloadPath: string;
  sessionPartition: string;
  electronDir: string;
  isQuitting: () => boolean;
  getStellaDataDir: () => string | null;
  onOpenMain: () => void;
  hasMainWindow: () => boolean;
  onQuit: () => void;
  onVisibleChanged: (visible: boolean) => void;
};

const READY_TIMEOUT_MS = 4_000;
const EDGE_MARGIN = 6;
const HOVER_GRACE_MS = 340;
const HYPRLAND_ATTACH_TIMEOUT_MS = 3_000;
const HYPRLAND_DRAG_INTERVAL_MS = 16;
// Where the panel waits on Hyprland while it has nothing to show: Wayland
// windows can't pass clicks through, so an idle panel on screen would block
// whatever is under it.
const HYPRLAND_PARK_OFFSET = 20_000;

const IDLE_ACTIVITY: CompanionActivity = {
  hovered: false,
  panelActive: false,
  expanded: false,
  recording: false,
  transcribing: false,
};

const IDLE_PANEL_STATUS: CompanionPanelStatus = {
  expanded: false,
  recording: false,
  transcribing: false,
  wantsVisible: false,
};

type Slot = {
  kind: CompanionWindowKind;
  window: BrowserWindow | null;
  ready: boolean;
  hello: boolean;
  reloadTimer: ReturnType<typeof setTimeout> | null;
};

const loadModeFor = (kind: CompanionWindowKind) =>
  kind === "mark" ? ("companion" as const) : ("companion-panel" as const);

const sameActivity = (a: CompanionActivity, b: CompanionActivity) =>
  a.hovered === b.hovered &&
  a.panelActive === b.panelActive &&
  a.expanded === b.expanded &&
  a.recording === b.recording &&
  a.transcribing === b.transcribing;

export class CompanionWindowController {
  private readonly options: CompanionWindowOptions;
  private readonly mark: Slot = {
    kind: "mark",
    window: null,
    ready: false,
    hello: false,
    reloadTimer: null,
  };
  private readonly panel: Slot = {
    kind: "panel",
    window: null,
    ready: false,
    hello: false,
    reloadTimer: null,
  };
  private destroyed = false;
  private visible = false;
  private anchor: CompanionAnchor | null = null;
  private drag: { offsetX: number; offsetY: number } | null = null;
  private state: CompanionState = EMPTY_COMPANION_STATE;
  private displayHandler: (() => void) | null = null;
  private lastLayout: Partial<Record<CompanionWindowKind, string>> = {};
  private expectedBounds: Partial<Record<CompanionWindowKind, Rectangle>> = {};
  private boundsRepairTimer: ReturnType<typeof setTimeout> | null = null;
  private boundsRepairs: number[] = [];
  private helloWaiters = new Map<CompanionWindowKind, Array<() => void>>();

  // Native Wayland ignores client positions and input shaping; on Hyprland
  // the windows are placed, stacked and dragged through its IPC instead.
  private readonly wayland = isNativeWayland();
  private readonly hypr = HyprlandIpc.connectIfAvailable();
  private hyprAddress: Partial<Record<CompanionWindowKind, string>> = {};
  private hyprAttachRun = 0;
  private hyprMonitors: HyprlandMonitor[] = [];
  private hyprDragTimer: ReturnType<typeof setTimeout> | null = null;
  private hyprDragGeneration = 0;
  private hyprPlacement: Promise<void> = Promise.resolve();

  private markHovered = false;
  private panelHovered = false;
  private hoverGraceTimer: ReturnType<typeof setTimeout> | null = null;
  private hovered = false;
  private panelStatus: CompanionPanelStatus = IDLE_PANEL_STATUS;
  private activity: CompanionActivity = IDLE_ACTIVITY;

  constructor(options: CompanionWindowOptions) {
    this.options = options;
    onIpc(IPC_COMPANION_HELLO, this.handleHello);
    onIpc(IPC_COMPANION_HOVER, this.handleHover);
    onIpc(IPC_COMPANION_PANEL_STATUS, this.handlePanelStatus);
    onIpc(IPC_COMPANION_TOGGLE_EXPANDED, this.handleToggleExpanded);
    onIpc(IPC_COMPANION_DRAG_START, this.handleDragStart);
    onIpc(IPC_COMPANION_DRAG_MOVE, this.handleDragMove);
    onIpc(IPC_COMPANION_DRAG_END, this.handleDragEnd);
    onIpc(IPC_COMPANION_FOCUS, this.handleFocus);
    onIpc(IPC_COMPANION_OPEN_MAIN, this.handleOpenMain);
    onIpc(IPC_COMPANION_SHOW_CONTEXT_MENU, this.handleShowContextMenu);
  }

  getPanelWindow(): BrowserWindow | null {
    return this.live(this.panel);
  }

  getMarkWindow(): BrowserWindow | null {
    return this.live(this.mark);
  }

  isVisible(): boolean {
    const mark = this.live(this.mark);
    return Boolean(this.visible && mark && mark.isVisible());
  }

  isSender(sender: WebContents): boolean {
    return this.kindOf(sender) !== null;
  }

  getState(): CompanionState {
    return this.state;
  }

  setState(state: CompanionState): void {
    this.state = state;
    this.sendToBoth(IPC_COMPANION_STATE, state);
  }

  sendToPanel(channel: string, payload?: unknown): void {
    this.live(this.panel)?.webContents.send(channel, payload);
  }

  async show(
    options: { focus?: boolean; persist?: boolean } = {},
  ): Promise<boolean> {
    if (this.destroyed) return false;
    const persist = options.persist ?? true;
    if (!this.create(this.panel) || !this.create(this.mark)) return false;
    const ready = await Promise.all([
      this.waitForReady(this.panel),
      this.waitForReady(this.mark),
    ]);
    if (!ready.every(Boolean)) return false;
    const panel = this.live(this.panel);
    const mark = this.live(this.mark);
    if (!panel || !mark) return false;
    this.visible = true;
    this.applyBounds();
    if (!panel.isVisible()) panel.showInactive();
    if (!mark.isVisible()) mark.showInactive();
    mark.moveTop();
    this.applyPanelInteractivity();
    if (this.hypr) await this.attachHyprland();
    if (options.focus) this.focusPanel();
    if (persist) {
      const dir = this.options.getStellaDataDir();
      if (dir) setCompanionEnabled(dir, true);
    }
    this.options.onVisibleChanged(true);
    await this.waitForHello(this.panel);
    return true;
  }

  hide(options: { persist?: boolean } = {}): void {
    const persist = options.persist ?? true;
    this.visible = false;
    this.drag = null;
    this.stopHyprlandDrag();
    this.hyprAddress = {};
    this.hyprAttachRun += 1;
    this.resetInteraction();
    if (persist) {
      const dir = this.options.getStellaDataDir();
      if (dir) setCompanionEnabled(dir, false);
    }
    const destroyInstead =
      !this.options.hasMainWindow() && process.platform === "linux";
    for (const slot of [this.mark, this.panel]) {
      const win = this.live(slot);
      if (!win) continue;
      if (destroyInstead) {
        this.destroySlot(slot);
      } else {
        win.hide();
      }
    }
    this.options.onVisibleChanged(false);
  }

  async toggle(): Promise<void> {
    if (this.isVisible()) {
      this.hide();
    } else {
      await this.show({ focus: false });
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    offIpc(IPC_COMPANION_HELLO, this.handleHello);
    offIpc(IPC_COMPANION_HOVER, this.handleHover);
    offIpc(IPC_COMPANION_PANEL_STATUS, this.handlePanelStatus);
    offIpc(IPC_COMPANION_TOGGLE_EXPANDED, this.handleToggleExpanded);
    offIpc(IPC_COMPANION_DRAG_START, this.handleDragStart);
    offIpc(IPC_COMPANION_DRAG_MOVE, this.handleDragMove);
    offIpc(IPC_COMPANION_DRAG_END, this.handleDragEnd);
    offIpc(IPC_COMPANION_FOCUS, this.handleFocus);
    offIpc(IPC_COMPANION_OPEN_MAIN, this.handleOpenMain);
    offIpc(IPC_COMPANION_SHOW_CONTEXT_MENU, this.handleShowContextMenu);
    this.resetInteraction();
    this.stopHyprlandDrag();
    this.detachDisplayListeners();
    if (this.boundsRepairTimer) {
      clearTimeout(this.boundsRepairTimer);
      this.boundsRepairTimer = null;
    }
    this.destroySlot(this.mark);
    this.destroySlot(this.panel);
  }

  private live(slot: Slot): BrowserWindow | null {
    return slot.window && !slot.window.isDestroyed() ? slot.window : null;
  }

  private kindOf(sender: WebContents): CompanionWindowKind | null {
    if (this.live(this.mark)?.webContents === sender) return "mark";
    if (this.live(this.panel)?.webContents === sender) return "panel";
    return null;
  }

  private slotFor(kind: CompanionWindowKind): Slot {
    return kind === "mark" ? this.mark : this.panel;
  }

  private sendToBoth(channel: string, payload?: unknown): void {
    for (const slot of [this.mark, this.panel]) {
      this.live(slot)?.webContents.send(channel, payload);
    }
  }

  private create(slot: Slot): BrowserWindow | null {
    if (this.destroyed) return null;
    const existing = this.live(slot);
    if (existing) return existing;

    slot.ready = false;
    slot.hello = false;
    const { bounds } = this.computeBounds(slot.kind, this.resolveAnchor());
    const isMark = slot.kind === "mark";

    const win = new BrowserWindow({
      ...bounds,
      // macOS: a non-activating panel takes keyboard focus for the composer
      // without activating the app or stealing the menu bar — the same
      // treatment the utility overlay uses.
      ...(process.platform === "darwin" ? { type: "panel" as const } : {}),
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      closable: false,
      skipTaskbar: true,
      hasShadow: false,
      focusable: !isMark,
      show: false,
      title: STELLA_CAPTURE_EXCLUDED_TITLE_PREFIXES[0],
      backgroundColor: "#00000000",
      webPreferences: createSharedWebPreferences({
        preloadPath: this.options.preloadPath,
        sessionPartition: this.options.sessionPartition,
        backgroundThrottling: false,
      }),
    });
    slot.window = win;
    win.setTitle(STELLA_CAPTURE_EXCLUDED_TITLE_PREFIXES[0]);
    win.setAlwaysOnTop(true, "floating");
    win.setContentProtection(true);
    if (process.platform === "darwin") {
      win.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true,
        skipTransformProcessType: true,
      });
      win.excludedFromShownWindowsMenu = true;
      win.setHiddenInMissionControl?.(true);
    } else {
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
    if (!isMark) {
      win.setIgnoreMouseEvents(true);
    }

    win.once("ready-to-show", () => {
      slot.ready = true;
    });
    win.webContents.once("did-finish-load", () => {
      slot.ready = true;
    });
    win.webContents.on("render-process-gone", (_event, details) => {
      console.error(`[companion] ${slot.kind} renderer gone:`, details.reason);
      slot.ready = false;
      slot.hello = false;
      this.scheduleReload(slot);
    });
    win.webContents.on(
      "did-fail-load",
      (_event, errorCode, description, url, isMainFrame) => {
        if (!isMainFrame || errorCode === -3) return;
        console.error(
          `[companion] ${slot.kind} failed to load:`,
          errorCode,
          description,
          url,
        );
        this.scheduleReload(slot);
      },
    );
    win.on("page-title-updated", (event) => {
      event.preventDefault();
    });
    // Tiling window managers may apply size/position rules when the window
    // maps. Re-assert our bounds if they diverge.
    win.on("resize", () => this.scheduleBoundsRepair());
    win.on("move", () => this.scheduleBoundsRepair());
    win.on("close", (event) => {
      if (this.options.isQuitting()) return;
      event.preventDefault();
      this.hide();
    });
    win.on("closed", () => {
      delete this.hyprAddress[slot.kind];
      slot.window = null;
      slot.ready = false;
      slot.hello = false;
      this.drag = null;
    });

    loadWindow(win, { mode: loadModeFor(slot.kind) });
    this.attachDisplayListeners();
    return win;
  }

  private scheduleReload(slot: Slot): void {
    if (slot.reloadTimer) return;
    slot.reloadTimer = setTimeout(() => {
      slot.reloadTimer = null;
      const win = this.live(slot);
      if (!win) return;
      loadWindow(win, { mode: loadModeFor(slot.kind) });
    }, 300);
  }

  private waitForReady(
    slot: Slot,
    timeoutMs = READY_TIMEOUT_MS,
  ): Promise<boolean> {
    const win = this.live(slot);
    if (!win) return Promise.resolve(false);
    if (slot.ready) return Promise.resolve(true);
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        win.removeListener("ready-to-show", onReady);
        win.removeListener("closed", onClosed);
        win.webContents.removeListener("did-finish-load", onReady);
        resolve(value);
      };
      const onReady = () => {
        slot.ready = true;
        finish(true);
      };
      const onClosed = () => finish(false);
      const timer = setTimeout(() => finish(slot.ready), timeoutMs);
      win.once("ready-to-show", onReady);
      win.once("closed", onClosed);
      win.webContents.once("did-finish-load", onReady);
    });
  }

  private waitForHello(
    slot: Slot,
    timeoutMs = READY_TIMEOUT_MS,
  ): Promise<void> {
    if (slot.hello) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      const waiters = this.helloWaiters.get(slot.kind) ?? [];
      waiters.push(done);
      this.helloWaiters.set(slot.kind, waiters);
    });
  }

  private destroySlot(slot: Slot): void {
    if (slot.reloadTimer) {
      clearTimeout(slot.reloadTimer);
      slot.reloadTimer = null;
    }
    if (slot.window) {
      slot.window.removeAllListeners("close");
      if (!slot.window.isDestroyed()) slot.window.destroy();
      slot.window = null;
    }
    slot.ready = false;
    slot.hello = false;
  }

  private attachDisplayListeners(): void {
    if (this.displayHandler) return;
    this.displayHandler = () => {
      this.anchor = this.clampAnchor(this.resolveAnchor());
      this.applyBounds();
      if (this.hypr) {
        void this.refreshHyprlandMonitors().then(() => {
          this.anchor = this.clampAnchor(this.resolveAnchor());
          this.applyBounds();
        });
      }
    };
    screen.on("display-added", this.displayHandler);
    screen.on("display-removed", this.displayHandler);
    screen.on("display-metrics-changed", this.displayHandler);
  }

  private detachDisplayListeners(): void {
    if (!this.displayHandler) return;
    screen.removeListener("display-added", this.displayHandler);
    screen.removeListener("display-removed", this.displayHandler);
    screen.removeListener("display-metrics-changed", this.displayHandler);
    this.displayHandler = null;
  }

  private resolveAnchor(): CompanionAnchor {
    if (this.anchor) return this.anchor;
    const dir = this.options.getStellaDataDir();
    const saved = dir ? getCompanionAnchor(dir) : null;
    if (saved) {
      this.anchor = this.clampAnchor(saved);
      return this.anchor;
    }
    const area = this.workAreaFor(screen.getPrimaryDisplay());
    this.anchor = {
      x: area.x + area.width - 32 - COMPANION_MARK_SIZE / 2,
      y: area.y + area.height - 28,
    };
    return this.anchor;
  }

  /**
   * Wayland doesn't tell clients about panels and bars, so Electron's work
   * area there is the whole output; Hyprland reports what is reserved.
   */
  private workAreaFor(display: Display): Rectangle {
    if (!this.hypr) return display.workArea;
    const { bounds } = display;
    const monitor = this.hyprMonitors.find(
      (m) => Math.round(m.x) === bounds.x && Math.round(m.y) === bounds.y,
    );
    if (!monitor) return display.workArea;
    const [left, top, right, bottom] = monitor.reserved;
    return {
      x: bounds.x + left,
      y: bounds.y + top,
      width: Math.max(1, bounds.width - left - right),
      height: Math.max(1, bounds.height - top - bottom),
    };
  }

  private clampAnchor(anchor: CompanionAnchor): CompanionAnchor {
    const area = this.workAreaFor(screen.getDisplayNearestPoint(anchor));
    const half = COMPANION_MARK_SIZE / 2;
    return {
      x: Math.round(
        Math.min(
          Math.max(anchor.x, area.x + half + EDGE_MARGIN),
          area.x + area.width - half - EDGE_MARGIN,
        ),
      ),
      y: Math.round(
        Math.min(
          Math.max(anchor.y, area.y + COMPANION_MARK_SIZE + EDGE_MARGIN),
          area.y + area.height - EDGE_MARGIN,
        ),
      ),
    };
  }

  private computeBounds(
    kind: CompanionWindowKind,
    anchor: CompanionAnchor,
  ): { bounds: Rectangle; layout: CompanionLayout } {
    const area = this.workAreaFor(screen.getDisplayNearestPoint(anchor));
    const compact = COMPANION_COMPACT_SIZE;
    const compactX = Math.round(anchor.x - compact.width / 2);
    const compactY = Math.round(
      anchor.y + COMPANION_MARK_BOTTOM_INSET - compact.height,
    );
    const edgeH: CompanionEdgeH =
      anchor.x > area.x + area.width / 2 ? "right" : "left";
    const edgeV: CompanionEdgeV =
      anchor.y > area.y + area.height / 2 ? "bottom" : "top";
    const size = kind === "mark" ? compact : COMPANION_FULL_SIZE;
    let x =
      edgeH === "right" ? compactX + compact.width - size.width : compactX;
    let y =
      edgeV === "bottom" ? compactY + compact.height - size.height : compactY;
    x = Math.min(Math.max(x, area.x), area.x + area.width - size.width);
    y = Math.min(Math.max(y, area.y), area.y + area.height - size.height);
    return {
      bounds: { x, y, width: size.width, height: size.height },
      layout: {
        kind,
        width: size.width,
        height: size.height,
        edgeH,
        edgeV,
        anchorX: Math.round(anchor.x - x),
        anchorY: Math.round(anchor.y - y),
      },
    };
  }

  private applyBounds(): void {
    const anchor = this.resolveAnchor();
    for (const slot of [this.panel, this.mark]) {
      const win = this.live(slot);
      if (!win) continue;
      const { bounds, layout } = this.computeBounds(slot.kind, anchor);
      this.expectedBounds[slot.kind] = bounds;
      win.setBounds(bounds, false);
      const serialized = JSON.stringify(layout);
      if (this.lastLayout[slot.kind] !== serialized) {
        this.lastLayout[slot.kind] = serialized;
        win.webContents.send(IPC_COMPANION_LAYOUT, layout);
      }
    }
    this.placeOnHyprland();
  }

  /** Mirrors the bounds just applied onto the real Hyprland windows. */
  private placeOnHyprland(): void {
    const hypr = this.hypr;
    if (!hypr) return;
    const calls: HyprlandDispatch[] = [];
    for (const kind of ["panel", "mark"] as const) {
      const address = this.hyprAddress[kind];
      const bounds = this.expectedBounds[kind];
      if (!address || !bounds) continue;
      const parked = kind === "panel" && !this.activity.panelActive;
      calls.push(
        HyprlandIpc.move(
          address,
          parked ? bounds.x - HYPRLAND_PARK_OFFSET : bounds.x,
          parked ? bounds.y - HYPRLAND_PARK_OFFSET : bounds.y,
        ),
      );
    }
    if (calls.length === 0) return;
    this.hyprPlacement = this.hyprPlacement
      .then(() => hypr.dispatch(calls))
      .catch((error: unknown) => {
        console.warn("[companion] hyprland placement failed:", error);
      });
  }

  private async refreshHyprlandMonitors(): Promise<void> {
    if (!this.hypr) return;
    try {
      this.hyprMonitors = await this.hypr.monitors();
    } catch (error) {
      console.warn("[companion] hyprland monitors failed:", error);
    }
  }

  /**
   * Finds both companion windows in Hyprland once they are mapped, keeps them
   * floating on every workspace, and moves them where they belong. Hyprland
   * first maps them wherever it likes, so this runs after every show.
   */
  private async attachHyprland(): Promise<void> {
    const hypr = this.hypr;
    if (!hypr) return;
    const run = ++this.hyprAttachRun;
    this.hyprAddress = {};
    await this.refreshHyprlandMonitors();
    this.anchor = this.clampAnchor(this.resolveAnchor());
    this.applyBounds();
    const title = STELLA_CAPTURE_EXCLUDED_TITLE_PREFIXES[0];
    const wanted: Record<CompanionWindowKind, { width: number; height: number }> =
      { mark: COMPANION_COMPACT_SIZE, panel: COMPANION_FULL_SIZE };
    const deadline = Date.now() + HYPRLAND_ATTACH_TIMEOUT_MS;
    while (run === this.hyprAttachRun && Date.now() < deadline) {
      let clients;
      try {
        clients = await hypr.clients();
      } catch (error) {
        console.warn("[companion] hyprland clients failed:", error);
        return;
      }
      if (run !== this.hyprAttachRun) return;
      const calls: HyprlandDispatch[] = [];
      for (const kind of ["mark", "panel"] as const) {
        if (this.hyprAddress[kind]) continue;
        const size = wanted[kind];
        const client = clients.find(
          (c) =>
            c.pid === process.pid &&
            c.title === title &&
            c.mapped !== false &&
            c.size[0] === size.width &&
            c.size[1] === size.height &&
            !Object.values(this.hyprAddress).includes(c.address),
        );
        if (!client) continue;
        this.hyprAddress[kind] = client.address;
        if (!client.floating) {
          calls.push({
            lua: `hl.dsp.window.float({ action = 'enable', window = 'address:${client.address}' })`,
            legacy: `setfloating address:${client.address}`,
          });
        }
        if (!client.pinned) calls.push(HyprlandIpc.pin(client.address));
      }
      if (this.hyprAddress.mark || this.hyprAddress.panel) {
        this.applyBounds();
        if (calls.length > 0) {
          try {
            await hypr.dispatch(calls);
          } catch (error) {
            console.warn("[companion] hyprland setup failed:", error);
          }
        }
        this.applyStacking();
      }
      if (this.hyprAddress.mark && this.hyprAddress.panel) return;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }

  private focusPanel(): void {
    const panel = this.live(this.panel);
    if (!panel) return;
    if (!panel.isFocused()) panel.focus();
    const address = this.hyprAddress.panel;
    if (this.hypr && address) {
      void this.hypr
        .dispatch([HyprlandIpc.focus(address)])
        .catch(() => undefined);
    }
  }

  /**
   * While the panel is active it takes the pointer for the mark too (its hull
   * holds the arc buttons and a hit target over the mark), so the mark's own
   * window must not sit on top of the arc and swallow its clicks.
   */
  private applyStacking(): void {
    const panel = this.live(this.panel);
    const mark = this.live(this.mark);
    if (!panel || !mark) return;
    const active = this.activity.panelActive;
    if (process.platform === "darwin" || process.platform === "win32") {
      // The mark stays on top so it keeps drawing over the panel, but lets
      // clicks through to the panel; forwarded moves keep its hover and eyes.
      if (active) mark.setIgnoreMouseEvents(true, { forward: true });
      else mark.setIgnoreMouseEvents(false);
      mark.moveTop();
      return;
    }
    // Linux can't forward mouse moves through an ignoring window, so the
    // transparent panel goes above the mark while active instead.
    const hypr = this.hypr;
    if (hypr) {
      const top = this.hyprAddress[active ? "panel" : "mark"];
      if (!top) return;
      this.hyprPlacement = this.hyprPlacement
        .then(() => hypr.dispatch([HyprlandIpc.raise(top)]))
        .catch(() => undefined);
      return;
    }
    if (active) panel.moveTop();
    else mark.moveTop();
  }

  private startHyprlandDrag(): void {
    const hypr = this.hypr;
    if (!hypr) return;
    this.stopHyprlandDrag();
    const generation = ++this.hyprDragGeneration;
    const anchorAtStart = this.resolveAnchor();
    let offset: { x: number; y: number } | null = null;
    const tick = async () => {
      if (generation !== this.hyprDragGeneration || !this.drag) return;
      try {
        const cursor = await hypr.cursorPos();
        if (generation !== this.hyprDragGeneration || !this.drag) return;
        offset ??= {
          x: cursor.x - anchorAtStart.x,
          y: cursor.y - anchorAtStart.y,
        };
        this.anchor = this.clampAnchor({
          x: cursor.x - offset.x,
          y: cursor.y - offset.y,
        });
        this.applyBounds();
      } catch (error) {
        console.warn("[companion] hyprland cursor failed:", error);
      }
      if (generation !== this.hyprDragGeneration || !this.drag) return;
      this.hyprDragTimer = setTimeout(() => void tick(), HYPRLAND_DRAG_INTERVAL_MS);
    };
    void tick();
  }

  private stopHyprlandDrag(): void {
    this.hyprDragGeneration += 1;
    if (this.hyprDragTimer) {
      clearTimeout(this.hyprDragTimer);
      this.hyprDragTimer = null;
    }
  }

  private sendLayout(kind: CompanionWindowKind): void {
    const win = this.live(this.slotFor(kind));
    if (!win) return;
    const { layout } = this.computeBounds(kind, this.resolveAnchor());
    win.webContents.send(IPC_COMPANION_LAYOUT, layout);
  }

  /**
   * If the window manager overrode the bounds we asked for, ask again — but
   * only a few times per second so a WM that refuses never starts a loop.
   */
  private scheduleBoundsRepair(): void {
    if (this.wayland || this.boundsRepairTimer || this.drag) return;
    this.boundsRepairTimer = setTimeout(() => {
      this.boundsRepairTimer = null;
      if (this.drag) return;
      const now = Date.now();
      this.boundsRepairs = this.boundsRepairs.filter((at) => now - at < 1_000);
      for (const slot of [this.mark, this.panel]) {
        const win = this.live(slot);
        const expected = this.expectedBounds[slot.kind];
        if (!win || !expected) continue;
        const actual = win.getBounds();
        if (
          actual.x === expected.x &&
          actual.y === expected.y &&
          actual.width === expected.width &&
          actual.height === expected.height
        ) {
          continue;
        }
        if (this.boundsRepairs.length >= 3) return;
        this.boundsRepairs.push(now);
        win.setBounds(expected, false);
      }
    }, 120);
  }

  private resetInteraction(): void {
    if (this.hoverGraceTimer) {
      clearTimeout(this.hoverGraceTimer);
      this.hoverGraceTimer = null;
    }
    this.markHovered = false;
    this.panelHovered = false;
    this.hovered = false;
    this.panelStatus = IDLE_PANEL_STATUS;
    this.activity = IDLE_ACTIVITY;
  }

  private updateHover(): void {
    const raw = this.markHovered || this.panelHovered;
    if (raw) {
      if (this.hoverGraceTimer) {
        clearTimeout(this.hoverGraceTimer);
        this.hoverGraceTimer = null;
      }
      if (!this.hovered) {
        this.hovered = true;
        this.publishActivity();
      }
      return;
    }
    if (!this.hovered || this.hoverGraceTimer) return;
    this.hoverGraceTimer = setTimeout(() => {
      this.hoverGraceTimer = null;
      if (this.markHovered || this.panelHovered) return;
      this.hovered = false;
      this.publishActivity();
    }, HOVER_GRACE_MS);
  }

  private publishActivity(): void {
    const next: CompanionActivity = {
      hovered: this.hovered,
      panelActive: this.hovered || this.panelStatus.wantsVisible,
      expanded: this.panelStatus.expanded,
      recording: this.panelStatus.recording,
      transcribing: this.panelStatus.transcribing,
    };
    if (sameActivity(next, this.activity)) return;
    const wasActive = this.activity.panelActive;
    this.activity = next;
    if (next.panelActive !== wasActive) this.applyPanelInteractivity();
    this.sendToBoth(IPC_COMPANION_ACTIVITY, next);
  }

  private applyPanelInteractivity(): void {
    const panel = this.live(this.panel);
    if (!panel) return;
    panel.setIgnoreMouseEvents(!this.activity.panelActive);
    this.applyStacking();
    this.placeOnHyprland();
  }

  private handleHello = (event: IpcMainEvent) => {
    const kind = this.kindOf(event.sender);
    if (!kind) return;
    this.slotFor(kind).hello = true;
    this.sendLayout(kind);
    event.sender.send(IPC_COMPANION_STATE, this.state);
    event.sender.send(IPC_COMPANION_ACTIVITY, this.activity);
    const waiters = this.helloWaiters.get(kind) ?? [];
    this.helloWaiters.delete(kind);
    for (const done of waiters) done();
  };

  private handleHover = (event: IpcMainEvent, hovered: boolean) => {
    const kind = this.kindOf(event.sender);
    if (!kind) return;
    if (kind === "mark") this.markHovered = hovered === true;
    else this.panelHovered = hovered === true;
    this.updateHover();
  };

  private handlePanelStatus = (
    event: IpcMainEvent,
    status: CompanionPanelStatus,
  ) => {
    if (this.kindOf(event.sender) !== "panel") return;
    if (!status || typeof status !== "object") return;
    this.panelStatus = {
      expanded: status.expanded === true,
      recording: status.recording === true,
      transcribing: status.transcribing === true,
      wantsVisible: status.wantsVisible === true,
    };
    this.publishActivity();
  };

  private handleToggleExpanded = (event: IpcMainEvent) => {
    if (!this.isSender(event.sender)) return;
    this.sendToPanel(IPC_COMPANION_SET_EXPANDED, {
      expanded: !this.panelStatus.expanded,
    });
  };

  private handleDragStart = (
    event: IpcMainEvent,
    cursor: CompanionDragMove,
  ) => {
    if (!this.isSender(event.sender)) return;
    if (
      !cursor ||
      typeof cursor.screenX !== "number" ||
      typeof cursor.screenY !== "number"
    )
      return;
    const anchor = this.resolveAnchor();
    this.drag = {
      offsetX: cursor.screenX - anchor.x,
      offsetY: cursor.screenY - anchor.y,
    };
    // Wayland pointer events carry no global position, so on Hyprland the
    // drag follows its cursor instead of the renderer's coordinates.
    this.startHyprlandDrag();
    this.sendToPanel(IPC_COMPANION_SET_EXPANDED, { expanded: false });
  };

  private handleDragMove = (event: IpcMainEvent, cursor: CompanionDragMove) => {
    if (!this.isSender(event.sender) || !this.drag || this.hypr) return;
    if (
      !cursor ||
      typeof cursor.screenX !== "number" ||
      typeof cursor.screenY !== "number"
    )
      return;
    this.anchor = this.clampAnchor({
      x: cursor.screenX - this.drag.offsetX,
      y: cursor.screenY - this.drag.offsetY,
    });
    this.applyBounds();
  };

  private handleDragEnd = (event: IpcMainEvent) => {
    if (!this.isSender(event.sender)) return;
    this.drag = null;
    this.stopHyprlandDrag();
    const dir = this.options.getStellaDataDir();
    if (dir && this.anchor) setCompanionAnchor(dir, this.anchor);
    this.applyBounds();
  };

  private handleFocus = (event: IpcMainEvent) => {
    if (this.kindOf(event.sender) !== "panel") return;
    this.focusPanel();
  };

  private handleOpenMain = (event: IpcMainEvent) => {
    if (!this.isSender(event.sender)) return;
    this.options.onOpenMain();
  };

  private handleShowContextMenu = (event: IpcMainEvent) => {
    if (!this.isSender(event.sender)) return;
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isDestroyed()) return;
    const menu = Menu.buildFromTemplate([
      {
        label: t("companion.menu.openStella"),
        click: () => this.options.onOpenMain(),
      },
      { type: "separator" },
      { label: t("companion.menu.hide"), click: () => this.hide() },
      { label: t("companion.menu.quit"), click: () => this.options.onQuit() },
    ]);
    menu.popup({ window: win });
  };
}
