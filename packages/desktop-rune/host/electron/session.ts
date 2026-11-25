// session / protocol / net. Custom schemes registered with protocol.handle answer the engine's
// WebViews (wry custom protocols call `fetchProtocol`) and net.fetch; cookies, permission and
// webRequest handlers are kept per session for the WebViews and the on-demand browser to apply.

import { EventEmitter } from "node:events";
import os from "node:os";
import path from "node:path";

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

class WebRequest {
  readonly listeners = new Map<string, Listener>();
  private set(name: string, a: unknown, b?: unknown) {
    this.listeners.set(name, (typeof a === "function" ? a : b ?? null) as Listener);
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
  private userAgent = `Mozilla/5.0 Stella (Rune)`;
  private preloads: string[] = [];
  private proxy: unknown = null;

  constructor(readonly partition: string) {
    super();
    this.setMaxListeners(0);
  }

  get storagePath() { return this.partition.startsWith("persist:") ? path.join(defaultStorageRoot(), "Partitions", this.partition.slice(8)) : null; }
  getStoragePath() { return this.storagePath; }
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
  getUserAgent() { return this.userAgent; }
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

/** Answers a WebView request to a custom scheme (stella-app, stella-media, canvas, ...). */
export async function fetchProtocol(partition: string, request: Request): Promise<Response | null> {
  return await fetchProtocolIn(sessionFor(partition), request);
}

export async function fetchProtocolIn(session: Session, request: Request): Promise<Response | null> {
  const scheme = new URL(request.url).protocol.slice(0, -1).toLowerCase();
  const handler = session.protocol.handlers.get(scheme) ?? defaultSession().protocol.handlers.get(scheme);
  return handler ? await handler(request) : null;
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
