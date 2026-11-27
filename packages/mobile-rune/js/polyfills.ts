// The web platform the UI and desktop-ui's logic expect, over the phone app's natives
// (natives.d.ts). JavaScriptCore alone has the language (Promise, Intl, typed arrays, WeakRef)
// but none of the web's APIs. Imported first by entry.ts; host/dom (window, document, storage,
// matchMedia, animation frames) is installed on top by the entry, as the desktop host does.

/// <reference path="./natives.d.ts" />

const g = globalThis as any;
const N = __native;
// Bun (the desktop host) defines these on its global; the web code reads them.
g.self = g;
g.global ??= g;

// ------------------------------------------------------------------ console

const fmt = (v: unknown): string => {
  if (typeof v === "string") return v;
  if (v instanceof Error) return `${v.name}: ${v.message}${v.stack ? `\n${v.stack}` : ""}`;
  try {
    return JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? String(x) : x)) ?? String(v);
  } catch {
    return String(v);
  }
};
const logAt = (level: string) => (...args: unknown[]) => N.log(level, args.map(fmt).join(" "));
g.console = {
  log: logAt("log"), info: logAt("info"), debug: logAt("debug"), warn: logAt("warn"), error: logAt("error"), trace: logAt("trace"),
  dir: logAt("log"), table: logAt("log"), group: () => {}, groupCollapsed: () => {}, groupEnd: () => {}, time: () => {}, timeEnd: () => {}, assert: (ok: unknown, ...a: unknown[]) => { if (!ok) logAt("error")("assert", ...a); },
  count: () => {}, countReset: () => {},
};

// ------------------------------------------------------------------ timers and time

type TimerEntry = { fn: (...a: any[]) => void; args: any[]; repeats: boolean };
const timers = new Map<number, TimerEntry>();
let nextTimer = 1;
g.__timerFire = (id: number) => {
  const t = timers.get(id);
  if (!t) return;
  if (!t.repeats) timers.delete(id);
  try { t.fn(...t.args); } catch (e) { console.error("timer callback failed", e); }
};
g.setTimeout = (fn: (...a: any[]) => void, ms = 0, ...args: any[]) => {
  const id = nextTimer++;
  if (typeof fn !== "function") return id;
  timers.set(id, { fn, args, repeats: false });
  N.setTimer(id, Number(ms) || 0, false);
  return id;
};
g.setInterval = (fn: (...a: any[]) => void, ms = 0, ...args: any[]) => {
  const id = nextTimer++;
  timers.set(id, { fn, args, repeats: true });
  N.setTimer(id, Math.max(1, Number(ms) || 0), true);
  return id;
};
g.clearTimeout = g.clearInterval = (id?: number) => {
  if (id == null || !timers.delete(id)) return;
  N.clearTimer(id);
};
g.setImmediate = (fn: (...a: any[]) => void, ...args: any[]) => g.setTimeout(fn, 0, ...args);
g.clearImmediate = g.clearTimeout;
g.queueMicrotask ??= (fn: () => void) => { Promise.resolve().then(fn).catch((e) => console.error("microtask failed", e)); };

const startNow = N.now();
const timeOrigin = N.epochNow();
const marks = new Map<string, number>();
g.performance = {
  timeOrigin,
  now: () => N.now() - startNow,
  mark: (name: string) => { marks.set(name, g.performance.now()); return { name, startTime: marks.get(name) }; },
  measure: () => ({ duration: 0 }),
  getEntriesByName: () => [], getEntriesByType: () => [], clearMarks: () => marks.clear(), clearMeasures: () => {},
};

// ------------------------------------------------------------------ encoding

class TextEncoderPoly {
  readonly encoding = "utf-8";
  encode(s = ""): Uint8Array {
    const out: number[] = [];
    for (let i = 0; i < s.length; i++) {
      let c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        const d = s.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; }
        else c = 0xfffd;
      } else if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  }
  encodeInto(s: string, dest: Uint8Array) {
    const b = this.encode(s);
    const n = Math.min(b.length, dest.length);
    dest.set(b.subarray(0, n));
    return { read: s.length, written: n };
  }
}

class TextDecoderPoly {
  readonly encoding: string;
  readonly fatal = false;
  readonly ignoreBOM = false;
  private pending: number[] = [];
  constructor(label = "utf-8") { this.encoding = label.toLowerCase(); }
  decode(input?: ArrayBufferView | ArrayBuffer, opts?: { stream?: boolean }): string {
    let bytes: Uint8Array = input === undefined ? new Uint8Array(0) : input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    if (this.encoding === "latin1" || this.encoding === "iso-8859-1" || this.encoding === "ascii") {
      let s = "";
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
      return s;
    }
    if (this.pending.length) {
      const merged = new Uint8Array(this.pending.length + bytes.length);
      merged.set(this.pending);
      merged.set(bytes, this.pending.length);
      bytes = merged;
      this.pending = [];
    }
    let end = bytes.length;
    if (opts?.stream) {
      // Keep a trailing incomplete sequence for the next chunk.
      let i = end - 1, back = 0;
      while (i >= 0 && back < 4 && (bytes[i]! & 0xc0) === 0x80) { i--; back++; }
      if (i >= 0) {
        const b = bytes[i]!;
        const need = b >= 0xf0 ? 4 : b >= 0xe0 ? 3 : b >= 0xc0 ? 2 : 1;
        if (need > back + 1) { this.pending = Array.from(bytes.subarray(i)); end = i; }
      }
    }
    const parts: string[] = [];
    let chunk: number[] = [];
    for (let i = 0; i < end; ) {
      const b = bytes[i]!;
      let c = 0xfffd, n = 1;
      if (b < 0x80) { c = b; }
      else if (b >= 0xc2 && b < 0xe0 && i + 1 < end) { c = ((b & 31) << 6) | (bytes[i + 1]! & 63); n = 2; }
      else if (b >= 0xe0 && b < 0xf0 && i + 2 < end) { c = ((b & 15) << 12) | ((bytes[i + 1]! & 63) << 6) | (bytes[i + 2]! & 63); n = 3; }
      else if (b >= 0xf0 && b < 0xf5 && i + 3 < end) { c = ((b & 7) << 18) | ((bytes[i + 1]! & 63) << 12) | ((bytes[i + 2]! & 63) << 6) | (bytes[i + 3]! & 63); n = 4; }
      i += n;
      if (c > 0xffff) { c -= 0x10000; chunk.push(0xd800 + (c >> 10), 0xdc00 + (c & 1023)); }
      else chunk.push(c);
      if (chunk.length > 8000) { parts.push(String.fromCharCode(...chunk)); chunk = []; }
    }
    parts.push(String.fromCharCode(...chunk));
    let s = parts.join("");
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
    return s;
  }
}
g.TextEncoder ??= TextEncoderPoly;
g.TextDecoder ??= TextDecoderPoly;

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
g.btoa ??= (s: string) => {
  let out = "";
  for (let i = 0; i < s.length; i += 3) {
    const a = s.charCodeAt(i), b = s.charCodeAt(i + 1), c = s.charCodeAt(i + 2);
    const n = (a << 16) | ((b || 0) << 8) | (c || 0);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + (i + 1 < s.length ? B64[(n >> 6) & 63]! : "=") + (i + 2 < s.length ? B64[n & 63]! : "=");
  }
  return out;
};
g.atob ??= (s: string) => {
  const clean = String(s).replace(/[\s=]/g, "").replace(/-/g, "+").replace(/_/g, "/");
  let out = "";
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]!) << 18) | (B64.indexOf(clean[i + 1] ?? "A") << 12) | ((B64.indexOf(clean[i + 2] ?? "A") & 63) << 6) | (B64.indexOf(clean[i + 3] ?? "A") & 63);
    out += String.fromCharCode((n >> 16) & 255);
    if (i + 2 < clean.length) out += String.fromCharCode((n >> 8) & 255);
    if (i + 3 < clean.length) out += String.fromCharCode(n & 255);
  }
  return out;
};

