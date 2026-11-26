// shell, dialog, clipboard, nativeTheme, powerMonitor, powerSaveBlocker, globalShortcut, Menu,
// MenuItem, Tray and Notification over the engine platform API. Message boxes have no native
// engine path: they are queued in `hostDialogs` for the UI to draw and answer.

import { EventEmitter } from "node:events";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { engine, onEngine, viaEngine, warnOnce, type EngineApi, type EngineMenuItem } from "./engine";
import { request } from "../bridge";
import { portalShortcut } from "./portal-shortcut-ids";
import { NativeImage, nativeImage } from "./native-image";
import { app } from "./app";
import type { BrowserWindow } from "./browser-window";

const externalOpensLogged = () => process.env.STELLA_RUNE_EXTERNAL_OPEN === "log";

const openWithSystem = (target: string): Promise<string> =>
  new Promise((resolve) => {
    const [cmd, args] = process.platform === "darwin" ? ["open", [target]]
      : process.platform === "win32" ? ["cmd", ["/c", "start", "", target]]
      : ["xdg-open", [target]];
    const child = spawn(cmd, args as string[], { detached: true, stdio: "ignore" });
    child.on("error", (error) => resolve(error.message));
    child.on("spawn", () => { child.unref(); resolve(""); });
  });

export const shell = {
  async openExternal(url: string, _options?: unknown): Promise<void> {
    if (externalOpensLogged()) { console.error(`[shell] openExternal (logged, not opened): ${url}`); return; }
    await viaEngine("shell.openExternal", (e) => e.shell?.openExternal(url), async () => {
      const error = await openWithSystem(url);
      if (error) throw new Error(error);
    });
  },
  async openPath(target: string): Promise<string> {
    if (externalOpensLogged()) { console.error(`[shell] openPath (logged, not opened): ${target}`); return ""; }
    return await viaEngine("shell.openPath", (e) => e.shell?.openPath(target), () => openWithSystem(target));
  },
  showItemInFolder(target: string) {
    if (externalOpensLogged()) { console.error(`[shell] showItemInFolder (logged): ${target}`); return; }
    void viaEngine("shell.showItemInFolder", (e) => e.shell?.showItemInFolder(target), () => openWithSystem(path.dirname(target)).then(() => {}));
  },
  async trashItem(target: string): Promise<void> {
    const cmd = process.platform === "darwin"
      ? ["osascript", "-e", `tell application "Finder" to delete POSIX file ${JSON.stringify(path.resolve(target))}`]
      : process.platform === "win32"
        ? ["powershell.exe", "-NoProfile", "-Command", `Add-Type -AssemblyName Microsoft.VisualBasic; $p=${JSON.stringify(path.resolve(target))}; if (Test-Path -PathType Container $p) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p,'OnlyErrorDialogs','SendToRecycleBin') } else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p,'OnlyErrorDialogs','SendToRecycleBin') }`]
        : ["gio", "trash", path.resolve(target)];
    const result = Bun.spawnSync(cmd, { stdout: "ignore", stderr: "pipe", env: process.env });
    if (result.exitCode !== 0) throw new Error(`Failed to move ${target} to the trash: ${result.stderr.toString().trim()}`);
  },
  beep() {},
  readShortcutLink(): never { throw new Error("Shortcut links are Windows-only."); },
  writeShortcutLink() { return false; },
};

export type HostDialogRequest = {
  id: number;
  windowId: string | null;
  kind: "message" | "error";
  options: {
    type?: string;
    title?: string;
    message: string;
    detail?: string;
    buttons?: string[];
    defaultId?: number;
    cancelId?: number;
    checkboxLabel?: string;
    checkboxChecked?: boolean;
  };
  resolve(result: { response: number; checkboxChecked: boolean }): void;
};

