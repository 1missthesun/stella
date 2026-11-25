// `app`: identity, paths, lifecycle (ready / before-quit / will-quit / quit), single instance,
// relaunch and the command line. Quitting ends the host; the engine exits when the host does.

import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { warnOnce } from "./engine";
import { nativeImage } from "./native-image";
import { ProcessSingleton } from "./process-singleton";

const home = os.homedir();

const appDataDir = () => {
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support");
  if (process.platform === "win32") return process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
  return process.env.XDG_CONFIG_HOME ?? path.join(home, ".config");
};

const xdgUserDir = (name: string, fallback: string) => {
  if (process.platform !== "linux") return path.join(home, fallback);
  try {
    const conf = readFileSync(path.join(process.env.XDG_CONFIG_HOME ?? path.join(home, ".config"), "user-dirs.dirs"), "utf8");
    const m = conf.match(new RegExp(`^XDG_${name}_DIR="([^"]+)"`, "m"));
    if (m) return m[1]!.replace("$HOME", home);
  } catch {}
  return path.join(home, fallback);
};

type PreventableEvent = { preventDefault(): void; defaultPrevented: boolean };
const preventable = (): PreventableEvent => {
  const e: PreventableEvent = { defaultPrevented: false, preventDefault() { e.defaultPrevented = true; } };
  return e;
};

class CommandLine {
  private readonly switches = new Map<string, string>();
  private readonly args: string[] = [];
  appendSwitch(name: string, value?: string) { this.switches.set(name, value ?? ""); }
  appendArgument(arg: string) { this.args.push(arg); }
  hasSwitch(name: string) { return this.switches.has(name); }
  getSwitchValue(name: string) { return this.switches.get(name) ?? ""; }
  removeSwitch(name: string) { this.switches.delete(name); }
}

export type AppHooks = {
  /** Ends the process (engine and host); the host wires this to the engine's quit command. */
  exit(code: number): void;
  focus?(): void;
};

class App extends EventEmitter {
  readonly commandLine = new CommandLine();
  readonly isPackaged = false;
  readonly dock = process.platform === "darwin"
    ? { show: async () => {}, hide: () => {}, isVisible: () => true, setBadge: () => {}, getBadge: () => "", bounce: () => 0, cancelBounce: () => {}, setIcon: () => {}, setMenu: () => {}, getMenu: () => null, downloadFinished: () => {} }
    : undefined;
  userAgentFallback = "Mozilla/5.0 Stella (Rune)";
  accessibilitySupportEnabled = false;
  applicationMenu: unknown = null;
  badgeCount = 0;
  readonly runningUnderARM64Translation = false;
  hooks: AppHooks = { exit: (code) => process.exit(code) };
  private name = "Stella";
  private readonly paths = new Map<string, string>();
  private ready = false;
  private readonly readyWaiters: Array<() => void> = [];
  private quitting = false;
  private relaunchRequest: { args?: string[]; execPath?: string } | null = null;
  private lockServer: net.Server | null = null;
  private singleton: ProcessSingleton | null = null;
  private appPath = process.cwd();
  private version = "0.0.0";

  constructor() {
    super();
    this.setMaxListeners(0);
  }

  configure(options: { appPath: string; version?: string; name?: string }) {
    this.appPath = options.appPath;
    if (options.version) this.version = options.version;
    if (options.name) this.name = options.name;
  }

  getName() { return this.name; }
  setName(name: string) { this.name = name; }
  getVersion() { return this.version; }
  getAppPath() { return this.appPath; }
  getLocale() { return Intl.DateTimeFormat().resolvedOptions().locale || "en-US"; }
  getSystemLocale() { return this.getLocale(); }
  getPreferredSystemLanguages() { return [this.getLocale()]; }
  getLocaleCountryCode() { return this.getLocale().split("-")[1] ?? ""; }

