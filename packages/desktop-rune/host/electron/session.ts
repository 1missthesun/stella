// session / protocol / net. Custom schemes registered with protocol.handle answer the engine's
// WebViews (wry custom protocols call `fetchProtocol`) and net.fetch; cookies, permission and
// webRequest handlers are kept per session for the WebViews and the on-demand browser to apply.

import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";
import { chromeUserAgent } from "./chromium";

type ProtocolHandler = (request: Request) => Response | Promise<Response>;

export type Cookie = {
  name: string;
  value: string;
  domain?: string;
  hostOnly?: boolean;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  session?: boolean;
  expirationDate?: number;
  sameSite?: "unspecified" | "no_restriction" | "lax" | "strict";
};

class Cookies extends EventEmitter {
  private readonly jar = new Map<string, Cookie & { url: string }>();
  private key(c: { url?: string; name: string; domain?: string; path?: string }) {
    const host = c.domain ?? (c.url ? new URL(c.url).hostname : "");
    return `${host}|${c.path ?? "/"}|${c.name}`;
  }
  async get(filter: { url?: string; name?: string; domain?: string; path?: string } = {}) {
    const host = filter.url ? new URL(filter.url).hostname : undefined;
    return [...this.jar.values()].filter((c) =>
      (!filter.name || c.name === filter.name) &&
      (!filter.domain || (c.domain ?? "").endsWith(filter.domain)) &&
      (!filter.path || c.path === filter.path) &&
      (!host || (c.domain ? host.endsWith(c.domain.replace(/^\./, "")) : new URL(c.url).hostname === host)),
    ).map(({ url: _url, ...cookie }) => cookie);
  }
  async set(details: Cookie & { url: string }) {
    const cookie = { path: "/", ...details };
    this.jar.set(this.key(cookie), cookie);
    this.emit("changed", {}, cookie, "explicit", false);
  }
  async remove(url: string, name: string) {
    for (const [k, c] of this.jar) {
      if (c.name === name && (c.url === url || new URL(c.url).hostname === new URL(url).hostname)) {
        this.jar.delete(k);
        this.emit("changed", {}, c, "explicit", true);
      }
    }
  }
  async flushStore() {}
}

type Listener = ((details: any, callback: (response: any) => void) => void) | null;

/** The page a custom-scheme request came from, as Electron's `details.frame` gives it. */
export type RequestFrame = { origin: string; url: string };

/** An origin as Chromium reports it for a standard scheme (`stella-app://desktop`); WHATWG URL gives "null" for custom schemes. */
export const frameOrigin = (url: string | null | undefined): string => {
  try {
    const parsed = new URL(String(url ?? ""));
    if (!parsed.host || parsed.protocol === "data:" || parsed.protocol === "about:" || parsed.protocol === "blob:") return "null";
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return "null";
  }
};

export const frameOf = (url: string | null | undefined): RequestFrame => ({ origin: frameOrigin(url), url: String(url ?? "") });

/** The host's own interface (the stand-in for Electron's renderer at `stella-app://desktop`). */
export const APP_FRAME: RequestFrame = frameOf("stella-app://desktop/");

const urlPattern = (pattern: string) => new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "i");

let requestIds = 0;

class WebRequest {
  readonly listeners = new Map<string, Listener>();
  private readonly filters = new Map<string, RegExp[] | null>();
  private set(name: string, a: unknown, b?: unknown) {
    const urls = typeof a === "object" && a !== null ? (a as { urls?: unknown }).urls : undefined;
    this.filters.set(name, Array.isArray(urls) && urls.length ? urls.map((u) => urlPattern(String(u))) : null);
    this.listeners.set(name, (typeof a === "function" ? a : b ?? null) as Listener);
  }
  /** Runs the session's `onBeforeRequest` listener for a custom-scheme request, as Chromium does before it reaches the protocol handler. */
  async allows(request: Request, frame: RequestFrame | null): Promise<boolean> {
    const listener = this.listeners.get("beforeRequest");
    if (!listener) return true;
    const filter = this.filters.get("beforeRequest");
    if (filter && !filter.some((re) => re.test(request.url))) return true;
    const details = { id: ++requestIds, url: request.url, method: request.method, resourceType: "other", referrer: request.headers.get("referer") ?? "", timestamp: Date.now(), uploadData: [], frame };
    const response = await new Promise<{ cancel?: boolean } | undefined>((resolve) => {
      try {
        listener(details, (value) => resolve(value as { cancel?: boolean } | undefined));
      } catch {
        resolve({ cancel: true });
      }
    });
    return response?.cancel !== true;
  }
  onBeforeRequest(a: unknown, b?: unknown) { this.set("beforeRequest", a, b); }
  onBeforeSendHeaders(a: unknown, b?: unknown) { this.set("beforeSendHeaders", a, b); }
  onSendHeaders(a: unknown, b?: unknown) { this.set("sendHeaders", a, b); }
  onHeadersReceived(a: unknown, b?: unknown) { this.set("headersReceived", a, b); }
  onResponseStarted(a: unknown, b?: unknown) { this.set("responseStarted", a, b); }
  onBeforeRedirect(a: unknown, b?: unknown) { this.set("beforeRedirect", a, b); }
  onCompleted(a: unknown, b?: unknown) { this.set("completed", a, b); }
  onErrorOccurred(a: unknown, b?: unknown) { this.set("errorOccurred", a, b); }
}