class HostDialogs extends EventEmitter {
  private nextId = 1;
  readonly pending = new Map<number, HostDialogRequest>();
  hasRenderer() { return this.listenerCount("request") > 0; }
  request(kind: HostDialogRequest["kind"], windowId: string | null, options: HostDialogRequest["options"]) {
    return new Promise<{ response: number; checkboxChecked: boolean }>((resolve) => {
      const id = this.nextId++;
      const request: HostDialogRequest = {
        id, windowId, kind, options,
        resolve: (result) => { this.pending.delete(id); this.emit("resolved", id); resolve(result); },
      };
      this.pending.set(id, request);
      if (!this.hasRenderer()) {
        console.error(`[dialog] ${kind}: ${options.title ?? ""} ${options.message}${options.detail ? ` — ${options.detail.slice(0, 400)}` : ""}`);
        if (kind === "message") request.resolve({ response: cancelIdOf(options), checkboxChecked: options.checkboxChecked ?? false });
        else request.resolve({ response: 0, checkboxChecked: false });
        return;
      }
      this.emit("request", request);
    });
  }
}

/** Message boxes waiting for the UI to draw them; the UI calls `request.resolve`. */
export const hostDialogs = new HostDialogs();

const cancelIdOf = (o: HostDialogRequest["options"]) => {
  if (o.cancelId !== undefined) return o.cancelId;
  const buttons = o.buttons ?? [];
  const i = buttons.findIndex((b) => /^(cancel|no|close|quit)$/i.test(b));
  return i >= 0 ? i : 0;
};

const splitWindowArg = <T>(a: unknown, b?: T): [BrowserWindow | null, T] =>
  b === undefined ? [null, a as T] : [a as BrowserWindow | null, b];

type FileFilter = { name: string; extensions: string[] };
type OpenOptions = { title?: string; defaultPath?: string; filters?: FileFilter[]; properties?: string[] };

export const dialog = {
  async showOpenDialog(a: unknown, b?: OpenOptions) {
    const [, opts] = splitWindowArg<OpenOptions>(a, b);
    const props = opts.properties ?? [];
    const paths = await viaEngine("dialog.openFile", (e) => e.dialog.openFile({
      title: opts.title, defaultPath: opts.defaultPath, filters: opts.filters,
      multi: props.includes("multiSelections"), directory: props.includes("openDirectory"),
    }), () => { warnOnce("dialog-open", "dialog.showOpenDialog without an engine: cancelled"); return null; });
    return { canceled: !paths || paths.length === 0, filePaths: paths ?? [], bookmarks: [] };
  },
  showOpenDialogSync(): string[] | undefined { warnOnce("dialog-open-sync", "showOpenDialogSync is not available; use showOpenDialog"); return undefined; },
  async showSaveDialog(a: unknown, b?: { title?: string; defaultPath?: string; filters?: FileFilter[] }) {
    const [, opts] = splitWindowArg<{ title?: string; defaultPath?: string; filters?: FileFilter[] }>(a, b);
    const filePath = await viaEngine("dialog.saveFile", (e) => e.dialog.saveFile(opts), () => { warnOnce("dialog-save", "dialog.showSaveDialog without an engine: cancelled"); return null; });
    return { canceled: !filePath, filePath: filePath ?? "", bookmark: undefined };
  },
  showSaveDialogSync(): string | undefined { warnOnce("dialog-save-sync", "showSaveDialogSync is not available; use showSaveDialog"); return undefined; },
  async showMessageBox(a: unknown, b?: HostDialogRequest["options"]) {
    const [win, opts] = splitWindowArg<HostDialogRequest["options"]>(a, b);
    return await hostDialogs.request("message", (win as { hostId?: string } | null)?.hostId ?? null, opts);
  },
  showMessageBoxSync(a: unknown, b?: HostDialogRequest["options"]) {
    const [, opts] = splitWindowArg<HostDialogRequest["options"]>(a, b);
    void hostDialogs.request("message", null, opts);
    return cancelIdOf(opts);
  },
  showErrorBox(title: string, content: string) {
    void hostDialogs.request("error", null, { title, message: title, detail: content, buttons: ["OK"] });
  },
  async showCertificateTrustDialog() {},
};

let clipboardText = "";
let clipboardHtml = "";
let clipboardImage: Uint8Array | null = null;
let clipboardFormats: string[] = [];

const refreshClipboard = () => {
  const e = engine();
  if (!e) return;
  void e.clipboard.readText().then((t) => { clipboardText = t; }).catch(() => {});
  void e.clipboard.availableFormats().then((f) => { clipboardFormats = f; }).catch(() => {});
};