  getPath(name: string): string {
    const set = this.paths.get(name);
    if (set) return set;
    switch (name) {
      case "home": return home;
      case "appData": return appDataDir();
      case "userData":
      case "sessionData": return path.join(appDataDir(), this.name);
      case "temp": return os.tmpdir();
      case "exe": return process.execPath;
      case "module": return process.execPath;
      case "desktop": return xdgUserDir("DESKTOP", "Desktop");
      case "documents": return xdgUserDir("DOCUMENTS", "Documents");
      case "downloads": return xdgUserDir("DOWNLOAD", "Downloads");
      case "music": return xdgUserDir("MUSIC", "Music");
      case "pictures": return xdgUserDir("PICTURES", "Pictures");
      case "videos": return xdgUserDir("VIDEOS", "Videos");
      case "recent": return path.join(appDataDir(), "Microsoft", "Windows", "Recent");
      case "logs": return process.platform === "darwin" ? path.join(home, "Library", "Logs", this.name) : path.join(this.getPath("userData"), "logs");
      case "crashDumps": return path.join(this.getPath("userData"), "Crashpad");
      case "assets": return this.appPath;
      default: throw new Error(`Failed to get '${name}' path`);
    }
  }

  setPath(name: string, value: string) { this.paths.set(name, value); }
  setAppLogsPath(value?: string) { this.paths.set("logs", value ?? this.getPath("logs")); }

  isReady() { return this.ready; }
  whenReady(): Promise<void> {
    if (this.ready) return Promise.resolve();
    return new Promise((resolve) => this.readyWaiters.push(resolve));
  }

  /** Called by the host once the engine is attached and Electron main has evaluated. */
  markReady() {
    if (this.ready) return;
    this.ready = true;
    this.emit("will-finish-launching");
    this.emit("ready", {}, {});
    for (const resolve of this.readyWaiters.splice(0)) resolve();
  }

  quit() {
    if (this.quitting) return;
    const before = preventable();
    this.emit("before-quit", before);
    if (before.defaultPrevented) return;
    const will = preventable();
    this.emit("will-quit", will);
    if (will.defaultPrevented) return;
    this.quitting = true;
    this.emit("quit", {}, 0);
    this.exit(0);
  }

  exit(code = 0) {
    this.quitting = true;
    this.releaseSingleInstanceLock();
    if (this.relaunchRequest) this.spawnRelaunch(this.relaunchRequest);
    this.hooks.exit(code);
  }

  relaunch(options: { args?: string[]; execPath?: string } = {}) {
    this.relaunchRequest = options;
  }

  private spawnRelaunch(options: { args?: string[]; execPath?: string }) {
    const execPath = options.execPath ?? process.env.STELLA_RUNE_ENGINE_EXE;
    if (!execPath) {
      warnOnce("relaunch", "app.relaunch without STELLA_RUNE_ENGINE_EXE: the launcher restarts Stella");
      return;
    }
    const child = spawn(execPath, options.args ?? process.argv.slice(2), { detached: true, stdio: "ignore", env: process.env });
    child.unref();
  }

  focus(_options?: unknown) { this.hooks.focus?.(); }
  hide() {}
  show() {}
  isHidden() { return false; }
  isActive() { return true; }

  requestSingleInstanceLock(additionalData?: unknown): boolean {
    if (this.singleton?.held || this.lockServer) return true;
    const userData = this.getPath("userData");
    mkdirSync(userData, { recursive: true });
    if (process.platform !== "win32") {
      const singleton = new ProcessSingleton(userData, (m) => {
        this.emit("second-instance", preventable(), m.argv, m.cwd, m.data);
        return true;
      });
      const lockPid = process.env.STELLA_RUNE_BRIDGE_OUT_FD ? process.ppid : process.pid;
      if (!singleton.acquire(process.argv, process.cwd(), additionalData, lockPid)) return false;
      this.singleton = singleton;
      return true;
    }
    const lockPath = `\\\\.\\pipe\\stella-rune-${Buffer.from(userData).toString("hex").slice(-40)}`;
    const message = JSON.stringify({ argv: process.argv, cwd: process.cwd(), data: additionalData ?? null });
    const probe = Bun.spawnSync([process.execPath, "-e", `
      const s = require("node:net").connect(${JSON.stringify(lockPath)});
      s.on("connect", () => { s.end(${JSON.stringify(message)}); setTimeout(() => process.exit(0), 50); });
      s.on("error", () => process.exit(1));
      setTimeout(() => process.exit(1), 1500);
    `], { stdout: "ignore", stderr: "ignore" });
    if (probe.exitCode === 0) return false;
    const server = net.createServer((socket) => {
      let body = "";
      socket.setEncoding("utf8");
      socket.on("data", (chunk) => { body += chunk; });
      socket.on("end", () => {
        try {
          const parsed = JSON.parse(body) as { argv: string[]; cwd: string; data: unknown };
          this.emit("second-instance", preventable(), parsed.argv, parsed.cwd, parsed.data);
        } catch {}
      });
      socket.on("error", () => {});
    });
    server.on("error", (error) => console.error("[app] single-instance listener failed:", error));
    server.listen(lockPath);
    server.unref();
    this.lockServer = server;
    return true;
  }