// ------------------------------------------------------------------ URL

const SPECIAL: Record<string, string> = { "http:": "80", "https:": "443", "ws:": "80", "wss:": "443", "ftp:": "21", "file:": "" };

class URLSearchParamsPoly {
  private list: [string, string][] = [];
  constructor(init?: string | Record<string, string> | [string, string][] | URLSearchParamsPoly, private owner?: URLPoly) {
    if (init == null) return;
    if (typeof init === "string") this.parse(init);
    else if (init instanceof URLSearchParamsPoly) this.list = [...init.list];
    else if (Array.isArray(init)) this.list = init.map(([k, v]) => [String(k), String(v)]);
    else if (typeof (init as any)[Symbol.iterator] === "function") this.list = [...(init as any)].map(([k, v]: any) => [String(k), String(v)]);
    else this.list = Object.entries(init).map(([k, v]) => [k, String(v)]);
  }
  /** @internal */ parse(s: string) {
    this.list = [];
    s = s.replace(/^\?/, "");
    if (!s) return;
    for (const part of s.split("&")) {
      if (!part) continue;
      const i = part.indexOf("=");
      const k = i < 0 ? part : part.slice(0, i), v = i < 0 ? "" : part.slice(i + 1);
      const dec = (x: string) => { try { return decodeURIComponent(x.replace(/\+/g, " ")); } catch { return x; } };
      this.list.push([dec(k), dec(v)]);
    }
  }
  private sync() { this.owner?._setSearch(this.toString()); }
  get size() { return this.list.length; }
  append(k: string, v: string) { this.list.push([String(k), String(v)]); this.sync(); }
  delete(k: string) { this.list = this.list.filter(([x]) => x !== k); this.sync(); }
  get(k: string) { return this.list.find(([x]) => x === k)?.[1] ?? null; }
  getAll(k: string) { return this.list.filter(([x]) => x === k).map(([, v]) => v); }
  has(k: string) { return this.list.some(([x]) => x === k); }
  set(k: string, v: string) {
    const i = this.list.findIndex(([x]) => x === k);
    if (i < 0) this.list.push([String(k), String(v)]);
    else { this.list[i] = [String(k), String(v)]; this.list = this.list.filter(([x], j) => x !== k || j === i); }
    this.sync();
  }
  sort() { this.list.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)); this.sync(); }
  forEach(fn: (v: string, k: string, p: this) => void) { for (const [k, v] of this.list) fn(v, k, this); }
  keys() { return this.list.map(([k]) => k)[Symbol.iterator](); }
  values() { return this.list.map(([, v]) => v)[Symbol.iterator](); }
  entries() { return this.list.map(([k, v]) => [k, v] as [string, string])[Symbol.iterator](); }
  [Symbol.iterator]() { return this.entries(); }
  toString() {
    const enc = (x: string) => encodeURIComponent(x).replace(/%20/g, "+").replace(/[!'()~]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
    return this.list.map(([k, v]) => `${enc(k)}=${enc(v)}`).join("&");
  }
}

function normalizePath(path: string, special: boolean): string {
  if (special) path = path.replace(/\\/g, "/");
  const segs = path.split("/");
  const out: string[] = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i]!;
    if (s === "..") { if (out.length > 1) out.pop(); if (i === segs.length - 1) out.push(""); }
    else if (s === ".") { if (i === segs.length - 1) out.push(""); }
    else out.push(s);
  }
  let p = out.join("/");
  if (special && !p.startsWith("/")) p = "/" + p;
  return p.replace(/[ "<>`{}]/g, (c) => encodeURIComponent(c));
}

class URLPoly {
  protocol = "";
  username = "";
  password = "";
  hostname = "";
  port = "";
  pathname = "";
  private _search = "";
  hash = "";
  private _params: URLSearchParamsPoly;
  private opaque = false;

  static canParse(u: string, base?: string) { try { new URLPoly(u, base); return true; } catch { return false; } }
  static parse(u: string, base?: string) { try { return new URLPoly(u, base); } catch { return null; } }
  static createObjectURL(blob: any) { return blobRegistry.add(blob); }
  static revokeObjectURL(u: string) { blobRegistry.revoke(u); }

  constructor(input: string | URLPoly, base?: string | URLPoly) {
    let s = String(input).trim();
    const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):(.*)$/.exec(s);
    if (m) {
      this.parseAbsolute(m[1]!.toLowerCase() + ":", m[2]!);
    } else {
      if (base === undefined) throw new TypeError(`Invalid URL: ${s}`);
      const b = base instanceof URLPoly ? base : new URLPoly(String(base));
      this.protocol = b.protocol; this.username = b.username; this.password = b.password; this.hostname = b.hostname; this.port = b.port;
      const special = this.protocol in SPECIAL;
      if (s.startsWith("//")) { this.parseAbsolute(b.protocol, s); }
      else {
        let rest = s;
        let hash = "", search: string | null = null;
        const hi = rest.indexOf("#");
        if (hi >= 0) { hash = rest.slice(hi); rest = rest.slice(0, hi); }
        const qi = rest.indexOf("?");
        if (qi >= 0) { search = rest.slice(qi); rest = rest.slice(0, qi); }
        if (rest === "") { this.pathname = b.pathname; this._search = search ?? b._search; }
        else if (rest.startsWith("/")) { this.pathname = normalizePath(rest, special); this._search = search ?? ""; }
        else { this.pathname = normalizePath(b.pathname.replace(/[^/]*$/, "") + rest, special); this._search = search ?? ""; }
        this.hash = hash;
        this.opaque = b.opaque;
      }
    }
    if (this._search === "?") this._search = "";
    if (this.hash === "#") this.hash = "";
    this._params = new URLSearchParamsPoly(this._search, this);
  }

  private parseAbsolute(protocol: string, rest: string): void {
    this.protocol = protocol;
    const special = protocol in SPECIAL;
    const hi = rest.indexOf("#");
    if (hi >= 0) { this.hash = rest.slice(hi); rest = rest.slice(0, hi); }
    const qi = rest.indexOf("?");
    if (qi >= 0) { this._search = rest.slice(qi); rest = rest.slice(0, qi); }
    if (special) rest = rest.replace(/\\/g, "/");
    if (rest.startsWith("//")) {
      rest = rest.slice(2);
      const pi = rest.indexOf("/");
      let auth = pi >= 0 ? rest.slice(0, pi) : rest;
      const path = pi >= 0 ? rest.slice(pi) : "";
      const at = auth.lastIndexOf("@");
      if (at >= 0) {
        const cred = auth.slice(0, at);
        auth = auth.slice(at + 1);
        const ci = cred.indexOf(":");
        this.username = ci >= 0 ? cred.slice(0, ci) : cred;
        this.password = ci >= 0 ? cred.slice(ci + 1) : "";
      }
      const pm = /^(\[[^\]]*\]|[^:]*)(?::(\d*))?$/.exec(auth);
      if (!pm) throw new TypeError(`Invalid URL: ${protocol}${rest}`);
      this.hostname = special ? pm[1]!.toLowerCase() : pm[1]!;
      this.port = pm[2] && pm[2] !== SPECIAL[protocol] ? String(Number(pm[2])) : "";
      if (special && protocol !== "file:" && !this.hostname) throw new TypeError(`Invalid URL: ${protocol}//${rest}`);
      this.pathname = path ? normalizePath(path, special) : special ? "/" : "";
    } else if (special) {
      // http:example.com style
      const r = rest.replace(/^\/*/, "");
      return this.parseAbsolute(protocol, "//" + r);
    } else {
      this.opaque = !rest.startsWith("/");
      this.pathname = this.opaque ? rest : normalizePath(rest, false);
    }
  }

  /** @internal */ _setSearch(q: string) { this._search = q ? `?${q}` : ""; }
  get search() { return this._search; }
  set search(v: string) { v = String(v); this._search = v && v !== "?" ? (v.startsWith("?") ? v : `?${v}`) : ""; this._params.parse(this._search); }
  get searchParams() { return this._params; }
  get host() { return this.hostname + (this.port ? `:${this.port}` : ""); }
  set host(v: string) { const [h, p] = String(v).split(":"); this.hostname = h ?? ""; this.port = p ?? ""; }
  get origin() { return this.protocol in SPECIAL && this.protocol !== "file:" ? `${this.protocol}//${this.host}` : "null"; }
  get href() {
    const auth = this.username ? `${this.username}${this.password ? `:${this.password}` : ""}@` : "";
    const slashes = this.hostname || this.protocol in SPECIAL || (!this.opaque && this.pathname.startsWith("//")) ? "//" : "";
    return `${this.protocol}${slashes}${auth}${this.host}${this.pathname}${this._search}${this.hash}`;
  }
  set href(v: string) { Object.assign(this, new URLPoly(v)); }
  toString() { return this.href; }
  toJSON() { return this.href; }
}
g.URL ??= URLPoly;
g.URLSearchParams ??= URLSearchParamsPoly;

// ------------------------------------------------------------------ events

class EventPoly {
  readonly type: string;
  readonly bubbles: boolean;
  readonly cancelable: boolean;
  readonly composed: boolean;
  defaultPrevented = false;
  target: any = null;
  currentTarget: any = null;
  readonly timeStamp = Date.now();
  readonly isTrusted = false;
  eventPhase = 0;
  /** @internal */ _stop = false;
  constructor(type: string, init: { bubbles?: boolean; cancelable?: boolean; composed?: boolean } = {}) {
    this.type = String(type);
    this.bubbles = !!init.bubbles;
    this.cancelable = !!init.cancelable;
    this.composed = !!init.composed;
  }
  preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
  stopPropagation() {}
  stopImmediatePropagation() { this._stop = true; }
  composedPath() { return this.target ? [this.target] : []; }
  get srcElement() { return this.target; }
  get returnValue() { return !this.defaultPrevented; }
}
class CustomEventPoly<T = unknown> extends EventPoly {
  readonly detail: T;
  constructor(type: string, init: { detail?: T; bubbles?: boolean; cancelable?: boolean } = {}) { super(type, init); this.detail = init.detail as T; }
}
class MessageEventPoly extends EventPoly {
  readonly data: unknown; readonly origin: string; readonly lastEventId = ""; readonly source = null; readonly ports = [];
  constructor(type: string, init: { data?: unknown; origin?: string } = {}) { super(type); this.data = init.data; this.origin = init.origin ?? ""; }
}
class CloseEventPoly extends EventPoly {
  readonly code: number; readonly reason: string; readonly wasClean: boolean;
  constructor(type: string, init: { code?: number; reason?: string; wasClean?: boolean } = {}) { super(type); this.code = init.code ?? 1005; this.reason = init.reason ?? ""; this.wasClean = init.wasClean ?? true; }
}
class ErrorEventPoly extends EventPoly {
  readonly message: string; readonly error: unknown;
  constructor(type: string, init: { message?: string; error?: unknown } = {}) { super(type); this.message = init.message ?? ""; this.error = init.error; }
}

type Listener = { fn: any; once: boolean; signal?: AbortSignal };
class EventTargetPoly {
  private _listeners = new Map<string, Listener[]>();
  addEventListener(type: string, fn: any, opts?: boolean | { once?: boolean; signal?: AbortSignal; capture?: boolean; passive?: boolean }) {
    if (!fn) return;
    const o = typeof opts === "object" ? opts : {};
    if (o.signal?.aborted) return;
    const list = this._listeners.get(type) ?? [];
    if (list.some((l) => l.fn === fn)) return;
    list.push({ fn, once: !!o.once, signal: o.signal });
    this._listeners.set(type, list);
    o.signal?.addEventListener("abort", () => this.removeEventListener(type, fn));
  }
  removeEventListener(type: string, fn: any) {
    const list = this._listeners.get(type);
    if (!list) return;
    const i = list.findIndex((l) => l.fn === fn);
    if (i >= 0) list.splice(i, 1);
  }
  dispatchEvent(event: EventPoly): boolean {
    try { (event as any).target ??= this; } catch {}
    try { (event as any).currentTarget = this; } catch {}
    const list = [...(this._listeners.get(event.type) ?? [])];
    const prop = (this as any)[`on${event.type}`];
    if (typeof prop === "function") { try { prop.call(this, event); } catch (e) { console.error(`on${event.type} failed`, e); } }
    for (const l of list) {
      if (l.once) this.removeEventListener(event.type, l.fn);
      try { typeof l.fn === "function" ? l.fn.call(this, event) : l.fn.handleEvent(event); } catch (e) { console.error(`${event.type} listener failed`, e); }
      if ((event as any)._stop) break;
    }
    return !event.defaultPrevented;
  }
}
g.Event ??= EventPoly;
g.CustomEvent ??= CustomEventPoly;
g.MessageEvent ??= MessageEventPoly;
g.CloseEvent ??= CloseEventPoly;
g.ErrorEvent ??= ErrorEventPoly;
g.EventTarget ??= EventTargetPoly;
// The global object is an EventTarget, as in browsers and Bun (`window.addEventListener("storage", …)`).
{
  const globalTarget = new EventTargetPoly();
  g.addEventListener = globalTarget.addEventListener.bind(globalTarget);
  g.removeEventListener = globalTarget.removeEventListener.bind(globalTarget);
  g.dispatchEvent = globalTarget.dispatchEvent.bind(globalTarget);
}
for (const name of ["UIEvent", "KeyboardEvent", "MouseEvent", "PointerEvent", "FocusEvent", "InputEvent", "ProgressEvent", "StorageEvent", "PopStateEvent", "HashChangeEvent", "PageTransitionEvent", "DragEvent", "ClipboardEvent", "WheelEvent", "TouchEvent", "AnimationEvent", "TransitionEvent", "PromiseRejectionEvent", "SubmitEvent"]) {
  g[name] ??= class extends EventPoly {
    constructor(type: string, init: Record<string, unknown> = {}) { super(type, init); Object.assign(this, init); }
  };
}

class AbortSignalPoly extends EventTargetPoly {
  aborted = false;
  reason: unknown = undefined;
  onabort: ((e: EventPoly) => void) | null = null;
  throwIfAborted() { if (this.aborted) throw this.reason; }
  static abort(reason?: unknown) { const c = new AbortControllerPoly(); c.abort(reason); return c.signal; }
  static timeout(ms: number) { const c = new AbortControllerPoly(); setTimeout(() => c.abort(new DOMExceptionPoly("The operation timed out.", "TimeoutError")), ms); return c.signal; }
  static any(signals: AbortSignalPoly[]) {
    const c = new AbortControllerPoly();
    for (const s of signals) {
      if (s.aborted) { c.abort(s.reason); break; }
      s.addEventListener("abort", () => c.abort(s.reason), { once: true });
    }
    return c.signal;
  }
}
class AbortControllerPoly {
  readonly signal = new AbortSignalPoly();
  abort(reason?: unknown) {
    if (this.signal.aborted) return;
    this.signal.aborted = true;
    this.signal.reason = reason ?? new DOMExceptionPoly("This operation was aborted", "AbortError");
    this.signal.dispatchEvent(new EventPoly("abort"));
  }
}
class DOMExceptionPoly extends Error {
  readonly code = 0;
  constructor(message = "", name = "Error") { super(message); this.name = name; }
}
g.DOMException ??= DOMExceptionPoly;
g.AbortController ??= AbortControllerPoly;
g.AbortSignal ??= AbortSignalPoly;

// ------------------------------------------------------------------ Blob, File, FormData

const toBytes = (part: unknown): Uint8Array => {
  if (part instanceof Uint8Array) return part;
  if (part instanceof ArrayBuffer) return new Uint8Array(part);
  if (ArrayBuffer.isView(part)) return new Uint8Array(part.buffer, part.byteOffset, part.byteLength);
  if (part instanceof BlobPoly) return part._bytes;
  return new TextEncoderPoly().encode(String(part));
};
const concat = (parts: Uint8Array[]) => {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
};
class BlobPoly {
  /** @internal */ readonly _bytes: Uint8Array;
  readonly type: string;
  constructor(parts: unknown[] = [], opts: { type?: string } = {}) { this._bytes = concat(parts.map(toBytes)); this.type = (opts.type ?? "").toLowerCase(); }
  get size() { return this._bytes.length; }
  async arrayBuffer() { return this._bytes.slice().buffer; }
  async bytes() { return this._bytes.slice(); }
  async text() { return new TextDecoderPoly().decode(this._bytes); }
  slice(start = 0, end = this._bytes.length, type = "") { return new BlobPoly([this._bytes.slice(start, end)], { type }); }
  stream() { const b = this._bytes; return new ReadableStreamPoly({ start(c: any) { c.enqueue(b); c.close(); } }); }
}
class FilePoly extends BlobPoly {
  readonly name: string; readonly lastModified: number;
  constructor(parts: unknown[], name: string, opts: { type?: string; lastModified?: number } = {}) { super(parts, opts); this.name = name; this.lastModified = opts.lastModified ?? Date.now(); }
}
class FormDataPoly {
  /** @internal */ readonly _list: [string, string | FilePoly][] = [];
  append(k: string, v: string | BlobPoly, name?: string) { this._list.push([k, v instanceof BlobPoly ? (v instanceof FilePoly ? v : new FilePoly([v], name ?? "blob", { type: v.type })) : String(v)]); }
  set(k: string, v: string | BlobPoly, name?: string) { this.delete(k); this.append(k, v, name); }
  get(k: string) { return this._list.find(([x]) => x === k)?.[1] ?? null; }
  getAll(k: string) { return this._list.filter(([x]) => x === k).map(([, v]) => v); }
  has(k: string) { return this._list.some(([x]) => x === k); }
  delete(k: string) { for (let i = this._list.length - 1; i >= 0; i--) if (this._list[i]![0] === k) this._list.splice(i, 1); }
  entries() { return this._list[Symbol.iterator](); }
  [Symbol.iterator]() { return this.entries(); }
  forEach(fn: (v: unknown, k: string) => void) { for (const [k, v] of this._list) fn(v, k); }
}
g.Blob ??= BlobPoly;
g.File ??= FilePoly;
g.FormData ??= FormDataPoly;
const blobRegistry = (() => {
  const map = new Map<string, BlobPoly>();
  let n = 0;
  return {
    add(b: BlobPoly) { const u = `blob:stella-rune/${++n}`; map.set(u, b); return u; },
    get(u: string) { return map.get(u); },
    revoke(u: string) { map.delete(u); },
  };
})();
g.__blobRegistry = blobRegistry;

class FileReaderPoly extends EventTargetPoly {
  result: unknown = null; readyState = 0; error: unknown = null;
  onload: any = null; onloadend: any = null; onerror: any = null;
  private done(v: unknown) { this.result = v; this.readyState = 2; this.dispatchEvent(new EventPoly("load")); this.dispatchEvent(new EventPoly("loadend")); }
  readAsArrayBuffer(b: BlobPoly) { void b.arrayBuffer().then((v) => this.done(v)); }
  readAsText(b: BlobPoly) { void b.text().then((v) => this.done(v)); }
  readAsDataURL(b: BlobPoly) {
    void b.bytes().then((bytes) => {
      let s = "";
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      this.done(`data:${b.type || "application/octet-stream"};base64,${btoa(s)}`);
    });
  }
  abort() {}
}
g.FileReader ??= FileReaderPoly;

// ------------------------------------------------------------------ streams (the reader slice fetch bodies need)

class ReadableStreamPoly {
  private queue: unknown[] = [];
  private closed = false;
  private error: unknown = null;
  private waiters: ((r: IteratorResult<unknown>) => void)[] = [];
  private failers: ((e: unknown) => void)[] = [];
  locked = false;
  constructor(source: { start?: (c: any) => void; pull?: (c: any) => void | Promise<void>; cancel?: (r?: unknown) => void } = {}) {
    const self = this;
    const controller = {
      enqueue(v: unknown) { if (self.waiters.length) { self.failers.shift(); self.waiters.shift()!({ value: v, done: false }); } else self.queue.push(v); },
      close() { self.closed = true; while (self.waiters.length) { self.failers.shift(); self.waiters.shift()!({ value: undefined, done: true }); } },
      error(e: unknown) { self.error = e; while (self.failers.length) { self.waiters.shift(); self.failers.shift()!(e); } },
      desiredSize: 1,
    };
    this._cancel = source.cancel;
    source.start?.(controller);
  }
  private _cancel?: (r?: unknown) => void;
  getReader() {
    this.locked = true;
    return {
      read: (): Promise<IteratorResult<any>> => {
        if (this.queue.length) return Promise.resolve({ value: this.queue.shift(), done: false });
        if (this.error) return Promise.reject(this.error);
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((res, rej) => { this.waiters.push(res); this.failers.push(rej); });
      },
      releaseLock: () => { this.locked = false; },
      cancel: async (r?: unknown) => { this.closed = true; this._cancel?.(r); },
      closed: Promise.resolve(),
    };
  }
  async cancel(r?: unknown) { this.closed = true; this._cancel?.(r); }
  async *[Symbol.asyncIterator]() {
    const r = this.getReader();
    while (true) { const { value, done } = await r.read(); if (done) return; yield value; }
  }
  pipeThrough(t: { writable: any; readable: any }) { void this.pipeTo(t.writable); return t.readable; }
  async pipeTo(w: { getWriter(): any }) {
    const wr = w.getWriter();
    for await (const v of this) await wr.write(v);
    await wr.close();
  }
}
g.ReadableStream ??= ReadableStreamPoly;

// ------------------------------------------------------------------ fetch

class HeadersPoly {
  private map = new Map<string, string>();
  constructor(init?: Record<string, string> | [string, string][] | HeadersPoly) {
    if (!init) return;
    if (init instanceof HeadersPoly) init.forEach((v, k) => this.append(k, v));
    else if (Array.isArray(init)) for (const [k, v] of init) this.append(k, v);
    else if (typeof (init as any)[Symbol.iterator] === "function") for (const [k, v] of init as any) this.append(k, v);
    else for (const [k, v] of Object.entries(init)) if (v !== undefined) this.append(k, v);
  }
  append(k: string, v: string) { k = k.toLowerCase(); const old = this.map.get(k); this.map.set(k, old !== undefined ? `${old}, ${v}` : String(v)); }
  set(k: string, v: string) { this.map.set(k.toLowerCase(), String(v)); }
  get(k: string) { return this.map.get(k.toLowerCase()) ?? null; }
  getSetCookie() { const c = this.get("set-cookie"); return c ? [c] : []; }
  has(k: string) { return this.map.has(k.toLowerCase()); }
  delete(k: string) { this.map.delete(k.toLowerCase()); }
  forEach(fn: (v: string, k: string, h: this) => void) { for (const [k, v] of this.map) fn(v, k, this); }
  keys() { return this.map.keys(); }
  values() { return this.map.values(); }
  entries() { return this.map.entries(); }
  [Symbol.iterator]() { return this.map.entries(); }
  /** @internal */ toObject() { return Object.fromEntries(this.map); }
}

type BodyInit = string | Uint8Array | ArrayBuffer | ArrayBufferView | BlobPoly | FormDataPoly | URLSearchParamsPoly | ReadableStreamPoly | null | undefined;

async function bodyBytes(body: BodyInit, headers: HeadersPoly): Promise<Uint8Array | string | undefined> {
  if (body == null) return undefined;
  if (typeof body === "string") { if (!headers.has("content-type")) headers.set("content-type", "text/plain;charset=UTF-8"); return body; }
  if (body instanceof URLSearchParamsPoly) { if (!headers.has("content-type")) headers.set("content-type", "application/x-www-form-urlencoded;charset=UTF-8"); return body.toString(); }
  if (body instanceof BlobPoly) { if (body.type && !headers.has("content-type")) headers.set("content-type", body.type); return body._bytes; }
  if (body instanceof FormDataPoly) {
    const boundary = `----stellarune${Math.random().toString(16).slice(2)}`;
    const enc = new TextEncoderPoly();
    const parts: Uint8Array[] = [];
    for (const [k, v] of body._list) {
      if (typeof v === "string") parts.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
      else { parts.push(enc.encode(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"; filename="${v.name}"\r\nContent-Type: ${v.type || "application/octet-stream"}\r\n\r\n`)); parts.push(v._bytes); parts.push(enc.encode("\r\n")); }
    }
    parts.push(enc.encode(`--${boundary}--\r\n`));
    headers.set("content-type", `multipart/form-data; boundary=${boundary}`);
    return concat(parts);
  }
  if (body instanceof ReadableStreamPoly) { const chunks: Uint8Array[] = []; for await (const c of body) chunks.push(toBytes(c)); return concat(chunks); }
  return toBytes(body);
}

class ResponsePoly {
  readonly headers: HeadersPoly;
  readonly status: number;
  readonly statusText: string;
  readonly type = "basic";
  readonly redirected = false;
  url: string;
  bodyUsed = false;
  /** @internal */ _chunks: Uint8Array[] | null = null;
  /** @internal */ _stream: ReadableStreamPoly | null = null;
  constructor(body?: BodyInit, init: { status?: number; statusText?: string; headers?: any } = {}) {
    this.status = init.status ?? 200;
    this.statusText = init.statusText ?? "";
    this.headers = new HeadersPoly(init.headers);
    this.url = "";
    if (body instanceof ReadableStreamPoly) this._stream = body;
    else if (body != null) { const s = body; this._stream = new ReadableStreamPoly({ start: async (c: any) => { const b = await bodyBytes(s, this.headers); c.enqueue(typeof b === "string" ? new TextEncoderPoly().encode(b) : b ?? new Uint8Array()); c.close(); } }); }
  }
  get ok() { return this.status >= 200 && this.status < 300; }
  get body() { return this._stream; }
  static json(v: unknown, init: any = {}) { return new ResponsePoly(JSON.stringify(v), { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } }); }
  static error() { return new ResponsePoly(null, { status: 0 }); }
  static redirect(url: string, status = 302) { return new ResponsePoly(null, { status, headers: { location: url } }); }
  async bytes(): Promise<Uint8Array> {
    if (this.bodyUsed) throw new TypeError("Body already used");
    this.bodyUsed = true;
    if (!this._stream) return new Uint8Array();
    const chunks: Uint8Array[] = [];
    for await (const c of this._stream) chunks.push(toBytes(c));
    return concat(chunks);
  }
  async arrayBuffer() { const b = await this.bytes(); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }
  async text() { return new TextDecoderPoly().decode(await this.bytes()); }
  async json() { return JSON.parse(await this.text()); }
  async blob() { return new BlobPoly([await this.bytes()], { type: this.headers.get("content-type") ?? "" }); }
  async formData(): Promise<FormDataPoly> { throw new TypeError("formData() is not supported"); }
  clone(): ResponsePoly {
    const r = new ResponsePoly(null, { status: this.status, statusText: this.statusText, headers: this.headers });
    r.url = this.url;
    if (this._stream) {
      const src = this._stream;
      const buffered: Uint8Array[] = [];
      let done = false;
      const pump = (async () => { for await (const c of src) buffered.push(toBytes(c)); done = true; })();
      const mk = () => new ReadableStreamPoly({ start: async (c: any) => { await pump; for (const b of buffered) c.enqueue(b); c.close(); } });
      void done;
      this._stream = mk();
      r._stream = mk();
    }
    return r;
  }
}

class RequestPoly {
  readonly url: string; readonly method: string; readonly headers: HeadersPoly; readonly signal: AbortSignalPoly | undefined;
  readonly redirect: string; readonly credentials: string; readonly mode = "cors"; readonly cache: string;
  /** @internal */ readonly _body: BodyInit;
  constructor(input: string | URLPoly | RequestPoly, init: any = {}) {
    const from = input instanceof RequestPoly ? input : null;
    this.url = from ? from.url : String(input);
    this.method = (init.method ?? from?.method ?? "GET").toUpperCase();
    this.headers = new HeadersPoly(init.headers ?? from?.headers);
    this.signal = init.signal ?? from?.signal;
    this.redirect = init.redirect ?? from?.redirect ?? "follow";
    this.credentials = init.credentials ?? "same-origin";
    this.cache = init.cache ?? "default";
    this._body = init.body ?? from?._body;
  }
  clone() { return new RequestPoly(this); }
  async text() { const b = await bodyBytes(this._body, this.headers); return typeof b === "string" ? b : new TextDecoderPoly().decode(b ?? new Uint8Array()); }
  async json() { return JSON.parse(await this.text()); }
  async arrayBuffer() { const b = await bodyBytes(this._body, this.headers); return (typeof b === "string" ? new TextEncoderPoly().encode(b) : b ?? new Uint8Array()).slice().buffer; }
}

type Pending = { resolve: (r: ResponsePoly) => void; reject: (e: unknown) => void; controller?: any; response?: ResponsePoly };
const fetches = new Map<number, Pending>();
let nextFetch = 1;
g.__fetchEvent = (id: number, kind: string, a?: any, b?: any, c?: any) => {
  const p = fetches.get(id);
  if (!p) return;
  if (kind === "head") {
    let controller: any;
    const stream = new ReadableStreamPoly({ start: (ctl: any) => { controller = ctl; }, cancel: () => { N.fetchAbort(id); fetches.delete(id); } });
    const r = new ResponsePoly(stream, { status: a, headers: b });
    r.url = c ?? "";
    p.controller = controller;
    p.response = r;
    p.resolve(r);
  } else if (kind === "data") {
    p.controller?.enqueue(a);
  } else if (kind === "end") {
    p.controller?.close();
    fetches.delete(id);
  } else if (kind === "error") {
    const err = new TypeError(`Network request failed: ${a}`);
    if (p.response) p.controller?.error(err);
    else p.reject(err);
    fetches.delete(id);
  }
};

g.fetch = async (input: string | URLPoly | RequestPoly, init: any = {}): Promise<ResponsePoly> => {
  const req = new RequestPoly(input, init);
  const url = String(req.url);
  if (url.startsWith("data:")) {
    const m = /^data:([^,]*?)(;base64)?,(.*)$/s.exec(url);
    const raw = m?.[2] ? atob(m[3]!) : decodeURIComponent(m?.[3] ?? "");
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i) & 255;
    return new ResponsePoly(bytes, { headers: { "content-type": m?.[1] || "text/plain" } });
  }
  if (url.startsWith("blob:")) {
    const blob = blobRegistry.get(url);
    if (!blob) throw new TypeError("Failed to fetch");
    return new ResponsePoly(blob, { headers: { "content-type": blob.type } });
  }
  if (url.startsWith("file:") || url.startsWith("/")) {
    const path = url.startsWith("file:") ? decodeURIComponent(new URLPoly(url).pathname) : url;
    const bytes = N.readFile(path);
    if (!bytes) return new ResponsePoly(null, { status: 404 });
    return new ResponsePoly(bytes);
  }
  if (req.signal?.aborted) throw req.signal.reason;
  const body = await bodyBytes(req._body, req.headers);
  const id = nextFetch++;
  return new Promise<ResponsePoly>((resolve, reject) => {
    fetches.set(id, { resolve, reject });
    req.signal?.addEventListener("abort", () => {
      const p = fetches.get(id);
      fetches.delete(id);
      N.fetchAbort(id);
      const reason = req.signal!.reason;
      if (p?.response) p.controller?.error(reason);
      else reject(reason);
    }, { once: true });
    N.fetch(id, { url, method: req.method, headers: req.headers.toObject(), redirect: req.redirect }, body);
  });
};
g.Headers ??= HeadersPoly;
g.Request ??= RequestPoly;
g.Response ??= ResponsePoly;

// ------------------------------------------------------------------ WebSocket

const sockets = new Map<number, WebSocketPoly>();
let nextSocket = 1;
class WebSocketPoly extends EventTargetPoly {
  static readonly CONNECTING = 0; static readonly OPEN = 1; static readonly CLOSING = 2; static readonly CLOSED = 3;
  readonly CONNECTING = 0; readonly OPEN = 1; readonly CLOSING = 2; readonly CLOSED = 3;
  readyState = 0;
  protocol = "";
  extensions = "";
  bufferedAmount = 0;
  binaryType: "blob" | "arraybuffer" = "blob";
  onopen: any = null; onmessage: any = null; onclose: any = null; onerror: any = null;
  /** @internal */ readonly _id: number;
  constructor(readonly url: string, protocols?: string | string[]) {
    super();
    this._id = nextSocket++;
    sockets.set(this._id, this);
    const list = protocols === undefined ? [] : Array.isArray(protocols) ? protocols : [protocols];
    N.wsOpen(this._id, String(url), list);
  }
  send(data: string | ArrayBuffer | ArrayBufferView | BlobPoly) {
    if (this.readyState !== 1) throw new DOMExceptionPoly("WebSocket is not open", "InvalidStateError");
    N.wsSend(this._id, typeof data === "string" ? data : toBytes(data));
  }
  close(code = 1000, reason = "") {
    if (this.readyState >= 2) return;
    this.readyState = 2;
    N.wsClose(this._id, code, reason);
    setTimeout(() => this._closed(code, reason), 0);
  }
  /** @internal */ _closed(code: number, reason: string) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    sockets.delete(this._id);
    this.dispatchEvent(new CloseEventPoly("close", { code, reason, wasClean: code === 1000 }));
  }
}
g.__wsEvent = (id: number, kind: string, a?: any, b?: any) => {
  const ws = sockets.get(id);
  if (!ws) return;
  if (kind === "open") { ws.readyState = 1; ws.protocol = a ?? ""; ws.dispatchEvent(new EventPoly("open")); }
  else if (kind === "message") {
    const data = typeof a === "string" ? a : ws.binaryType === "arraybuffer" ? (a as Uint8Array).slice().buffer : new BlobPoly([a]);
    ws.dispatchEvent(new MessageEventPoly("message", { data }));
  } else if (kind === "close") ws._closed(a ?? 1006, b ?? "");
  else if (kind === "error") { ws.dispatchEvent(new EventPoly("error")); ws._closed(1006, String(a ?? "")); }
};
g.WebSocket = WebSocketPoly;

// ------------------------------------------------------------------ crypto

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
type Key = { type: "secret"; algorithm: { name: string; hash: { name: string } }; _raw: Uint8Array; extractable: boolean; usages: string[] };
g.crypto = {
  getRandomValues<T extends ArrayBufferView>(arr: T): T {
    const bytes = N.random(arr.byteLength);
    new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength).set(bytes);
    return arr;
  },
  randomUUID() {
    const b = N.random(16);
    b[6] = (b[6]! & 0x0f) | 0x40;
    b[8] = (b[8]! & 0x3f) | 0x80;
    const h = hex(b);
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  },
  subtle: {
    async digest(alg: string | { name: string }, data: BufferSource) {
      const name = typeof alg === "string" ? alg : alg.name;
      return N.digest(name, toBytes(data)).buffer;
    },
    async importKey(_format: string, raw: BufferSource, algorithm: any, extractable: boolean, usages: string[]): Promise<Key> {
      return { type: "secret", algorithm: { name: algorithm.name ?? algorithm, hash: typeof algorithm.hash === "string" ? { name: algorithm.hash } : algorithm.hash ?? { name: "SHA-256" } }, _raw: toBytes(raw).slice(), extractable, usages };
    },
    async sign(_alg: any, key: Key, data: BufferSource) { return N.hmac(key.algorithm.hash.name, key._raw, toBytes(data)).buffer; },
    async verify(_alg: any, key: Key, sig: BufferSource, data: BufferSource) {
      const a = N.hmac(key.algorithm.hash.name, key._raw, toBytes(data)), b = toBytes(sig);
      return a.length === b.length && a.every((x, i) => x === b[i]);
    },
    async exportKey(_f: string, key: Key) { return key._raw.slice().buffer; },
    async generateKey(): Promise<never> { throw new DOMExceptionPoly("generateKey is not supported on this device yet", "NotSupportedError"); },
    async encrypt(): Promise<never> { throw new DOMExceptionPoly("encrypt is not supported on this device yet", "NotSupportedError"); },
    async decrypt(): Promise<never> { throw new DOMExceptionPoly("decrypt is not supported on this device yet", "NotSupportedError"); },
  },
};

// ------------------------------------------------------------------ the rest

g.structuredClone ??= (v: unknown) => {
  const seen = new Map<unknown, unknown>();
  const clone = (x: any): any => {
    if (x === null || typeof x !== "object") return x;
    if (seen.has(x)) return seen.get(x);
    if (x instanceof Date) return new Date(x.getTime());
    if (x instanceof RegExp) return new RegExp(x.source, x.flags);
    if (ArrayBuffer.isView(x)) return (x as any).slice();
    if (x instanceof ArrayBuffer) return x.slice(0);
    if (x instanceof Map) { const m = new Map(); seen.set(x, m); x.forEach((v, k) => m.set(clone(k), clone(v))); return m; }
    if (x instanceof Set) { const s = new Set(); seen.set(x, s); x.forEach((v) => s.add(clone(v))); return s; }
    const out: any = Array.isArray(x) ? [] : {};
    seen.set(x, out);
    for (const k of Object.keys(x)) out[k] = clone(x[k]);
    return out;
  };
  return clone(v);
};

class MessagePortPoly extends EventTargetPoly {
  other: MessagePortPoly | null = null;
  onmessage: any = null;
  postMessage(data: unknown) { const o = this.other; if (o) setTimeout(() => o.dispatchEvent(new MessageEventPoly("message", { data })), 0); }
  start() {}
  close() { this.other = null; }
}
g.MessageChannel ??= class {
  port1 = new MessagePortPoly();
  port2 = new MessagePortPoly();
  constructor() { this.port1.other = this.port2; this.port2.other = this.port1; }
};
g.BroadcastChannel ??= class extends EventTargetPoly { constructor(readonly name: string) { super(); } postMessage() {} close() {} };
g.Worker ??= class { constructor() { throw new Error("Web Workers are not available on the phone yet"); } };

g.navigator = {
  userAgent: `Mozilla/5.0 (iPhone; CPU iPhone OS ${N.env.osVersion.replace(/\./g, "_")} like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) StellaRune/0.1 Mobile/15E148`,
  platform: N.env.platform === "ios" ? "iPhone" : "Linux armv8l",
  language: N.env.locale,
  languages: [N.env.locale],
  onLine: true,
  hardwareConcurrency: 6,
  maxTouchPoints: 5,
  vendor: "Apple Computer, Inc.",
  cookieEnabled: true,
  userAgentData: { platform: N.env.platform === "ios" ? "iOS" : "Android", mobile: true, brands: [] },
  clipboard: {
    async writeText(text: string) { N.post(JSON.stringify({ cmd: "clipboard.writeText", text })); },
    async readText() { return ""; },
  },
  share: async (data: { text?: string; url?: string; title?: string }) => { N.post(JSON.stringify({ cmd: "share", ...data })); },
  vibrate: () => { N.post(JSON.stringify({ cmd: "haptic", kind: "medium" })); return true; },
  sendBeacon: (url: string, body?: BodyInit) => { void g.fetch(url, { method: "POST", body }).catch(() => {}); return true; },
  mediaDevices: undefined,
  permissions: { query: async () => ({ state: "prompt", addEventListener() {}, removeEventListener() {} }) },
  serviceWorker: undefined,
  locks: undefined,
};

g.process ??= {
  platform: N.env.platform === "ios" ? "ios" : "android",
  // The bridge's frames go to fd 3, which the fs shim hands to the engine (fd 1 is the log).
  env: { NODE_ENV: "production", STELLA_RUNE_BRIDGE_OUT_FD: "3", ...N.env.env },
  versions: {},
  arch: "arm64",
  argv: [],
  cwd: () => "/",
  getuid: () => 501,
  pid: 1,
  nextTick: (fn: (...a: any[]) => void, ...args: any[]) => queueMicrotask(() => fn(...args)),
  on: () => {},
  off: () => {},
  once: () => {},
  emit: () => false,
  exit: () => {},
  memoryUsage: () => ({ rss: 0, heapUsed: 0, heapTotal: 0, external: 0 }),
  hrtime: Object.assign((prev?: [number, number]) => { const t = N.now() * 1e6; const s = Math.floor(t / 1e9), ns = Math.floor(t % 1e9); return prev ? [s - prev[0], ns - prev[1]] : [s, ns]; }, { bigint: () => BigInt(Math.floor(N.now() * 1e6)) }),
  stdout: { write: (s: string) => { N.log("log", String(s)); return true; } },
  stderr: { write: (s: string) => { N.log("log", String(s)); return true; } },
};

export {};