export const clipboard = {
  readText(_type?: string) { refreshClipboard(); return clipboardText; },
  writeText(text: string, _type?: string) {
    clipboardText = String(text);
    clipboardHtml = "";
    clipboardImage = null;
    void viaEngine("clipboard.writeText", (e) => e.clipboard.writeText(clipboardText), () => {});
  },
  readHTML() { const e = engine(); if (e) void e.clipboard.readHTML().then((h) => { clipboardHtml = h; }).catch(() => {}); return clipboardHtml; },
  writeHTML(html: string) { clipboardHtml = html; void viaEngine("clipboard.writeHTML", (e) => e.clipboard.writeHTML(html, clipboardText), () => {}); },
  readRTF() { return ""; },
  writeRTF() {},
  readBookmark() { return { title: "", url: "" }; },
  writeBookmark(title: string, url: string) { clipboard.writeText(url); void title; },
  readFindText() { return ""; },
  writeFindText() {},
  readImage(_type?: string) {
    const e = engine();
    if (e) void e.clipboard.readImage().then((png) => { clipboardImage = png; }).catch(() => {});
    return clipboardImage ? nativeImage.createFromBuffer(clipboardImage) : nativeImage.createEmpty();
  },
  writeImage(image: NativeImage) {
    const png = new Uint8Array(image.toPNG());
    clipboardImage = png;
    void viaEngine("clipboard.writeImage", (e) => e.clipboard.writeImage(png), () => {});
  },
  write(data: ClipboardItem[] | { text?: string; html?: string; image?: NativeImage; rtf?: string; bookmark?: string }) {
    if (Array.isArray(data)) {
      void writeClipboardItems(data);
      return;
    }
    if (data.image) clipboard.writeImage(data.image);
    else if (data.text !== undefined) clipboard.writeText(data.text);
    if (data.html !== undefined) clipboard.writeHTML(data.html);
  },
  clear() { clipboard.writeText(""); },
  availableFormats() { refreshClipboard(); return clipboardFormats.length ? clipboardFormats : clipboardText ? ["text/plain"] : []; },
  has(format: string) { return clipboard.availableFormats().includes(format); },
  read(format: string) { return format.startsWith("text/") ? clipboardText : ""; },
  readBuffer() { return Buffer.alloc(0); },
  writeBuffer() {},
  async readTextAsync() { return await viaEngine("clipboard.readText", (e) => e.clipboard.readText(), () => clipboardText); },
  async readImagePngAsync() { return await viaEngine("clipboard.readImage", (e) => e.clipboard.readImage(), () => clipboardImage); },
};

/** Electron's main-process ClipboardItem: MIME type → Blob (or a promise of one). */
export class ClipboardItem {
  readonly types: string[];
  constructor(readonly items: Record<string, Blob | string | Promise<Blob | string>>) { this.types = Object.keys(items); }
  async getType(type: string): Promise<Blob> {
    const value = await this.items[type];
    return typeof value === "string" ? new Blob([value], { type }) : value!;
  }
  static supports(type: string) { return ["text/plain", "text/html", "image/png"].includes(type); }
}

const writeClipboardItems = async (items: ClipboardItem[]) => {
  for (const item of items) {
    if (item.types.includes("image/png")) {
      clipboard.writeImage(nativeImage.createFromBuffer(new Uint8Array(await (await item.getType("image/png")).arrayBuffer())));
      return;
    }
    if (item.types.includes("text/plain")) clipboard.writeText(await (await item.getType("text/plain")).text());
    if (item.types.includes("text/html")) clipboard.writeHTML(await (await item.getType("text/html")).text());
    return;
  }
};

class NativeTheme extends EventEmitter {
  private systemDark = process.env.STELLA_RUNE_THEME ? process.env.STELLA_RUNE_THEME === "dark" : true;
  private source: "system" | "light" | "dark" = "system";
  shouldUseHighContrastColors = false;
  shouldUseInvertedColorScheme = false;
  inForcedColorsMode = false;
  prefersReducedTransparency = false;
  shouldDifferentiateWithoutColor = false;
  constructor() { super(); this.setMaxListeners(0); }
  get shouldUseDarkColors() { return this.source === "system" ? this.systemDark : this.source === "dark"; }
  get shouldUseDarkColorsForSystemIntegratedUI() { return this.systemDark; }
  get themeSource() { return this.source; }
  set themeSource(next: "system" | "light" | "dark") {
    if (this.source === next) return;
    this.source = next;
    this.emit("updated");
  }
  get systemPrefersDark() { return this.systemDark; }
  setSystemAppearance(dark: boolean) {
    if (this.systemDark === dark) return;
    this.systemDark = dark;
    this.emit("updated");
  }
}