  hasSingleInstanceLock() { return this.singleton?.held === true || this.lockServer !== null; }

  releaseSingleInstanceLock() {
    this.singleton?.release();
    this.singleton = null;
    this.lockServer?.close();
    this.lockServer = null;
  }

  setAsDefaultProtocolClient(_protocol: string) { return true; }
  removeAsDefaultProtocolClient() { return true; }
  isDefaultProtocolClient() { return false; }
  getApplicationNameForProtocol() { return ""; }
  getApplicationInfoForProtocol() { return Promise.resolve({ icon: nativeImage.createEmpty(), path: "", name: "" }); }
  setAppUserModelId() {}
  setActivationPolicy() {}
  setBadgeCount(count?: number) { this.badgeCount = count ?? 0; return true; }
  getBadgeCount() { return this.badgeCount; }
  setUserTasks() { return true; }
  getJumpListSettings() { return { minItems: 0, removedItems: [] }; }
  setJumpList() { return "ok"; }
  addRecentDocument() {}
  clearRecentDocuments() {}
  getLoginItemSettings() { return { openAtLogin: false, openAsHidden: false, wasOpenedAtLogin: false, wasOpenedAsHidden: false, restoreState: false, status: "not-registered", executableWillLaunchAtLogin: false, launchItems: [] }; }
  setLoginItemSettings() {}
  isInApplicationsFolder() { return true; }
  moveToApplicationsFolder() { return false; }
  isEmojiPanelSupported() { return false; }
  showEmojiPanel() {}
  showAboutPanel() {}
  setAboutPanelOptions() {}
  isSecureKeyboardEntryEnabled() { return false; }
  setSecureKeyboardEntryEnabled() {}
  setAccessibilitySupportEnabled(on: boolean) { this.accessibilitySupportEnabled = on; }
  isAccessibilitySupportEnabled() { return this.accessibilitySupportEnabled; }
  disableHardwareAcceleration() {}
  disableDomainBlockingFor3DAPIs() {}
  enableSandbox() {}
  setProxy() { return Promise.resolve(); }
  resolveProxy() { return Promise.resolve("DIRECT"); }
  importCertificate(_o: unknown, cb: (r: number) => void) { cb(-1); }
  getGPUFeatureStatus() { return {}; }
  getGPUInfo() { return Promise.resolve({}); }
  configureHostResolver() {}
  invalidateCurrentActivity() {}
  resignCurrentActivity() {}
  updateCurrentActivity() {}
  setUserActivity() {}
  getCurrentActivityType() { return ""; }
  startAccessingSecurityScopedResource() { return () => {}; }
  async getFileIcon() { return nativeImage.createEmpty(); }

  getAppMetrics() {
    const usage = process.resourceUsage();
    return [{
      pid: process.pid,
      type: "Browser",
      creationTime: Date.now() - process.uptime() * 1000,
      cpu: { percentCPUUsage: 0, idleWakeupsPerSecond: 0, cumulativeCPUUsage: (usage.userCPUTime + usage.systemCPUTime) / 1e6 },
      memory: { workingSetSize: Math.round(process.memoryUsage().rss / 1024), peakWorkingSetSize: Math.round(usage.maxRSS), privateBytes: Math.round(process.memoryUsage().rss / 1024) },
      sandboxed: false,
      integrityLevel: "unknown",
      name: "Stella host",
      serviceName: "host",
    }];
  }
}

export const app = new App();
