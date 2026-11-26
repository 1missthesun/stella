// The rest of Electron's main-process surface: utilityProcess (Bun child with a parentPort),
// systemPreferences, desktopCapturer, crash/tracing/netLog (no-ops), webUtils. Renderer-only
// modules (ipcRenderer, contextBridge, webFrame) are undefined in main, as in Electron.

import { EventEmitter } from "node:events";
import { fork, type ChildProcess } from "node:child_process";
import path from "node:path";
import { rmSync } from "node:fs";
import { engine, warnOnce } from "./engine";
import { nativeImage } from "./native-image";
import { mediaAccessStatus } from "./macos-media";

const PARENT_PORT_PRELOAD = path.join(import.meta.dir, "utility-child.ts");

class UtilityProcess extends EventEmitter {
  readonly child: ChildProcess;
  constructor(modulePath: string, args: string[], options: { env?: NodeJS.ProcessEnv; cwd?: string; stdio?: unknown; serviceName?: string; execArgv?: string[] } = {}) {
    super();
    this.child = fork(modulePath, args, {
      env: options.env ?? process.env,
      cwd: options.cwd,
      execArgv: ["--preload", PARENT_PORT_PRELOAD, ...(options.execArgv ?? [])],
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    this.child.stdout?.on("data", (d: Buffer) => process.stderr.write(d));
    this.child.stderr?.on("data", (d: Buffer) => process.stderr.write(d));
    this.child.on("spawn", () => this.emit("spawn"));
    this.child.on("message", (message: unknown) => this.emit("message", message));
    this.child.on("exit", (code) => this.emit("exit", code ?? 0));
    this.child.on("error", (error) => this.emit("error", "FatalError", String(error)));
  }
  get pid() { return this.child.pid; }
  get stdout() { return this.child.stdout; }
  get stderr() { return this.child.stderr; }
  postMessage(message: unknown) { if (this.child.connected) this.child.send(message as never); }
  kill() { return this.child.kill(); }
}

export const utilityProcess = {
  fork: (modulePath: string, args: string[] = [], options?: ConstructorParameters<typeof UtilityProcess>[2]) => new UtilityProcess(modulePath, args, options),
};

class SystemPreferences extends EventEmitter {
  getMediaAccessStatus(type: string) { return mediaAccessStatus(type); }
  async askForMediaAccess(type: string) { return mediaAccessStatus(type) === "granted"; }
  isTrustedAccessibilityClient(_prompt: boolean) { return process.platform !== "darwin"; }
  getAccentColor() { return "0a84ffff"; }
  getColor() { return "#000000"; }
  getSystemColor() { return "#000000"; }
  getEffectiveAppearance() { return "dark"; }
  canPromptTouchID() { return false; }
  promptTouchID() { return Promise.reject(new Error("Touch ID is not available.")); }
  getUserDefault() { return undefined; }
  setUserDefault() {}
  removeUserDefault() {}
  registerDefaults() {}
  subscribeNotification() { return 0; }
  unsubscribeNotification() {}
  subscribeLocalNotification() { return 0; }
  unsubscribeLocalNotification() {}
  subscribeWorkspaceNotification() { return 0; }
  unsubscribeWorkspaceNotification() {}
  postNotification() {}
  postLocalNotification() {}
  postWorkspaceNotification() {}
  isSwipeTrackingFromScrollEventsEnabled() { return false; }
  getAnimationSettings() { return { shouldRenderRichAnimation: true, scrollAnimationsEnabledBySystem: true, prefersReducedMotion: false }; }
  isAeroGlassEnabled() { return false; }
}

export const systemPreferences = new SystemPreferences();

type DesktopCapturerSource = { id: string; name: string; thumbnail: ReturnType<typeof nativeImage.createEmpty>; display_id: string; appIcon: null };

export const desktopCapturer = {
  async getSources(options: { types?: string[]; thumbnailSize?: { width: number; height: number } } = {}): Promise<DesktopCapturerSource[]> {
    const e = engine();
    if (!e) {
      warnOnce("desktopCapturer", "desktopCapturer.getSources needs the engine");
      return [];
    }
    const thumbnailSize = options.thumbnailSize ?? { width: 150, height: 150 };
    const sources = await e.capture.sources({ types: options.types ?? ["screen"], thumbnailSize });
    return sources.map((source) => {
      const thumbnail = source.thumbnail ? nativeImage.createFromPath(source.thumbnail) : nativeImage.createEmpty();
      if (source.thumbnail) rmSync(source.thumbnail, { force: true });
      return { id: source.id, name: source.name, display_id: source.display_id, thumbnail, appIcon: null };
    });
  },
};

export const crashReporter = {
  start() {},
  getLastCrashReport() { return null; },
  getUploadedReports() { return []; },
  getUploadToServer() { return false; },
  setUploadToServer() {},
  addExtraParameter() {},
  removeExtraParameter() {},
  getParameters() { return {}; },
};

export const contentTracing = {
  async getCategories() { return []; },
  async startRecording() { warnOnce("tracing", "contentTracing is Chromium-only; profile the host with `bun --inspect`"); },
  async stopRecording(resultPath?: string) { return resultPath ?? ""; },
  async getTraceBufferUsage() { return { value: 0, percentage: 0 }; },
  async enableHeapProfiling() {},
};

let netLogging = false;
export const netLog = {
  async startLogging() { netLogging = true; },
  async stopLogging() { netLogging = false; },
  get currentlyLogging() { return netLogging; },
};

export const webUtils = {
  getPathForFile: (file: { path?: string }) => file?.path ?? "",
};

export const webFrameMain = { fromId: () => null, fromFrameToken: () => null };

export class MessageChannelMain {
  readonly port1: MessagePort;
  readonly port2: MessagePort;
  constructor() {
    const channel = new MessageChannel();
    this.port1 = channel.port1;
    this.port2 = channel.port2;
  }
}

export const autoUpdater = Object.assign(new EventEmitter(), {
  setFeedURL() {},
  getFeedURL() { return ""; },
  checkForUpdates() {},
  quitAndInstall() {},
});

export class BrowserView {
  constructor() { warnOnce("browserview", "BrowserView is not supported; use WebContentsView"); }
}

export class TouchBar {
  static TouchBarButton = class {};
  static TouchBarLabel = class {};
  static TouchBarSpacer = class {};
  static TouchBarGroup = class {};
  static TouchBarSegmentedControl = class {};
  static TouchBarSlider = class {};
  static TouchBarPopover = class {};
  static TouchBarColorPicker = class {};
  static TouchBarScrubber = class {};
  static TouchBarOtherItemsProxy = class {};
}

export class ShareMenu extends EventEmitter { popup() {} closePopup() {} }

export const inAppPurchase = Object.assign(new EventEmitter(), {
  canMakePayments: () => false,
  getProducts: async () => [],
  purchaseProduct: async () => false,
  getReceiptURL: () => "",
  restoreCompletedTransactions() {},
  finishAllTransactions() {},
  finishTransactionByDate() {},
});

export const pushNotifications = Object.assign(new EventEmitter(), {
  registerForAPNSNotifications: async () => "",
  unregisterForAPNSNotifications() {},
});