export const nativeTheme = new NativeTheme();

onEngine("appearance", (event) => nativeTheme.setSystemAppearance(event.dark));

class PowerMonitor extends EventEmitter {
  private sleepWatcher: ChildProcess | null = null;
  constructor() {
    super();
    this.setMaxListeners(0);
    this.on("newListener", (event: string) => {
      if ((event === "suspend" || event === "resume") && !this.sleepWatcher && process.platform === "linux") this.watchSleep();
    });
  }
  private watchSleep() {
    // gdbus runs under a shell that stops it when our end of its stdin closes, so it ends with the host however the host ends.
    const monitor = "gdbus monitor --system --dest org.freedesktop.login1 --object-path /org/freedesktop/login1 & m=$!; read _; kill $m";
    const child = spawn("sh", ["-c", monitor], { stdio: ["pipe", "pipe", "ignore"] });
    child.on("error", () => {});
    child.unref();
    for (const stream of [child.stdin, child.stdout] as ({ unref?: () => void } | null)[]) stream?.unref?.();
    let buffer = "";
    child.stdout!.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (!line.includes("PrepareForSleep")) continue;
        this.emit(line.includes("true") ? "suspend" : "resume");
      }
    });
    this.sleepWatcher = child;
    const stop = () => { child.stdin?.end(); };
    app.once("will-quit", stop);
    process.once("exit", stop);
  }
  getSystemIdleTime() { return 0; }
  getSystemIdleState(_threshold: number) { return "active"; }
  getCurrentThermalState() { return "nominal"; }
  isOnBatteryPower() {
    if (process.platform !== "linux") return false;
    try {
      for (const supply of readdirSync("/sys/class/power_supply")) {
        const base = `/sys/class/power_supply/${supply}`;
        if (readFileSync(`${base}/type`, "utf8").trim() === "Mains") return readFileSync(`${base}/online`, "utf8").trim() !== "1";
      }
    } catch {}
    return false;
  }
  get onBatteryPower() { return this.isOnBatteryPower(); }
}

export const powerMonitor = new PowerMonitor();

const blockers = new Map<number, { type: string; child: ChildProcess | null }>();
let nextBlocker = 1;

export const powerSaveBlocker = {
  start(type: "prevent-app-suspension" | "prevent-display-sleep") {
    const id = nextBlocker++;
    const reason = "Stella is working";
    const cmd = process.platform === "linux"
      ? ["systemd-inhibit", `--what=${type === "prevent-display-sleep" ? "idle:sleep" : "sleep"}`, "--who=Stella", `--why=${reason}`, "--mode=block", "sleep", "infinity"]
      : process.platform === "darwin"
        ? ["caffeinate", type === "prevent-display-sleep" ? "-d" : "-i", "-w", String(process.pid)]
        : null;
    let child: ChildProcess | null = null;
    if (cmd) {
      child = spawn(cmd[0]!, cmd.slice(1), { stdio: "ignore" });
      child.on("error", () => {});
      child.unref();
    }
    blockers.set(id, { type, child });
    return id;
  },
  stop(id: number) {
    const b = blockers.get(id);
    if (!b) return false;
    b.child?.kill();
    blockers.delete(id);
    return true;
  },
  isStarted(id: number) { return blockers.has(id); },
};

app.once("will-quit", () => { for (const id of [...blockers.keys()]) powerSaveBlocker.stop(id); });

const shortcuts = new Map<string, () => void>();
const normalizeAccel = (a: string) => a.toLowerCase().replace(/\s+/g, "").replace(/commandorcontrol|cmdorctrl/g, "cmdorctrl");