export class Protocol {
  readonly handlers = new Map<string, ProtocolHandler>();
  handle(scheme: string, handler: ProtocolHandler) { this.handlers.set(scheme.toLowerCase(), handler); }
  unhandle(scheme: string) { this.handlers.delete(scheme.toLowerCase()); }
  isProtocolHandled(scheme: string) { return this.handlers.has(scheme.toLowerCase()); }
  registerSchemesAsPrivileged(schemes: Array<{ scheme: string; privileges?: Record<string, boolean> }>) {
    for (const s of schemes) privilegedSchemes.set(s.scheme.toLowerCase(), s.privileges ?? {});
  }
  registerFileProtocol() { return false; }
  registerStringProtocol() { return false; }
  registerBufferProtocol() { return false; }
  registerHttpProtocol() { return false; }
  registerStreamProtocol() { return false; }
  unregisterProtocol() { return false; }
  isProtocolRegistered() { return false; }
  interceptFileProtocol() { return false; }
  uninterceptProtocol() { return false; }
}

export const privilegedSchemes = new Map<string, Record<string, boolean>>();

const sessions = new Map<string, Session>();

const defaultStorageRoot = () => process.env.STELLA_RUNE_USER_DATA_DIR ?? path.join(os.tmpdir(), "stella-rune");

export class Session extends EventEmitter {
  readonly protocol = new Protocol();
  readonly cookies = new Cookies();
  readonly webRequest = new WebRequest();
  readonly serviceWorkers = { getAllRunning: () => ({}), on() {}, removeListener() {} };
  readonly extensions = { getAllExtensions: () => [], loadExtension: async () => { throw new Error("Extensions are not supported."); }, removeExtension() {} };
  readonly netLog = { startLogging: async () => {}, stopLogging: async () => {}, currentlyLogging: false };
  permissionRequestHandler: ((...args: any[]) => void) | null = null;
  permissionCheckHandler: ((...args: any[]) => boolean) | null = null;
  devicePermissionHandler: ((...args: any[]) => boolean) | null = null;
  displayMediaRequestHandler: ((...args: any[]) => void) | null = null;
  spellCheckerLanguages: string[] = [];
  readonly customDictionary = new Set<string>();
  private userAgent: string | null = null;
  private preloads: string[] = [];
  private proxy: unknown = null;

  constructor(readonly partition: string) {
    super();
    this.setMaxListeners(0);
  }

  get storagePath() { return this.partition.startsWith("persist:") ? path.join(defaultStorageRoot(), "Partitions", this.partition.slice(8)) : null; }
  getStoragePath() { return this.storagePath; }
  /** Where this session's pages keep their Chromium profile; null for an in-memory session. */
  get chromiumProfileDir() {
    if (this.partition.startsWith("path:")) return path.join(this.partition.slice(5), "RuneChromium");
    if (this.partition === "") return path.join(defaultStorageRoot(), "RuneChromium");
    return this.storagePath ? path.join(this.storagePath, "RuneChromium") : null;
  }
  isPersistent() { return this.partition === "" || this.partition.startsWith("persist:"); }

