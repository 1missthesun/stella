import { randomUUID } from "node:crypto";
import {
  BrowserWindow,
  screen,
  type HandlerDetails,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type Rectangle,
  type WebContents,
  type WindowOpenHandlerResponse,
} from "electron";
import {
  IPC_VIEWER_WINDOW_ACT,
  IPC_VIEWER_WINDOW_CLOSED,
  IPC_VIEWER_WINDOW_MOVE,
  IPC_VIEWER_WINDOW_PREPARE,
} from "@stella/contracts/desktop/ipc-channels";
import { resolveAppIconPath } from "../app-icon.js";
import { handleIpc, onIpc } from "../ipc/typed-ipc.js";
import { installContextMenu } from "../services/context-menu-service.js";
import { HyprlandIpc, isNativeWayland } from "./hyprland-ipc.js";

const MIN_SIZE = { width: 320, height: 220 };
const ON_SCREEN_MARGIN = 48;
const HYPRLAND_ATTACH_TIMEOUT_MS = 2_000;
const HYPRLAND_ATTACH_POLL_MS = 40;
const BLANK_URL = "about:blank";

type ViewerWindowOptions = {
  electronDir: string;
  getFullWindow: () => BrowserWindow | null;
  assertPrivilegedSender: (
    event: IpcMainEvent | IpcMainInvokeEvent,
    channel: string,
  ) => boolean;
  openExternalUrl: (url: string) => void;
};

type Ticket = { name: string; background: string };

type ViewerWindow = {
  name: string;
  window: BrowserWindow;
  opener: WebContents;
  lifted: boolean;
};

const COLOR = /^#[0-9a-f]{6}$/i;

const reachable = (bounds: Rectangle): Rectangle => {
  const area = screen.getDisplayMatching(bounds).workArea;
  const width = Math.max(MIN_SIZE.width, Math.min(bounds.width, area.width));
  const height = Math.max(MIN_SIZE.height, Math.min(bounds.height, area.height));
  return {
    width,
    height,
    x: Math.min(
      Math.max(bounds.x, area.x + ON_SCREEN_MARGIN - width),
      area.x + area.width - ON_SCREEN_MARGIN,
    ),
    y: Math.min(
      Math.max(bounds.y, area.y),
      area.y + area.height - ON_SCREEN_MARGIN,
    ),
  };
};

/**
 * Viewers pulled out of Stella. Each is a blank same-origin popup of the full
 * window, so it runs in that window's renderer: no second copy of the app, no
 * preload and no IPC of its own. Only a popup holding a fresh ticket opens.
 */
export class ViewerWindowController {
  private readonly tickets = new Map<number, Ticket>();
  private readonly windows = new Map<string, ViewerWindow>();
  private readonly openers = new WeakSet<WebContents>();
  private readonly wayland = isNativeWayland();
  private hideMainUntilLastCloses = false;

  constructor(private readonly options: ViewerWindowOptions) {
    handleIpc(IPC_VIEWER_WINDOW_PREPARE, (event, request) => {
      if (!options.assertPrivilegedSender(event, IPC_VIEWER_WINDOW_PREPARE)) {
        return null;
      }
      const full = options.getFullWindow();
      if (!full || full.isDestroyed() || full.webContents !== event.sender) {
        return null;
      }
      this.adopt(full);
      const ticket: Ticket = {
        name: `stella-viewer-${randomUUID()}`,
        background: COLOR.test(request?.background ?? "")
          ? request.background
          : "#101016",
      };
      this.tickets.set(event.sender.id, ticket);
      return { name: ticket.name, follows: !this.wayland };
    });
    onIpc(IPC_VIEWER_WINDOW_MOVE, (event, move) => {
      const viewer = this.owned(event, move?.name);
      if (!viewer || !Number.isFinite(move.x) || !Number.isFinite(move.y)) return;
      this.lift(viewer, true);
      viewer.window.setPosition(Math.round(move.x), Math.round(move.y), false);
    });
    onIpc(IPC_VIEWER_WINDOW_ACT, (event, act) => {
      const viewer = this.owned(event, act?.name);
      if (!viewer) return;
      if (act.action === "show") this.show(viewer);
      else if (act.action === "focus") this.focus(viewer);
      else if (act.action === "close") viewer.window.destroy();
    });
  }