export const globalShortcut = {
  register(accelerator: string, callback: () => void): boolean {
    const key = normalizeAccel(accelerator);
    if (shortcuts.has(key)) return false;
    shortcuts.set(key, callback);
    const named = process.platform === "linux" ? portalShortcut(accelerator) : null;
    const registered = (e: EngineApi) => (named ? request<boolean>("shortcut.register", { accelerator, ...named }) : e.shortcut.register(accelerator));
    void viaEngine("shortcut.register", registered, () => true).then((ok) => {
      if (!ok) {
        shortcuts.delete(key);
        console.error(`[globalShortcut] ${accelerator} is taken by another application`);
      }
    });
    return true;
  },
  registerAll(accelerators: string[], callback: () => void) { for (const a of accelerators) globalShortcut.register(a, callback); },
  isRegistered(accelerator: string) { return shortcuts.has(normalizeAccel(accelerator)); },
  unregister(accelerator: string) {
    if (!shortcuts.delete(normalizeAccel(accelerator))) return;
    void viaEngine("shortcut.unregister", (e) => e.shortcut.unregister(accelerator), () => {});
  },
  unregisterAll() {
    shortcuts.clear();
    void viaEngine("shortcut.unregisterAll", (e) => e.shortcut.unregisterAll(), () => {});
  },
};

onEngine("shortcut", (event) => {
  const cb = shortcuts.get(normalizeAccel(event.accel));
  try { cb?.(); } catch (error) { console.error("[globalShortcut] handler failed:", error); }
});

type MenuItemOptions = {
  id?: string;
  label?: string;
  sublabel?: string;
  role?: string;
  type?: "normal" | "separator" | "submenu" | "checkbox" | "radio";
  accelerator?: string;
  enabled?: boolean;
  visible?: boolean;
  checked?: boolean;
  submenu?: MenuItemOptions[] | Menu;
  click?: (item: MenuItem, win: BrowserWindow | null, event: unknown) => void;
  icon?: unknown;
  toolTip?: string;
};

let nextMenuItem = 1;

export class MenuItem {
  readonly id: string;
  label: string;
  sublabel: string;
  role?: string;
  type: NonNullable<MenuItemOptions["type"]>;
  accelerator?: string;
  enabled: boolean;
  visible: boolean;
  checked: boolean;
  submenu: Menu | null;
  click: (event?: unknown, win?: BrowserWindow | null) => void;
  toolTip: string;
  constructor(options: MenuItemOptions) {
    this.id = options.id ?? `mi${nextMenuItem++}`;
    const role = options.role ? roles[options.role.toLowerCase() as RoleId] : undefined;
    this.label = options.label ?? role?.label() ?? "";
    this.sublabel = options.sublabel ?? "";
    this.role = options.role;
    const submenu = options.submenu ?? role?.submenu?.();
    this.submenu = submenu instanceof Menu ? submenu : submenu ? Menu.buildFromTemplate(submenu) : null;
    this.type = options.type ?? (this.submenu ? "submenu" : "normal");
    this.accelerator = options.accelerator ?? role?.accelerator;
    this.enabled = options.enabled ?? true;
    this.visible = options.visible ?? true;
    this.checked = options.checked ?? false;
    this.toolTip = options.toolTip ?? "";
    this.click = (event?: unknown, win?: BrowserWindow | null) => {
      if (this.type === "checkbox") this.checked = !this.checked;
      if (options.click) options.click(this, win ?? null, event ?? {});
      else if (this.role) runRole(this.role, win ?? null);
    };
  }
  toEngine(): EngineMenuItem {
    return {
      id: this.id,
      label: this.label,
      accelerator: this.accelerator,
      enabled: this.enabled && roles[this.role?.toLowerCase() as RoleId]?.available !== false,
      visible: this.visible,
      checked: this.checked,
      type: this.type === "radio" ? "checkbox" : this.type,
      role: this.role?.toLowerCase(),
      submenu: this.submenu?.items.map((i) => i.toEngine()),
    };
  }
}

const isMac = process.platform === "darwin";
const isWindows = process.platform === "win32";
const isLinux = process.platform === "linux";

type RoleId =
  | "about" | "close" | "copy" | "cut" | "delete" | "forcereload" | "front" | "help" | "hide" | "hideothers"
  | "minimize" | "paste" | "pasteandmatchstyle" | "quit" | "redo" | "reload" | "resetzoom" | "selectall"
  | "services" | "recentdocuments" | "clearrecentdocuments" | "showsubstitutions" | "togglesmartquotes"
  | "togglesmartdashes" | "toggletextreplacement" | "startspeaking" | "stopspeaking" | "toggledevtools"
  | "togglefullscreen" | "undo" | "unhide" | "window" | "zoom" | "zoomin" | "zoomout" | "togglespellchecker"
  | "appmenu" | "filemenu" | "editmenu" | "viewmenu" | "windowmenu" | "sharemenu";

