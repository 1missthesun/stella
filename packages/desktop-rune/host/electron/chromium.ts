// The on-demand browser behind web pages Electron would render offscreen or in a WebContentsView
// (the in-app browser's tabs, agent browsing, page snapshots, media probes). One headless Chromium
// per persistent profile, driven over --remote-debugging-pipe, started on first use and stopped
// once it has had no pages for a while. Each page is a CDP target with its own flat session.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";

export type CdpMessage = { id?: number; method?: string; params?: Record<string, unknown>; result?: any; error?: { code: number; message: string }; sessionId?: string };

const IDLE_STOP_MS = 60_000;

const CANDIDATES: Record<string, string[]> = {
  linux: ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome-stable", "/usr/bin/google-chrome", "/opt/google/chrome/chrome", "/snap/bin/chromium"],
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
  ],
  win32: [
    path.join(process.env.PROGRAMFILES ?? "C:\\Program Files", "Google\\Chrome\\Application\\chrome.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)", "Google\\Chrome\\Application\\chrome.exe"),
    path.join(process.env.LOCALAPPDATA ?? "", "Google\\Chrome\\Application\\chrome.exe"),
  ],
};

/** A managed Chrome for Testing under Stella's runtimes, else a Chrome/Chromium on the system. */
export function resolveChromium(): string | null {
  const configured = process.env.STELLA_RUNE_CHROMIUM?.trim();
  if (configured) return existsSync(configured) ? configured : null;
  const runtimes = path.join(os.homedir(), process.platform === "darwin" ? "Library/Application Support/Stella/runtimes" : process.platform === "win32" ? "AppData/Local/Stella/runtimes" : ".local/share/stella/runtimes");
  const managed = process.platform === "darwin"
    ? "chrome/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
    : process.platform === "win32" ? "chrome/chrome.exe" : "chrome/chrome";
  if (existsSync(path.join(runtimes, managed))) return path.join(runtimes, managed);
  return (CANDIDATES[process.platform] ?? []).find((p) => existsSync(p)) ?? null;
}

let majorVersion: string | null | undefined;

/** The major version of the Chromium pages run in, read from the install without starting it. */
export function chromiumMajorVersion(): string | null {
  if (majorVersion !== undefined) return majorVersion;
  majorVersion = null;
  const binary = resolveChromium();
  if (!binary) return null;
  try {
    if (process.platform === "darwin") {
      const plist = readFileSync(path.resolve(binary, "../../Info.plist"), "utf8");
      majorVersion = plist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>(\d+)/)?.[1] ?? null;
    } else if (process.platform === "win32") {
      majorVersion = readdirSync(path.dirname(binary)).map((d) => d.match(/^(\d+)\.\d+\.\d+\.\d+$/)?.[1]).find(Boolean) ?? null;
    } else {
      const out = spawnSync(binary, ["--version"], { encoding: "utf8", timeout: 5000 }).stdout ?? "";
      majorVersion = out.match(/(\d+)\.\d+\.\d+/)?.[1] ?? null;
    }
  } catch {}
  return majorVersion;
}

const PLATFORM = process.platform === "darwin"
  ? { token: "Macintosh; Intel Mac OS X 10_15_7", name: "macOS" }
  : process.platform === "win32" ? { token: "Windows NT 10.0; Win64; x64", name: "Windows" } : { token: "X11; Linux x86_64", name: "Linux" };

/** macOS evaluates TLS trust through the account's keychains, found from HOME, so every https load
 * hangs under an isolated HOME. A run with its own HOME names the account's home in
 * STELLA_RUNE_ACCOUNT_HOME, and Chrome then stays off the login keychain. */
const accountHome = process.platform === "darwin" ? process.env.STELLA_RUNE_ACCOUNT_HOME?.trim() || null : null;
const chromiumEnv = (): NodeJS.ProcessEnv => (accountHome ? { ...process.env, HOME: accountHome } : process.env);

