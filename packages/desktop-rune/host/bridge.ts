// The TS side of the bridge to the Rune engine. Host → engine: length-prefixed binary frames
// (one React commit = one frame) on STELLA_RUNE_BRIDGE_OUT_FD. Engine → host: JSON lines on
// STELLA_RUNE_BRIDGE_IN_FD. Protocol and element reference: host/ELEMENTS.md.

import { writeSync } from "node:fs";

export const now = () => performance.timeOrigin + performance.now();

const OP = { CREATE: 1, PROPS: 2, APPEND: 4, INSERT: 5, REMOVE: 6, COMMIT: 9, CMD: 10, BLOB: 11, FREE_BLOB: 12 } as const;

const enc = new TextEncoder();
let buf = new Uint8Array(1 << 16);
let view = new DataView(buf.buffer);
let len = 4;

function ensure(n: number) {
  if (len + n <= buf.length) return;
  let size = buf.length * 2;
  while (size < len + n) size *= 2;
  const next = new Uint8Array(size);
  next.set(buf.subarray(0, len));
  buf = next;
  view = new DataView(buf.buffer);
}
const u8 = (v: number) => { ensure(1); buf[len++] = v; };
const u32 = (v: number) => { ensure(4); view.setUint32(len, v, true); len += 4; };
const f64 = (v: number) => { ensure(8); view.setFloat64(len, v, true); len += 8; };
function bytes(b: Uint8Array) { ensure(b.length); buf.set(b, len); len += b.length; }

export const stats = { frames: 0, bytes: 0, ops: 0 };

export const ops = {
  create(id: number, type: string) { const t = enc.encode(type); u8(OP.CREATE); u32(id); u8(t.length); bytes(t); stats.ops++; },
  props(id: number, json: string) { const j = enc.encode(json); u8(OP.PROPS); u32(id); u32(j.length); bytes(j); stats.ops++; },
  append(parent: number, child: number) { u8(OP.APPEND); u32(parent); u32(child); stats.ops++; },
  insert(parent: number, child: number, before: number) { u8(OP.INSERT); u32(parent); u32(child); u32(before); stats.ops++; },
  remove(parent: number, child: number) { u8(OP.REMOVE); u32(parent); u32(child); stats.ops++; },
  cmd(v: unknown) { const j = enc.encode(JSON.stringify(v)); u8(OP.CMD); u32(j.length); bytes(j); stats.ops++; },
  blob(id: number, data: Uint8Array) { u8(OP.BLOB); u32(id); u32(data.length); bytes(data); stats.ops++; },
  freeBlob(id: number) { u8(OP.FREE_BLOB); u32(id); stats.ops++; },
};

/** What the next commit answers: which engine event (ack), when the work started (t0), and kind (1 = hot swap). */
export const commitCtx = { ack: 0, t0: 0, kind: 0 };
let generation = 0;

let outFd = -1;
function fdOut(): number {
  if (outFd < 0) outFd = Number(process.env.STELLA_RUNE_BRIDGE_OUT_FD ?? 1);
  return outFd;
}

function write(frame: Uint8Array) {
  const fd = fdOut();
  let off = 0;
  while (off < frame.length) off += writeSync(fd, frame, off, frame.length - off);
}

/** Seals the pending ops as one frame and writes it. */
export function flushFrame(commit = true) {
  if (commit) {
    u8(OP.COMMIT); u32(++generation); u32(commitCtx.ack); f64(commitCtx.t0 || now()); u8(commitCtx.kind);
    commitCtx.ack = 0; commitCtx.t0 = 0; commitCtx.kind = 0;
  }
  if (len === 4) return;
  view.setUint32(0, len - 4, true);
  write(buf.subarray(0, len));
  stats.frames++; stats.bytes += len;
  len = 4;
}

/** Sends an imperative command right away, outside a commit. */
export function command(v: Record<string, unknown>) {
  ops.cmd(v);
  flushFrame(false);
}

let nextRid = 1;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