type Role = {
  label(): string;
  accelerator?: string;
  submenu?(): MenuItemOptions[];
  run?(win: BrowserWindow | null): void;
  /** False where the host has nothing behind the role: its item shows disabled. */
  available?: boolean;
};

const fixed = (label: string) => () => label;
const sep: MenuItemOptions = { type: "separator" };
const zoomBy = (win: BrowserWindow | null, step: number) => { if (win) win.webContents.zoomLevel = step === 0 ? 0 : win.webContents.zoomLevel + step; };

// Electron 44's roles (lib/browser/api/menu-item-roles.ts): labels, accelerators and default submenus.
const roles: Record<RoleId, Role> = {
  about: { label: () => (isLinux ? "About" : `About ${app.getName()}`) },
  close: { label: fixed(isMac ? "Close Window" : "Close"), accelerator: "CommandOrControl+W", run: (w) => w?.close() },
  copy: { label: fixed("Copy"), accelerator: "CommandOrControl+C" },
  cut: { label: fixed("Cut"), accelerator: "CommandOrControl+X" },
  delete: { label: fixed("Delete") },
  forcereload: { label: fixed("Force Reload"), accelerator: "Shift+CmdOrCtrl+R", run: (w) => w?.webContents.reloadIgnoringCache() },
  front: { label: fixed("Bring All to Front") },
  help: { label: fixed("Help") },
  hide: { label: () => `Hide ${app.getName()}`, accelerator: "Command+H" },
  hideothers: { label: fixed("Hide Others"), accelerator: "Command+Alt+H" },
  minimize: { label: fixed("Minimize"), accelerator: "CommandOrControl+M", run: (w) => { if (w?.isMinimizable()) w.minimize(); } },
  paste: { label: fixed("Paste"), accelerator: "CommandOrControl+V" },
  pasteandmatchstyle: { label: fixed("Paste and Match Style"), accelerator: isMac ? "Cmd+Option+Shift+V" : "Shift+CommandOrControl+V" },
  quit: { label: () => (isMac ? `Quit ${app.getName()}` : isWindows ? "Exit" : "Quit"), accelerator: isWindows ? undefined : "CommandOrControl+Q", run: () => app.quit() },
  redo: { label: fixed("Redo"), accelerator: isWindows ? "Control+Y" : "Shift+CommandOrControl+Z" },
  reload: { label: fixed("Reload"), accelerator: "CmdOrCtrl+R", run: (w) => w?.webContents.reload() },
  resetzoom: { label: fixed("Actual Size"), accelerator: "CommandOrControl+0", run: (w) => zoomBy(w, 0) },
  selectall: { label: fixed("Select All"), accelerator: "CommandOrControl+A" },
  services: { label: fixed("Services") },
  recentdocuments: { label: fixed("Open Recent") },
  clearrecentdocuments: { label: fixed("Clear Menu") },
  showsubstitutions: { label: fixed("Show Substitutions") },
  togglesmartquotes: { label: fixed("Smart Quotes") },
  togglesmartdashes: { label: fixed("Smart Dashes") },
  toggletextreplacement: { label: fixed("Text Replacement") },
  startspeaking: { label: fixed("Start Speaking") },
  stopspeaking: { label: fixed("Stop Speaking") },
  toggledevtools: { label: fixed("Toggle Developer Tools"), accelerator: isMac ? "Alt+Command+I" : "Ctrl+Shift+I", available: false },
  togglefullscreen: { label: fixed("Toggle Full Screen"), accelerator: isMac ? "Control+Command+F" : "F11", run: (w) => w?.setFullScreen(!w.isFullScreen()) },
  undo: { label: fixed("Undo"), accelerator: "CommandOrControl+Z" },
  unhide: { label: fixed("Show All") },
  window: { label: fixed("Window") },
  zoom: { label: fixed("Zoom") },
  zoomin: { label: fixed("Zoom In"), accelerator: "CommandOrControl+Plus", run: (w) => zoomBy(w, 0.5) },
  zoomout: { label: fixed("Zoom Out"), accelerator: "CommandOrControl+-", run: (w) => zoomBy(w, -0.5) },
  togglespellchecker: { label: fixed("Check Spelling While Typing") },
  appmenu: {
    label: () => app.getName(),
    submenu: () => [{ role: "about" }, sep, { role: "services" }, sep, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, sep, { role: "quit" }],
  },
  filemenu: { label: fixed("File"), submenu: () => [isMac ? { role: "close" } : { role: "quit" }] },
  editmenu: {
    label: fixed("Edit"),
    submenu: () => [
      { role: "undo" }, { role: "redo" }, sep, { role: "cut" }, { role: "copy" }, { role: "paste" },
      ...(isMac
        ? [
            { role: "pasteAndMatchStyle" }, { role: "delete" }, { role: "selectAll" }, sep,
            { label: "Substitutions", submenu: [{ role: "showSubstitutions" }, sep, { role: "toggleSmartQuotes" }, { role: "toggleSmartDashes" }, { role: "toggleTextReplacement" }] },
            { label: "Speech", submenu: [{ role: "startSpeaking" }, { role: "stopSpeaking" }] },
          ]
        : [{ role: "delete" }, sep, { role: "selectAll" }]),
    ],
  },
  viewmenu: {
    label: fixed("View"),
    submenu: () => [
      { role: "reload" }, { role: "forceReload" }, { role: "toggleDevTools" }, sep,
      { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, sep, { role: "togglefullscreen" },
    ],
  },
  windowmenu: {
    label: fixed("Window"),
    submenu: () => [{ role: "minimize" }, { role: "zoom" }, ...(isMac ? [sep, { role: "front" }] : [{ role: "close" }])],
  },
  sharemenu: { label: fixed("Share"), submenu: () => [] },
};

const runRole = (role: string, win: BrowserWindow | null) => roles[role.toLowerCase() as RoleId]?.run?.(win);

let applicationMenuWasSet = false;

// Electron's lib/browser/default-menu.ts, installed at will-finish-launching.
const setDefaultApplicationMenu = () => {
  if (applicationMenuWasSet) return;
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: "appMenu" }] : []),
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ]));
};
app.once("will-finish-launching", setDefaultApplicationMenu);