  handleOpen(
    opener: BrowserWindow,
    details: HandlerDetails,
  ): WindowOpenHandlerResponse | null {
    const ticket = this.tickets.get(opener.webContents.id);
    if (
      !ticket ||
      details.frameName !== ticket.name ||
      details.url !== BLANK_URL
    ) {
      return null;
    }
    const isMac = process.platform === "darwin";
    const icon = isMac ? undefined : resolveAppIconPath(this.options.electronDir);
    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        show: false,
        minWidth: MIN_SIZE.width,
        minHeight: MIN_SIZE.height,
        frame: isMac,
        titleBarStyle: isMac ? "hidden" : undefined,
        trafficLightPosition: isMac ? { x: 13, y: 13 } : undefined,
        hasShadow: true,
        transparent: false,
        backgroundColor: ticket.background,
        fullscreenable: !opener.isFullScreen(),
        // Hyprland floats windows that open with a fixed size and tiles the rest.
        resizable: !this.wayland,
        ...(icon ? { icon } : {}),
        webPreferences: { preload: undefined },
      },
    };
  }

  /**
   * Closing the full window would take its viewers with it. While any are
   * open it hides instead, and closes once the last of them is gone.
   */
  holdMainClose(main: BrowserWindow): boolean {
    if (this.windows.size === 0) return false;
    this.hideMainUntilLastCloses = true;
    main.hide();
    return true;
  }

  private adopt(full: BrowserWindow): void {
    const opener = full.webContents;
    if (this.openers.has(opener)) return;
    this.openers.add(opener);
    opener.on("did-create-window", (window, { frameName }) => {
      const ticket = this.tickets.get(opener.id);
      if (!ticket || frameName !== ticket.name) {
        window.destroy();
        return;
      }
      this.tickets.delete(opener.id);
      this.register({ name: ticket.name, window, opener, lifted: false });
    });
    const closeAll = () => this.closeOwnedBy(opener);
    opener.on("did-navigate", closeAll);
    opener.on("render-process-gone", closeAll);
    opener.on("destroyed", closeAll);
    full.on("show", () => {
      this.hideMainUntilLastCloses = false;
    });
  }

  private register(viewer: ViewerWindow): void {
    const { window, name, opener } = viewer;
    const { webContents } = window;
    this.windows.set(name, viewer);
    if (!this.wayland) window.setBounds(reachable(window.getBounds()));
    installContextMenu(webContents, { askRenderer: true, renderer: opener });
    webContents.setWindowOpenHandler(({ url }) => {
      if (url !== BLANK_URL) this.options.openExternalUrl(url);
      return { action: "deny" };
    });
    webContents.on("will-navigate", (event, url) => {
      event.preventDefault();
      this.options.openExternalUrl(url);
    });
    // A page in the viewer must not be able to refuse its window's close.
    webContents.on("will-prevent-unload", (event) => event.preventDefault());
    window.on("closed", () => {
      this.windows.delete(name);
      if (!opener.isDestroyed()) {
        opener.send(IPC_VIEWER_WINDOW_CLOSED, { name });
      }
      if (this.windows.size === 0 && this.hideMainUntilLastCloses) {
        this.hideMainUntilLastCloses = false;
        const full = this.options.getFullWindow();
        if (full && !full.isDestroyed() && !full.isVisible()) full.close();
      }
    });
  }

  private show(viewer: ViewerWindow): void {
    viewer.window.showInactive();
    if (!this.wayland) return;
    void this.settleOnWayland(viewer).catch(() => undefined);
  }

  private focus(viewer: ViewerWindow): void {
    viewer.window.focus();
    this.lift(viewer, false);
  }

  /** macOS raises the pressed window when a drag ends, over a torn-off viewer. */
  private lift(viewer: ViewerWindow, lifted: boolean): void {
    if (viewer.lifted === lifted) return;
    viewer.lifted = lifted;
    viewer.window.setAlwaysOnTop(lifted);
  }

  private async settleOnWayland(viewer: ViewerWindow): Promise<void> {
    const { window, name } = viewer;
    const hyprland = HyprlandIpc.connectIfAvailable();
    const title = window.getTitle();
    const [width, height] = window.getSize();
    try {
      if (!hyprland) return;
      const cursor = await hyprland.cursorPos();
      window.setTitle(name);
      const deadline = Date.now() + HYPRLAND_ATTACH_TIMEOUT_MS;
      while (Date.now() < deadline && !window.isDestroyed()) {
        const client = (await hyprland.clients()).find(
          (entry) => entry.mapped && entry.title === name,
        );
        if (client) {
          await hyprland.dispatch([
            HyprlandIpc.move(
              client.address,
              cursor.x - width! / 2,
              cursor.y - 20,
            ),
            HyprlandIpc.focus(client.address),
          ]);
          return;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, HYPRLAND_ATTACH_POLL_MS),
        );
      }
    } finally {
      if (!window.isDestroyed()) {
        window.setTitle(title);
        window.setResizable(true);
        window.setSize(width!, height!);
      }
    }
  }

  private owned(event: IpcMainEvent, name: unknown): ViewerWindow | null {
    if (typeof name !== "string") return null;
    const viewer = this.windows.get(name);
    return viewer &&
      viewer.opener === event.sender &&
      !viewer.window.isDestroyed()
      ? viewer
      : null;
  }

  private closeOwnedBy(opener: WebContents): void {
    for (const viewer of [...this.windows.values()]) {
      if (viewer.opener === opener && !viewer.window.isDestroyed()) {
        viewer.window.destroy();
      }
    }
  }
}