/** Chrome's reduced user agent for the installed Chromium (headless Chromium calls itself HeadlessChrome). */
export function chromeUserAgent() {
  const major = chromiumMajorVersion() ?? "0";
  return `Mozilla/5.0 (${PLATFORM.token}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
}

/** Client hints to match `userAgent` (headless brands itself "HeadlessChrome" there too). */
export function userAgentMetadataFor(userAgent: string) {
  const major = userAgent.match(/\bChrome\/(\d+)/)?.[1] ?? chromiumMajorVersion() ?? "0";
  return {
    brands: [{ brand: "Chromium", version: major }, { brand: "Not_A Brand", version: "24" }],
    fullVersionList: [{ brand: "Chromium", version: `${major}.0.0.0` }, { brand: "Not_A Brand", version: "24.0.0.0" }],
    platform: PLATFORM.name,
    platformVersion: "",
    architecture: process.arch === "arm64" ? "arm" : "x86",
    model: "",
    mobile: false,
    bitness: "64",
  };
}

export class CdpError extends Error {
  constructor(readonly method: string, readonly code: number, message: string) { super(`${method}: ${message}`); }
}

/** One Chromium process and its pipe connection. */
export class ChromiumProcess extends EventEmitter {
  readonly child: ChildProcess;
  private readonly writer: NodeJS.WritableStream;
  private nextId = 1;
  private readonly waiting = new Map<number, { method: string; resolve(v: any): void; reject(e: Error): void }>();
  private readonly sessions = new Map<string, (m: CdpMessage) => void>();
  private pages = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  exited = false;

  constructor(readonly profileDir: string, binary: string, private readonly onGone: () => void, extraArgs: string[] = []) {
    super();
    this.setMaxListeners(0);
    mkdirSync(profileDir, { recursive: true });
    this.child = spawn(binary, [
      "--headless=new",
      "--remote-debugging-pipe",
      `--user-data-dir=${profileDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-features=Translate,MediaRouter,OptimizationHints",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      "--window-size=1280,720",
      ...(accountHome ? ["--use-mock-keychain", "--password-store=basic"] : []),
      ...extraArgs,
      "about:blank",
    ], { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"], env: chromiumEnv() });
    this.writer = this.child.stdio[3] as NodeJS.WritableStream;
    const reader = this.child.stdio[4] as NodeJS.ReadableStream;
    let pending: Buffer = Buffer.alloc(0);
    reader.on("data", (chunk: Buffer) => {
      pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
      let end: number;
      while ((end = pending.indexOf(0)) >= 0) {
        const text = pending.subarray(0, end).toString("utf8");
        pending = pending.subarray(end + 1);
        try { this.dispatch(JSON.parse(text)); } catch (error) { console.error("[chromium] bad message", error); }
      }
    });
    (this.child.stdio[2] as NodeJS.ReadableStream).on("data", () => {});
    this.child.once("exit", (code, signal) => {
      this.exited = true;
      for (const w of this.waiting.values()) w.reject(new Error(`Chromium exited (${code ?? signal})`));
      this.waiting.clear();
      this.emit("exit");
      onGone();
    });
    console.error(`[chromium] started pid ${this.child.pid} (${path.basename(binary)}, profile ${profileDir})`);
  }

  private dispatch(m: CdpMessage) {
    if (m.id !== undefined) {
      const w = this.waiting.get(m.id);
      if (!w) return;
      this.waiting.delete(m.id);
      if (m.error) w.reject(new CdpError(w.method, m.error.code, m.error.message));
      else w.resolve(m.result ?? {});
      return;
    }
    if (m.sessionId) this.sessions.get(m.sessionId)?.(m);
    this.emit("event", m);
  }

  send<T = any>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    if (this.exited) return Promise.reject(new Error("Chromium is not running"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.waiting.set(id, { method, resolve, reject });
      this.writer.write(`${JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params })}\0`);
    });
  }

  /** Routes every message carrying `sessionId` (events of that session) to `listener`. */
  onSession(sessionId: string, listener: (m: CdpMessage) => void) {
    this.sessions.set(sessionId, listener);
    return () => { this.sessions.delete(sessionId); };
  }

  retainPage() {
    this.pages++;
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
  }

  releasePage() {
    this.pages = Math.max(0, this.pages - 1);
    if (this.pages > 0 || this.idleTimer) return;
    this.idleTimer = setTimeout(() => this.stop(), IDLE_STOP_MS);
    this.idleTimer.unref();
  }

  stop() {
    if (this.exited) return;
    void this.send("Browser.close").catch(() => {});
    const killTimer = setTimeout(() => { if (!this.exited) this.child.kill("SIGKILL"); }, 3000);
    killTimer.unref();
  }
}

const processes = new Map<string, ChromiumProcess>();
let exitHooked = false;

export function chromiumAvailable() {
  return resolveChromium() !== null;
}

/** The Chromium for `profileDir`, started if it isn't running. */
export async function chromiumFor(profileDir: string): Promise<ChromiumProcess> {
  const existing = processes.get(profileDir);
  if (existing && !existing.exited) return existing;
  const binary = resolveChromium();
  if (!binary) throw new Error("No Chromium or Chrome was found for the in-app browser (set STELLA_RUNE_CHROMIUM or install Chrome).");
  if (!exitHooked) {
    exitHooked = true;
    process.once("exit", () => { for (const p of processes.values()) if (!p.exited) p.child.kill("SIGKILL"); });
  }
  const created = new ChromiumProcess(profileDir, binary, () => { if (processes.get(profileDir) === created) processes.delete(profileDir); });
  processes.set(profileDir, created);
  await created.send("Browser.getVersion");
  await created.send("Target.setDiscoverTargets", { discover: true });
  return created;
}

export function stopAllChromium() {
  for (const p of processes.values()) p.stop();
}