/** Sends a command and resolves with the engine's reply. */
export function request<T = void>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const rid = nextRid++;
  return new Promise<T>((resolve, reject) => {
    pending.set(rid, { resolve, reject });
    command({ ...args, cmd, rid });
  });
}

let nextBlob = 1;
/** Hands bytes (an image, a PNG, a response body) to the engine; refer to them as `blob:<id>`. */
export function blob(data: Uint8Array): number {
  const id = nextBlob++;
  ops.blob(id, data);
  flushFrame(false);
  return id;
}
export function freeBlob(id: number) { ops.freeBlob(id); flushFrame(false); }

// ---------------------------------------------------------------- events

export type Mods = { mod: boolean; shift: boolean; alt: boolean; ctrl: boolean; meta: boolean };
export type Rect = { x: number; y: number; width: number; height: number };
export type Display = { id: number; label?: string; primary: boolean; scaleFactor: number; bounds: Rect; workArea: Rect };

/** An element event, delivered to the element's `on*` prop by the reconciler. */
export type ElementEvent = { t: "ev"; n: number; e: string; seq: number; at: number; input?: number; [k: string]: unknown };

export type WindowEventKind =
  | "close-requested" | "closed" | "focus" | "blur" | "resize" | "maximize" | "unmaximize"
  | "enter-full-screen" | "leave-full-screen";

export type EngineEvent =
  | ElementEvent
  | { t: "reply"; rid: number; ok: boolean; value?: unknown; error?: string }
  | { t: "window"; id: string | null; n: number; kind: WindowEventKind; w?: number; h?: number }
  | { t: "menu"; id: string }
  | { t: "tray"; id: string; kind: "click" | "menu"; item?: string }
  | { t: "shortcut"; accelerator: string; accel: string }
  | { t: "notification"; id: string | null; action: string; reply?: string | null }
  | { t: "appearance"; dark: boolean; accentColor?: string }
  /** A link the system opened with the app (macOS Apple Event; Windows/Linux the launch's own `stella://` arguments). Later launches' links come through the host's single-instance lock. */
  | { t: "open-url"; url: string }
  | { t: "rec"; result: unknown };

type EventOf<T extends EngineEvent["t"]> = Extract<EngineEvent, { t: T }>;
const listeners = new Map<string, Set<(e: any) => void>>();

/** Subscribes to engine events of one type; returns an unsubscribe function. */
export function onEngineEvent<T extends EngineEvent["t"]>(t: T, fn: (e: EventOf<T>) => void): () => void {
  let set = listeners.get(t);
  if (!set) listeners.set(t, (set = new Set()));
  set.add(fn);
  return () => set!.delete(fn);
}

let elementDispatch: (e: ElementEvent) => void = () => {};
/** The reconciler routes element events to `on*` props. */
export function setElementDispatch(fn: (e: ElementEvent) => void) { elementDispatch = fn; }

function dispatch(e: EngineEvent) {
  if (e.t === "reply") {
    const p = pending.get(e.rid);
    if (!p) return;
    pending.delete(e.rid);
    if (e.ok) p.resolve(e.value); else p.reject(new Error(e.error ?? "engine command failed"));
    return;
  }
  if (e.t === "ev") elementDispatch(e);
  const set = listeners.get(e.t);
  if (set) for (const fn of set) { try { fn(e); } catch (err) { console.error("[bridge] listener failed", err); } }
}

/** Reads engine events until the engine closes the pipe, then exits. */
export async function listen(extra?: (e: EngineEvent) => void) {
  const inFd = Number(process.env.STELLA_RUNE_BRIDGE_IN_FD ?? 0);
  const stream = inFd === 0 ? Bun.stdin.stream() : Bun.file(inFd).stream();
  const dec = new TextDecoder();
  let rest = "";
  for await (const chunk of stream) {
    rest += dec.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = rest.indexOf("\n")) >= 0) {
      const line = rest.slice(0, nl);
      rest = rest.slice(nl + 1);
      if (!line) continue;
      let e: EngineEvent;
      try { e = JSON.parse(line); } catch (err) { console.error("[bridge] bad event", line, err); continue; }
      dispatch(e);
      extra?.(e);
    }
  }
  process.exit(0);
}