  setPermissionRequestHandler(h: Session["permissionRequestHandler"]) { this.permissionRequestHandler = h; }
  setPermissionCheckHandler(h: Session["permissionCheckHandler"]) { this.permissionCheckHandler = h; }
  setDevicePermissionHandler(h: Session["devicePermissionHandler"]) { this.devicePermissionHandler = h; }
  setDisplayMediaRequestHandler(h: Session["displayMediaRequestHandler"]) { this.displayMediaRequestHandler = h; }
  setBluetoothPairingHandler() {}
  setUSBProtectedClassesHandler() {}
  setCertificateVerifyProc() {}
  setSpellCheckerLanguages(langs: string[]) { this.spellCheckerLanguages = [...langs]; }
  getSpellCheckerLanguages() { return this.spellCheckerLanguages; }
  get availableSpellCheckerLanguages() { return ["en-US"]; }
  setSpellCheckerEnabled() {}
  isSpellCheckerEnabled() { return true; }
  setSpellCheckerDictionaryDownloadURL() {}
  addWordToSpellCheckerDictionary(word: string) { this.customDictionary.add(word); return true; }
  removeWordFromSpellCheckerDictionary(word: string) { return this.customDictionary.delete(word); }
  listWordsInSpellCheckerDictionary() { return Promise.resolve([...this.customDictionary]); }
  setUserAgent(ua: string) { this.userAgent = ua; }
  getUserAgent() { return this.userAgent ?? chromeUserAgent(); }
  setPreloads(p: string[]) { this.preloads = [...p]; }
  getPreloads() { return this.preloads; }
  registerPreloadScript(script: { filePath?: string }) { if (script.filePath) this.preloads.push(script.filePath); return String(this.preloads.length); }
  unregisterPreloadScript() {}
  getPreloadScripts() { return this.preloads.map((filePath) => ({ filePath, type: "frame" })); }
  async setProxy(config: unknown) { this.proxy = config; }
  async resolveProxy() { return "DIRECT"; }
  async forceReloadProxyConfig() {}
  async closeAllConnections() {}
  async clearStorageData() {}
  async clearCache() {}
  async clearHostResolverCache() {}
  async clearAuthCache() {}
  async clearCodeCaches() {}
  async clearData() {}
  async getCacheSize() { return 0; }
  async flushStorageData() {}
  setDownloadPath() {}
  enableNetworkEmulation() {}
  disableNetworkEmulation() {}
  preconnect() {}
  allowNTLMCredentialsForDomains() {}
  setSSLConfig() {}
  setCodeCachePath() {}
  getBlobData() { return Promise.resolve(Buffer.alloc(0)); }
  createInterruptedDownload() {}
  isProxyConfigured() { return this.proxy !== null; }

  async fetch(input: string | Request, init?: RequestInit): Promise<Response> {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const scheme = new URL(request.url).protocol.slice(0, -1).toLowerCase();
    const handler = this.protocol.handlers.get(scheme) ?? defaultSession().protocol.handlers.get(scheme);
    if (handler) return await handler(request);
    return await fetch(request);
  }

  static fromPartition(partition: string, _options?: unknown) {
    return sessionFor(partition);
  }

  static fromPath(p: string) {
    return sessionFor(`path:${p}`);
  }

  static get defaultSession() {
    return defaultSession();
  }
}

export function sessionFor(partition?: string): Session {
  const key = partition ?? "";
  let s = sessions.get(key);
  if (!s) sessions.set(key, (s = new Session(key)));
  return s;
}

export const defaultSession = () => sessionFor("");

/**
 * Answers a request to a custom scheme (stella-app, stella-media, canvas, ...) from `frame`, the
 * page that made it: the serving session's `webRequest.onBeforeRequest` judges it first, as in
 * Chromium, so a scheme that only its own pages may read (stella-media) refuses other pages.
 */
export async function fetchProtocol(partition: string, request: Request, frame: RequestFrame): Promise<Response | null> {
  return await fetchProtocolIn(sessionFor(partition), request, frame);
}

export async function fetchProtocolIn(session: Session, request: Request, frame: RequestFrame): Promise<Response | null> {
  const scheme = new URL(request.url).protocol.slice(0, -1).toLowerCase();
  const owner = session.protocol.handlers.has(scheme) ? session : defaultSession();
  const handler = owner.protocol.handlers.get(scheme);
  if (!handler) return null;
  if (!(await owner.webRequest.allows(request, frame))) return new Response("Blocked", { status: 403, headers: { "content-type": "text/plain" } });
  return await handler(request);
}

export const session = {
  get defaultSession() { return defaultSession(); },
  fromPartition: (partition: string, options?: unknown) => Session.fromPartition(partition, options),
  fromPath: (p: string) => Session.fromPath(p),
};

export const protocol = new Proxy({} as Protocol, {
  get(_t, prop) {
    const p = defaultSession().protocol;
    const v = Reflect.get(p, prop, p);
    return typeof v === "function" ? v.bind(p) : v;
  },
});

export const net = {
  fetch: (input: string | Request, init?: RequestInit) => defaultSession().fetch(input, init),
  isOnline: () => true,
  get online() { return true; },
  request() { throw new Error("net.request is not available; use net.fetch."); },
  resolveHost: async (host: string) => {
    const dns = await import("node:dns/promises");
    const records = await dns.lookup(host, { all: true });
    return { endpoints: records.map((r) => ({ address: r.address, family: r.family === 6 ? "ipv6" : "ipv4" })) };
  },
};
