import {
  BrowserWindow,
  WebContentsView,
  type NativeImage,
  type Rectangle,
  type WebContents,
} from "electron";
import type { ManagedTab } from "./tab-registry.js";
import {
  MIRROR_CURSOR_CHANNEL,
  MIRROR_FRAME_ACK_CHANNEL,
  MIRROR_FRAME_CHANNEL,
  MIRROR_INPUT_CHANNEL,
  type MirrorFrame,
  type MirrorInput,
  type MirrorModifier,
} from "./offscreen-mirror-protocol.js";

/*
 * Agent tabs on Linux render offscreen.
 *
 * A tab that isn't in the visible window has nowhere to draw on Linux: an
 * unmapped window never gets frame callbacks from a Wayland compositor (nor
 * reliable frames under X11), so after its first frame its compositor stalls
 * and screenshots, rAF and input acks wait for good. Showing a window to get
 * frames puts an empty toplevel on the user's screen. An offscreen
 * WebContents draws through its own frame source instead, and its screenshots,
 * input and rAF all work with no window on screen.
 *
 * The cost is that an offscreen tab can't be shown as a native view. When the
 * panel shows one, a mirror view takes its place: it draws the tab's painted
 * frames and sends the user's mouse and keyboard back to it. Painting (a GPU
 * readback per frame) runs only while the mirror shows the tab; screenshots
 * and agent input don't need it.
 *
 * Offscreen tabs render at scale 1 whatever the display's scale: agents read
 * their screenshots and full-page clips in CSS pixels, and the mirror scales
 * the frame up for the panel.
 */

const DEFAULT_BOUNDS = { width: 1280, height: 720 };
const MIRROR_FRAME_RATE = 60;
// A frame the mirror never acknowledged (its renderer reloaded or died) stops
// blocking newer frames after this long.
const MIRROR_ACK_TIMEOUT_MS = 1_000;