export class Menu extends EventEmitter {
  static applicationMenu: Menu | null = null;
  readonly items: MenuItem[] = [];
  static buildFromTemplate(template: Array<MenuItemOptions | MenuItem>) {
    const menu = new Menu();
    for (const entry of template) menu.append(entry instanceof MenuItem ? entry : new MenuItem(entry));
    return menu;
  }
  static setApplicationMenu(menu: Menu | null) {
    applicationMenuWasSet = true;
    Menu.applicationMenu = menu;
    app.applicationMenu = menu;
    void viaEngine("menu.setApplicationMenu", (e) => e.menu.setApplicationMenu(menu ? menu.items.map((i) => i.toEngine()) : null), () => {});
  }
  static getApplicationMenu() { return Menu.applicationMenu; }
  static sendActionToFirstResponder() {}
  append(item: MenuItem) { this.items.push(item); }
  insert(pos: number, item: MenuItem) { this.items.splice(pos, 0, item); }
  getMenuItemById(id: string): MenuItem | null {
    for (const item of this.items) {
      if (item.id === id) return item;
      const found = item.submenu?.getMenuItemById(id);
      if (found) return found;
    }
    return null;
  }
  popup(options: { window?: BrowserWindow; x?: number; y?: number; callback?: () => void } = {}) {
    const win = options.window ?? null;
    this.emit("menu-will-show", {});
    void viaEngine("menu.popup", (e) => e.menu.popup(this.items.map((i) => i.toEngine()), { window: win?.hostId, x: options.x, y: options.y }), () => {
      warnOnce("menu-popup", "Menu.popup without an engine: dismissed");
      return null;
    }).then((picked) => {
      if (picked) this.getMenuItemById(picked)?.click({}, win);
      this.emit("menu-will-close", {});
      options.callback?.();
    });
  }
  closePopup() {}
}