// ---------------------------------------------------------------- typed engine API

export type MenuItem = {
  id?: string; label?: string; type?: "normal" | "separator" | "checkbox" | "radio" | "submenu";
  enabled?: boolean; checked?: boolean; visible?: boolean; accelerator?: string; role?: string; submenu?: MenuItem[];
};
export type FileFilter = { name: string; extensions: string[] };
export type DialogOptions = { title?: string; defaultPath?: string; filters?: FileFilter[]; window?: string };
export type ClipboardRead = { text: string; html: string | null; files: string[]; image: string | null; formats: string[] };
export type WindowBounds = { x: number; y: number; width: number; height: number; scaleFactor: number; maximized: boolean; minimized: boolean; fullScreen: boolean };
export type ElementInfo = { key: string | null; path: string; role: string; label: string | null; text: string | null; rect: [number, number, number, number]; opacity: number; focused: boolean; focusable: boolean; inert: boolean; exiting: boolean; fill: string; textColor: string | null };
/** A Rune script event (`--script` format): move/down/up/tap/double-click/drag/scroll/wheel/key/type/paste/ime/drop_files… */
export type InputEvent = Record<string, unknown> & { type?: string; t?: number };

const win = <T = void>(id: string, cmd: string, args: Record<string, unknown> = {}) => request<T>(`window.${cmd}`, { ...args, window: id });