const MIRROR_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>
html, body { margin: 0; height: 100%; overflow: hidden; background: #fff; }
canvas { display: block; }
textarea { position: fixed; left: 0; top: 0; width: 1px; height: 1px; opacity: 0; border: 0; padding: 0; resize: none; pointer-events: none; }
</style></head><body><canvas></canvas><textarea aria-hidden="true" tabindex="-1"></textarea></body></html>`;
const MIRROR_URL = `data:text/html;charset=utf-8,${encodeURIComponent(MIRROR_HTML)}`;

// Electron cursor names that differ from CSS.
const CSS_CURSORS: Record<string, string> = {
  hand: "pointer",
  nodrop: "no-drop",
  "m-panning": "all-scroll",
  "e-panning": "all-scroll",
  "n-panning": "all-scroll",
  "ne-panning": "all-scroll",
  "nw-panning": "all-scroll",
  "s-panning": "all-scroll",
  "se-panning": "all-scroll",
  "sw-panning": "all-scroll",
  "w-panning": "all-scroll",
  custom: "default",
};

const MODIFIERS = new Set<MirrorModifier>([
  "shift",
  "control",
  "alt",
  "meta",
  "leftbuttondown",
  "middlebuttondown",
  "rightbuttondown",
]);

const finite = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const unionRect = (a: Rectangle | null, b: Rectangle): Rectangle => {
  if (!a) return b;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
};

const clampRect = (rect: Rectangle, width: number, height: number) => {
  const x = Math.min(Math.max(0, Math.floor(rect.x)), width);
  const y = Math.min(Math.max(0, Math.floor(rect.y)), height);
  return {
    x,
    y,
    width: Math.max(0, Math.min(Math.ceil(rect.width), width - x)),
    height: Math.max(0, Math.min(Math.ceil(rect.height), height - y)),
  };
};

type MirrorBinding = {
  tab: ManagedTab;
  contents: WebContents;
  onPaint: (
    event: unknown,
    dirty: Rectangle,
    image: NativeImage,
  ) => void;
  onCursor: (event: unknown, type: string) => void;
  latest: NativeImage | null;
  pendingDirty: Rectangle | null;
  sentSize: { width: number; height: number } | null;
  inFlightSince: number | null;
  paused: number;
};

export type OffscreenTabsOptions = {
  mirrorPreloadPath: string;
  getPageBounds: () => Rectangle | undefined;
};

export class OffscreenTabs {
  private readonly options: OffscreenTabsOptions;
  private host: BrowserWindow | null = null;
  private readonly mounted = new Set<ManagedTab>();
  private mirror: WebContentsView | null = null;
  private binding: MirrorBinding | null = null;

  constructor(options: OffscreenTabsOptions) {
    this.options = options;
  }

  /** Extra web preferences that make a new tab render offscreen. */
  webPreferences() {
    return { offscreen: { deviceScaleFactor: 1 } } as const;
  }

  /**
   * An offscreen view takes its viewport from the window it is in, so every
   * offscreen tab lives in one never-shown host sized like the panel's page.
   */
  adopt(tab: ManagedTab) {
    if (this.mounted.has(tab) || tab.view.webContents.isDestroyed()) return;
    const host = this.ensureHost();
    host.contentView.addChildView(tab.view);
    tab.view.setBounds({ x: 0, y: 0, ...this.size() });
    this.mounted.add(tab);
    tab.view.webContents.stopPainting();
  }

  release(tab: ManagedTab) {
    if (this.binding?.tab === tab) this.unbindMirror();
    if (!this.mounted.delete(tab)) return;
    const host = this.host;
    if (!host || host.isDestroyed()) return;
    try {
      host.contentView.removeChildView(tab.view);
    } catch {
      // Host teardown can race tab cleanup.
    }
  }

  resize() {
    const host = this.host;
    if (!host || host.isDestroyed()) return;
    const size = this.size();
    const [width, height] = host.getContentSize();
    if (width !== size.width || height !== size.height) {
      host.setContentSize(size.width, size.height);
    }
    for (const tab of this.mounted) {
      if (!tab.view.webContents.isDestroyed()) {
        tab.view.setBounds({ x: 0, y: 0, ...size });
      }
    }
  }

  isMirroring(tab: ManagedTab) {
    return this.binding?.tab === tab;
  }

  /**
   * Stops the mirror's painting until the returned function runs. A full-page
   * screenshot lays the page out at its whole length for a moment; painting
   * then would allocate one bitmap for all of it, which Chromium aborts on.
   */
  pausePainting(tab: ManagedTab): () => void {
    const binding = this.binding;
    if (binding?.tab !== tab) return () => {};
    binding.paused += 1;
    if (binding.paused === 1) binding.contents.stopPainting();
    let resumed = false;
    return () => {
      if (resumed) return;
      resumed = true;
      binding.paused -= 1;
      if (
        binding.paused > 0 ||
        this.binding !== binding ||
        binding.contents.isDestroyed()
      ) {
        return;
      }
      binding.contents.startPainting();
      binding.contents.invalidate();
    };
  }

  /** The view the panel shows in place of `tab`, now drawing that tab. */
  mirrorFor(tab: ManagedTab): WebContentsView {
    const mirror = this.ensureMirror();
    if (this.binding?.tab === tab) return mirror;
    this.unbindMirror();
    const contents = tab.view.webContents;
    const binding: MirrorBinding = {
      tab,
      contents,
      onPaint: (_event, dirty, image) => {
        binding.latest = image;
        binding.pendingDirty = unionRect(binding.pendingDirty, dirty);
        this.flush(binding);
      },
      onCursor: (_event, type) => {
        if (mirror.webContents.isDestroyed()) return;
        mirror.webContents.send(MIRROR_CURSOR_CHANNEL, CSS_CURSORS[type] ?? type);
      },
      latest: null,
      pendingDirty: null,
      sentSize: null,
      inFlightSince: null,
      paused: 0,
    };
    this.binding = binding;
    contents.on("paint", binding.onPaint);
    contents.on("cursor-changed", binding.onCursor);
    contents.setFrameRate(MIRROR_FRAME_RATE);
    contents.startPainting();
    contents.invalidate();
    return mirror;
  }

  unbindMirror() {
    const binding = this.binding;
    if (!binding) return;
    this.binding = null;
    const { contents } = binding;
    if (contents.isDestroyed()) return;
    contents.off("paint", binding.onPaint);
    contents.off("cursor-changed", binding.onCursor);
    contents.stopPainting();
  }

  dispose() {
    this.unbindMirror();
    this.mounted.clear();
    const host = this.host;
    this.host = null;
    if (host && !host.isDestroyed()) host.destroy();
    const mirror = this.mirror;
    this.mirror = null;
    if (mirror && !mirror.webContents.isDestroyed()) mirror.webContents.close();
  }

  private size() {
    const bounds = this.options.getPageBounds();
    return {
      width: Math.max(1, bounds?.width || DEFAULT_BOUNDS.width),
      height: Math.max(1, bounds?.height || DEFAULT_BOUNDS.height),
    };
  }

  private ensureHost() {
    if (this.host && !this.host.isDestroyed()) return this.host;
    const host = new BrowserWindow({
      ...this.size(),
      useContentSize: true,
      show: false,
      frame: false,
      focusable: false,
      skipTaskbar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    host.once("closed", () => {
      if (this.host === host) {
        this.host = null;
        this.mounted.clear();
      }
    });
    this.host = host;
    return host;
  }

  private ensureMirror() {
    if (this.mirror && !this.mirror.webContents.isDestroyed()) {
      return this.mirror;
    }
    const mirror = new WebContentsView({
      webPreferences: {
        preload: this.options.mirrorPreloadPath,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        backgroundThrottling: false,
      },
    });
    mirror.setBackgroundColor("#ffffff");
    const contents = mirror.webContents;
    contents.on("will-navigate", (event) => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
    contents.ipc.on(MIRROR_FRAME_ACK_CHANNEL, () => {
      const binding = this.binding;
      if (!binding) return;
      binding.inFlightSince = null;
      this.flush(binding);
    });
    contents.ipc.on(MIRROR_INPUT_CHANNEL, (_event, input: MirrorInput) => {
      const binding = this.binding;
      if (binding) this.forwardInput(binding.contents, input);
    });
    contents.on("did-finish-load", () => {
      const binding = this.binding;
      if (!binding) return;
      binding.sentSize = null;
      binding.inFlightSince = null;
      if (!binding.contents.isDestroyed()) binding.contents.invalidate();
    });
    void contents.loadURL(MIRROR_URL);
    this.mirror = mirror;
    return mirror;
  }

  /** Sends the latest painted region unless the mirror is still drawing one. */
  private flush(binding: MirrorBinding) {
    const mirror = this.mirror;
    if (this.binding !== binding || !mirror || mirror.webContents.isDestroyed()) {
      return;
    }
    if (
      binding.inFlightSince !== null &&
      Date.now() - binding.inFlightSince < MIRROR_ACK_TIMEOUT_MS
    ) {
      return;
    }
    const image = binding.latest;
    const dirty = binding.pendingDirty;
    if (!image || !dirty || mirror.webContents.isLoading()) return;
    const size = image.getSize();
    if (size.width === 0 || size.height === 0) return;
    const resized =
      binding.sentSize?.width !== size.width ||
      binding.sentSize?.height !== size.height;
    const region = resized
      ? { x: 0, y: 0, ...size }
      : clampRect(dirty, size.width, size.height);
    binding.pendingDirty = null;
    if (region.width === 0 || region.height === 0) return;
    const whole = region.width === size.width && region.height === size.height;
    const pixels = (whole ? image : image.crop(region)).toBitmap();
    const frame: MirrorFrame = {
      frameWidth: size.width,
      frameHeight: size.height,
      ...region,
    };
    binding.sentSize = size;
    binding.inFlightSince = Date.now();
    mirror.webContents.send(MIRROR_FRAME_CHANNEL, frame, pixels);
  }

  private forwardInput(contents: WebContents, input: MirrorInput) {
    if (contents.isDestroyed() || !input || typeof input !== "object") return;
    const modifiers =
      "modifiers" in input && Array.isArray(input.modifiers)
        ? input.modifiers.filter((modifier) => MODIFIERS.has(modifier))
        : [];
    switch (input.type) {
      case "mouseDown":
      case "mouseUp":
      case "mouseMove":
      case "mouseLeave": {
        if (input.type === "mouseDown") contents.focus();
        const button =
          input.button === "middle" || input.button === "right"
            ? input.button
            : "left";
        contents.sendInputEvent({
          type: input.type,
          x: Math.round(finite(input.x)),
          y: Math.round(finite(input.y)),
          button,
          clickCount: Math.max(1, Math.min(3, Math.round(finite(input.clickCount)) || 1)),
          modifiers,
        });
        return;
      }
      case "mouseWheel":
        contents.sendInputEvent({
          type: "mouseWheel",
          x: Math.round(finite(input.x)),
          y: Math.round(finite(input.y)),
          deltaX: finite(input.deltaX),
          deltaY: finite(input.deltaY),
          hasPreciseScrollingDeltas: true,
          canScroll: true,
          modifiers,
        });
        return;
      case "keyDown":
      case "keyUp":
      case "char":
        if (typeof input.keyCode !== "string" || !input.keyCode) return;
        contents.sendInputEvent({
          type: input.type,
          keyCode: input.keyCode,
          modifiers,
        });
        return;
      case "insertText":
        if (typeof input.text === "string" && input.text) {
          void contents.insertText(input.text);
        }
        return;
    }
  }
}