onEngine("menu", (event) => {
  const item = Menu.applicationMenu?.getMenuItemById(event.id);
  if (!item) return;
  void import("./browser-window").then(({ BrowserWindow }) => item.click({}, BrowserWindow.getFocusedWindow()));
});

const trays = new Map<string, Tray>();

export class Tray extends EventEmitter {
  private engineId: Promise<string | null>;
  private menu: Menu | null = null;
  private destroyed = false;
  private tooltip = "";
  constructor(image: NativeImage | string, _guid?: string) {
    super();
    const icon = typeof image === "string" ? image : new Uint8Array(image.toPNG());
    this.engineId = viaEngine("tray.create", (e) => e.tray.create({ icon }), () => {
      warnOnce("tray", "Tray without an engine: not shown");
      return null as unknown as string;
    }).then((id) => {
      if (id) trays.set(id, this);
      return id ?? null;
    });
  }
  private withId(name: string, fn: (id: string) => Promise<void> | undefined) {
    void this.engineId.then((id) => { if (id && !this.destroyed) void viaEngine(name, () => fn(id), () => {}); });
  }
  handleEngineEvent(kind: string, item?: string) {
    if (kind === "menu" && item) { this.menu?.getMenuItemById(item)?.click({}, null); return; }
    this.emit(kind, {}, this.getBounds());
  }
  setContextMenu(menu: Menu | null) {
    this.menu = menu;
    this.withId("tray.setMenu", (id) => engine()?.tray.setMenu(id, menu ? menu.items.map((i) => i.toEngine()) : null));
  }
  setToolTip(tooltip: string) { this.tooltip = tooltip; this.withId("tray.setTooltip", (id) => engine()?.tray.setTooltip(id, tooltip)); }
  setImage(image: NativeImage | string) {
    const icon = typeof image === "string" ? image : new Uint8Array(image.toPNG());
    this.withId("tray.setIcon", (id) => engine()?.tray.setIcon(id, icon));
  }
  setPressedImage() {}
  setTitle() {}
  getTitle() { return ""; }
  getToolTip() { return this.tooltip; }
  setIgnoreDoubleClickEvents() {}
  getIgnoreDoubleClickEvents() { return false; }
  displayBalloon() {}
  removeBalloon() {}
  focus() {}
  popUpContextMenu(menu?: Menu) { (menu ?? this.menu)?.popup(); }
  closeContextMenu() {}
  getBounds() { return { x: 0, y: 0, width: 0, height: 0 }; }
  getGUID() { return ""; }
  isDestroyed() { return this.destroyed; }
  destroy() {
    if (this.destroyed) return;
    this.withId("tray.destroy", (id) => engine()?.tray.destroy(id));
    this.destroyed = true;
    void this.engineId.then((id) => { if (id) trays.delete(id); });
  }
}

onEngine("tray", (event) => trays.get(event.id)?.handleEngineEvent(event.kind, event.item));

const notifications = new Map<string, Notification>();
let nextNotification = 1;

export class Notification extends EventEmitter {
  static isSupported() { return true; }
  readonly id = `n${nextNotification++}`;
  title: string;
  subtitle: string;
  body: string;
  silent: boolean;
  urgency: string;
  icon?: string;
  constructor(options: { title?: string; subtitle?: string; body?: string; silent?: boolean; urgency?: string; icon?: string | NativeImage } = {}) {
    super();
    this.title = options.title ?? "";
    this.subtitle = options.subtitle ?? "";
    this.body = options.body ?? "";
    this.silent = options.silent ?? false;
    this.urgency = options.urgency ?? "normal";
    this.icon = typeof options.icon === "string" ? options.icon : undefined;
  }
  show() {
    notifications.set(this.id, this);
    void viaEngine("notify", (e) => e.notify({ id: this.id, title: this.title, body: this.body, icon: this.icon, silent: this.silent }), () => {
      console.error(`[notification] ${this.title}: ${this.body}`);
    }).then(() => this.emit("show", {}));
  }
  close() {
    notifications.delete(this.id);
    this.emit("close", {});
  }
  handleEngineEvent(action: "click" | "close") {
    if (action === "close") notifications.delete(this.id);
    this.emit(action, {});
  }
}

onEngine("notification", (event) => notifications.get(event.id)?.handleEngineEvent(event.action));