export const engine = {
  request, command, blob, freeBlob,
  window: {
    focus: (id: string) => win(id, "focus"),
    show: (id: string) => win(id, "show"),
    hide: (id: string) => win(id, "hide"),
    close: (id: string) => win(id, "close"),
    minimize: (id: string) => win(id, "minimize"),
    maximize: (id: string) => win(id, "maximize"),
    unmaximize: (id: string) => win(id, "unmaximize"),
    toggleMaximize: (id: string) => win(id, "toggleMaximize"),
    setFullScreen: (id: string, on: boolean) => win(id, "setFullScreen", { on }),
    center: (id: string) => win(id, "center"),
    setTitle: (id: string, title: string) => win(id, "setTitle", { title }),
    setAlwaysOnTop: (id: string, on: boolean) => win(id, "setAlwaysOnTop", { on }),
    setBounds: (id: string, b: Partial<Rect>) => win(id, "setBounds", b),
    getBounds: (id: string) => win<WindowBounds>(id, "getBounds"),
    isMaximized: async (id: string) => (await win<WindowBounds>(id, "getBounds")).maximized,
    isFocused: (id: string) => request<boolean>("window.isFocused", { window: id }),
  },
  clipboard: {
    read: (window?: string) => request<ClipboardRead>("clipboard.read", { window }),
    readText: async () => (await request<ClipboardRead>("clipboard.read")).text,
    readHTML: async () => (await request<ClipboardRead>("clipboard.read")).html ?? "",
    readFiles: async () => (await request<ClipboardRead>("clipboard.read")).files,
    /** MIME types on the clipboard: text/plain, text/html, text/uri-list (files), image/png. */
    availableFormats: async () => (await request<ClipboardRead>("clipboard.read")).formats,
    /** The clipboard image as PNG bytes, or null. */
    readImage: async (): Promise<Uint8Array | null> => {
      const { image } = await request<ClipboardRead>("clipboard.read");
      return image ? new Uint8Array(await Bun.file(image).arrayBuffer()) : null;
    },
    writeText: (text: string) => request("clipboard.writeText", { text }),
    writeHTML: (html: string, text = "") => request("clipboard.writeHTML", { html, text }),
    writeImage: (png: Uint8Array) => { const id = blob(png); return request("clipboard.writeImage", { blob: id }).finally(() => freeBlob(id)); },
  },
  dialog: {
    openFile: (o: DialogOptions & { multi?: boolean; directory?: boolean } = {}) => request<string[] | null>("dialog.openFile", o),
    openFolder: (o: DialogOptions = {}) => request<string[] | null>("dialog.openFolder", o),
    saveFile: (o: DialogOptions = {}) => request<string | null>("dialog.saveFile", o),
  },
  notify: (n: { id: string; title: string; body?: string; icon?: string; silent?: boolean; actions?: { id: string; label: string }[] }) => request("notify", n),
  menu: {
    /** A native pop-up menu at a window point, or under an element (`anchor` = its `id`). Resolves with the picked id. */
    popup: (items: MenuItem[], at: { window?: string; x?: number; y?: number; anchor?: string }) =>
      request<string | null>("menu.popup", { items, window: at.window, x: at.x, y: at.y, target: at.anchor }),
    /** The macOS menu bar from an Electron-style template (top-level submenus; `role: "appMenu"` is the app menu). Picks arrive as `menu` events. A no-op off macOS. */
    setApplicationMenu: (items: MenuItem[] | null) => request("menu.setApplicationMenu", { items: items ?? [] }),
  },
  tray: {
    /** Resolves with the tray's id (`id`, or a generated one). `icon` is a PNG path or PNG bytes. */
    create: (t: { id?: string; title?: string; icon: string | Uint8Array; tooltip?: string; template?: boolean; menu?: MenuItem[] | null }) => {
      const b = typeof t.icon === "string" ? undefined : blob(t.icon);
      const p = request<string>("tray.create", { ...t, menu: t.menu ?? [], icon: typeof t.icon === "string" ? t.icon : undefined, blob: b });
      return b ? p.finally(() => freeBlob(b)) : p;
    },
    setMenu: (id: string, menu: MenuItem[] | null) => request("tray.setMenu", { id, menu: menu ?? [] }),
    setTooltip: (id: string, tooltip: string) => request("tray.setTooltip", { id, tooltip }),
    setIcon: (id: string, icon: string | Uint8Array) => {
      const b = typeof icon === "string" ? undefined : blob(icon);
      const p = request("tray.setIcon", { id, icon: typeof icon === "string" ? icon : undefined, blob: b });
      return b ? p.finally(() => freeBlob(b)) : p;
    },
    destroy: (id: string) => request("tray.destroy", { id }),
  },
  shortcut: {
    register: (accelerator: string) => request<boolean>("shortcut.register", { accelerator }),
    unregister: (accelerator: string) => request("shortcut.unregister", { accelerator }),
    unregisterAll: () => request("shortcut.unregisterAll"),
  },
  screen: {
    displays: () => request<Display[]>("screen.displays"),
    /** The primary display (the first one when none says primary). */
    primary: async () => {
      const all = await request<Display[]>("screen.displays");
      const d = all.find((x) => x.primary) ?? all[0];
      if (!d) throw new Error("no displays");
      return d;
    },
    /** Rejects: Rune reports the pointer only inside its own windows. */
    cursorPoint: () => request<{ x: number; y: number }>("screen.cursorPoint"),
  },
  appearance: { get: () => request<{ dark: boolean; accentColor?: string }>("appearance.get") },
  shell: {
    openExternal: (url: string) => request("shell.openExternal", { url }),
    /** Resolves "" on success, else the error (Electron's contract). */
    openPath: (path: string) => request("shell.openPath", { path }).then(() => "", (e: Error) => e.message),
    showItemInFolder: (path: string) => request("shell.showItemInFolder", { path }),
  },
  fonts: (f: { files: string[]; sans?: string; mono?: string }) => request<{ loaded: number; errors: string[] }>("fonts", f),
  /** Overrides a window's background (default: the first window). */
  background: (color: string, window?: string) => request("bg", { color, window }),
  /** Makes the next commits' colour changes spring over `dur` seconds (theme switches); 0 turns it off. */
  colorMotion: (dur: number) => request("colorMotion", { dur }),
  scroll: {
    to: (target: string, y: number | "end", o: { x?: number; animate?: boolean; spring?: number } = {}) => request("scrollTo", { target, y, ...o }),
    intoView: (target: string) => request("scrollIntoView", { target }),
    page: (target: string, pages: number) => request("scrollPage", { target, pages }),
    stop: (target: string) => request("stopScroll", { target }),
    /** Lands the element keyed `key` (`"row/mark"` for a mark inside a row, mounted or not) `at` points below the top of `target`'s viewport. Instant. */
    toKey: (target: string, key: string, at = 0) => request("scrollKeyTo", { target, key, at }),
    /** Holds `key` where it shows on screen across the next commit (a header that collapses its section). */
    keepOnScreen: (key: string) => request("keepOnScreen", { target: key, key }),
  },
  selection: {
    /** The text selected in a window (its `selectionGroup` or selectable texts), as copying takes it; null when nothing is. */
    get: (window?: string) => request<{ text: string } | null>("selection.get", { window }),
    /** Copies the window's selection; false when nothing is selected. */
    copy: async (window?: string) => {
      const s = await request<{ text: string } | null>("selection.get", { window });
      if (!s) return false;
      await request("clipboard.writeText", { text: s.text, window });
      return true;
    },
    /** macOS dictionary look-up of the selection; false where the platform has none (it isn't wired on macOS yet either). */
    lookUp: (window?: string) => request<boolean>("selection.lookUp", { window }),
  },
  focus: (target: string, ring = false) => request("focus", { target, ring }),
  blur: (window?: string) => request("blur", { window }),
  input: {
    get: (target: string) => request<{ value: string; start: number; end: number }>("input.get", { target }),
    set: (target: string, value: string, sel?: { start: number; end: number }) => request("input.set", { target, value, ...sel }),
    select: (target: string, start: number, end: number) => request("input.select", { target, start, end }),
  },
  media: {
    play: (target: string) => request("media.play", { target }),
    pause: (target: string) => request("media.pause", { target }),
    seek: (target: string, time: number) => request("media.seek", { target, time }),
    state: (target: string) => request<{ time: number; duration: number | null; playing: boolean }>("media.state", { target }),
  },
  webview: {
    post: (target: string, data: unknown, origin?: string) => request("webview.post", { target, data, origin }),
    eval: (target: string, js: string) => request("webview.eval", { target, js }),
    load: (target: string, url: string) => request("webview.load", { target, url }),
    loadHtml: (target: string, html: string) => request("webview.loadHtml", { target, html }),
    reload: (target: string) => request("webview.reload", { target }),
    back: (target: string) => request("webview.back", { target }),
    forward: (target: string) => request("webview.forward", { target }),
    focus: (target: string) => request("webview.focus", { target }),
    blur: (target: string) => request("webview.blur", { target }),
    zoom: (target: string, factor: number) => request("webview.zoom", { target, factor }),
    url: (target: string) => request<string | null>("webview.url", { target }),
    /** Answers a custom-scheme `request` event. */
    respond: (rid: number, r: { status?: number; headers?: Record<string, string>; body?: string | Uint8Array }) => {
      const b = r.body instanceof Uint8Array ? blob(r.body) : undefined;
      const p = request("webview.respond", { req: rid, status: r.status, headers: r.headers, body: typeof r.body === "string" ? r.body : undefined, blob: b });
      return b ? p.finally(() => freeBlob(b)) : p;
    },
  },
  control: {
    /** Replays real input in a window through Rune's input paths (Rune script events). */
    input: (events: InputEvent[], window?: string) => request("control.input", { events, window }),
    /** Every element Rune drew in a window: keys, roles, labels, text, rects, focus. */
    elements: (window?: string, key?: string) => request<ElementInfo[]>("control.elements", { window, key }),
  },
  quit: () => command({ cmd: "quit" }),
};
