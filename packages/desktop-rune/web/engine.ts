import type { engine as BridgeEngine, EngineEvent, MenuItem } from "../host/bridge";
import { registerAll } from "./dom/files";
import { popupMenu } from "./dom/menu";
import { elementOf } from "./dom/registry";
import { downloadPath } from "./downloads";

type Engine = typeof BridgeEngine;
type Listener = (e: any) => void;

const listeners = new Map<string, Set<Listener>>();

export function onEngineEvent(t: string, fn: Listener): () => void {
  let set = listeners.get(t);
  if (!set) listeners.set(t, (set = new Set()));
  set.add(fn);
  return () => set!.delete(fn);
}

export function emit(e: EngineEvent) {
  const set = listeners.get(e.t);
  if (!set) return;
  for (const fn of set) {
    try { fn(e); } catch (err) { console.error("[web] listener failed", err); }
  }
}

const unsupported = (what: string) => Promise.reject(new Error(`${what} is not available in the browser`));

/** The element a command targets: an input's own field, a webview's frame, or the element itself. */
function target(id: string): HTMLElement | undefined {
  const el = elementOf(id);
  if (!el) return undefined;
  if (el.dataset.input !== undefined) return el.querySelector<HTMLElement>(".f") ?? el;
  return el;
}

const fieldOf = (id: string) => target(id) as HTMLInputElement | HTMLTextAreaElement | undefined;
const mediaOf = (id: string) => elementOf(id) as HTMLMediaElement | undefined;
const frameOf = (id: string) => elementOf(id) as HTMLIFrameElement | undefined;

type Pinnable = HTMLElement & { __runePin?: () => void; __runeUnpin?: () => void };

function scrollerOf(id: string): Pinnable | undefined {
  const el = elementOf(id) as Pinnable | undefined;
  if (!el) return undefined;
  if (el.classList.contains("sy") || el.classList.contains("sx")) return el;
  return (el.closest(".sy") as Pinnable | null) ?? el;
}

function selectionNow(): { text: string; rect?: { x: number; y: number; w: number; h: number } } | null {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    const { selectionStart: s, selectionEnd: e } = active;
    if (s !== null && e !== null && e > s) return { text: active.value.slice(s, e) };
  }
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const text = sel.toString();
  if (!text) return null;
  const r = sel.getRangeAt(0).getBoundingClientRect();
  return { text, rect: { x: r.left, y: r.top, w: r.width, h: r.height } };
}

function pickFiles(o: { multi?: boolean; filters?: { extensions: string[] }[] }): Promise<string[] | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = !!o.multi;
    const exts = o.filters?.flatMap((f) => f.extensions).filter((e) => e !== "*") ?? [];
    if (exts.length) input.accept = exts.map((e) => `.${e.replace(/^\./, "")}`).join(",");
    input.style.display = "none";
    let settled = false;
    const done = (v: string[] | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(v);
    };
    input.onchange = () => done(input.files?.length ? registerAll(input.files) : null);
    input.addEventListener("cancel", () => done(null));
    document.body.appendChild(input);
    input.click();
  });
}

let colorMotionTimer: ReturnType<typeof setTimeout> | null = null;
const dark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

const requests: Record<string, (a: Record<string, any>) => unknown> = {
  "selection.get": () => selectionNow() ?? { text: "" },
  "selection.copy": async () => {
    const s = selectionNow();
    if (!s) return false;
    await navigator.clipboard.writeText(s.text);
    return true;
  },
  "selection.lookUp": () => false,
};

export const webEngine: Engine = {
  request: (<T>(cmd: string, args: Record<string, unknown> = {}) => {
    const fn = requests[cmd];
    return fn ? Promise.resolve(fn(args)) : unsupported(cmd);
  }) as Engine["request"],
  command: () => {},
  blob: () => 0,
  freeBlob: () => {},
  window: {
    focus: async () => window.focus(),
    show: async () => {},
    hide: async () => {},
    close: async () => {},
    minimize: async () => {},
    maximize: async () => {},
    unmaximize: async () => {},
    toggleMaximize: async () => {},
    setFullScreen: async (_id, on) => {
      if (on) await document.documentElement.requestFullscreen?.().catch(() => {});
      else if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
    },
    center: async () => {},
    setTitle: async (_id, title) => { document.title = title; },
    setAlwaysOnTop: async () => {},
    setBounds: async () => {},
    getBounds: async () => ({ x: window.screenX, y: window.screenY, width: window.innerWidth, height: window.innerHeight, scaleFactor: window.devicePixelRatio, maximized: false, minimized: document.hidden, fullScreen: !!document.fullscreenElement }),
    isMaximized: async () => false,
    isFocused: async () => document.hasFocus(),
  },
  clipboard: {
    read: async () => ({ text: await navigator.clipboard.readText().catch(() => ""), html: null, files: [], image: null, formats: ["text/plain"] }),
    readText: () => navigator.clipboard.readText().catch(() => ""),
    readHTML: async () => "",
    readFiles: async () => [],
    availableFormats: async () => ["text/plain"],
    readImage: async () => null,
    writeText: (text) => navigator.clipboard.writeText(text),
    writeHTML: (html, text = "") => {
      if (typeof ClipboardItem === "undefined") return navigator.clipboard.writeText(text);
      return navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) })]);
    },
    writeImage: async (png) => {
      if (typeof ClipboardItem === "undefined") return;
      await navigator.clipboard.write([new ClipboardItem({ "image/png": new Blob([png as BlobPart], { type: "image/png" }) })]);
    },
  },
  dialog: {
    openFile: (o = {}) => pickFiles(o),
    openFolder: async () => null,
    saveFile: async (o = {}) => downloadPath(o.defaultPath),
  },
  notify: async (n) => {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const note = new Notification(n.title, { body: n.body, silent: n.silent, tag: n.id });
    note.onclick = () => {
      window.focus();
      emit({ t: "notification", id: n.id, action: "click" });
    };
  },
  app: { setBadge: async () => false },
  menu: {
    popup: (items: MenuItem[], at) => popupMenu(items, at),
    setApplicationMenu: async () => {},
  },
  tray: {
    create: async (t) => t.id ?? "web-tray",
    setMenu: async () => {},
    setTooltip: async () => {},
    setIcon: async () => {},
    destroy: async () => {},
  },
  shortcut: { register: async () => false, unregister: async () => {}, unregisterAll: async () => {} },
  screen: {
    displays: async () => [screenDisplay()],
    primary: async () => screenDisplay(),
    cursorPoint: () => unsupported("screen.cursorPoint"),
  },
  appearance: { get: async () => ({ dark: dark() }) },
  capture: { sources: async () => [], start: () => unsupported("capture"), stop: () => unsupported("capture") },
  audio: { play: () => unsupported("audio"), control: () => unsupported("audio"), devices: async () => [] },
  inputHook: { start: () => unsupported("inputhook"), stop: async () => ({ stopped: true }) },
  shell: {
    openExternal: async (url) => { window.open(url, "_blank", "noopener,noreferrer"); },
    openPath: async () => "Opening files isn't available in the browser",
    showItemInFolder: async () => {},
  },
  fonts: async (f) => {
    const root = document.documentElement.style;
    if (f.sans) root.setProperty("--rune-sans", `"${f.sans}", "Manrope Fallback", system-ui, -apple-system, sans-serif`);
    if (f.mono) root.setProperty("--rune-mono", `"${f.mono}", ui-monospace, SFMono-Regular, Menlo, monospace`);
    return { loaded: 0, errors: [] };
  },
  background: async (color) => {
    document.documentElement.style.backgroundColor = color;
    document.body.style.backgroundColor = color;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = color;
  },
  colorMotion: async (dur) => {
    const root = document.documentElement;
    if (colorMotionTimer) clearTimeout(colorMotionTimer);
    if (dur <= 0) {
      root.classList.remove("rune-color-motion");
      return;
    }
    root.style.setProperty("--rcm", `${dur}s`);
    root.classList.add("rune-color-motion");
    colorMotionTimer = setTimeout(() => root.classList.remove("rune-color-motion"), dur * 1000 + 100);
  },
  scroll: {
    to: async (id, y, o = {}) => {
      const el = scrollerOf(id);
      if (!el) return;
      const top = y === "end" ? el.scrollHeight : y;
      if (y === "end") el.__runePin?.();
      else el.__runeUnpin?.();
      el.scrollTo({ top, left: o.x, behavior: o.animate ? "smooth" : "instant" });
    },
    intoView: async (id) => { elementOf(id)?.scrollIntoView({ block: "nearest", inline: "nearest" }); },
    page: async (id, pages) => {
      const el = scrollerOf(id);
      if (el) el.scrollBy({ top: pages * el.clientHeight * 0.9, behavior: "smooth" });
    },
    stop: async (id) => {
      const el = scrollerOf(id);
      if (el) el.scrollTo({ top: el.scrollTop, behavior: "instant" });
    },
    toKey: async (id, key, at = 0) => {
      const el = scrollerOf(id);
      const row = elementOf(key.split("/")[0]!);
      if (!el || !row) return;
      el.__runeUnpin?.();
      el.scrollTop += row.getBoundingClientRect().top - el.getBoundingClientRect().top - at;
    },
    keepOnScreen: async () => {},
  },
  selection: {
    get: async () => selectionNow(),
    copy: async () => {
      const s = selectionNow();
      if (!s) return false;
      await navigator.clipboard.writeText(s.text);
      return true;
    },
    lookUp: async () => false,
  },
  focus: async (id) => { target(id)?.focus({ preventScroll: false }); },
  blur: async () => { (document.activeElement as HTMLElement | null)?.blur?.(); },
  input: {
    get: async (id) => {
      const f = fieldOf(id);
      return { value: f?.value ?? "", start: f?.selectionStart ?? 0, end: f?.selectionEnd ?? 0 };
    },
    set: async (id, value, sel) => {
      const f = fieldOf(id);
      if (!f) return;
      f.value = value;
      f.dispatchEvent(new Event("input", { bubbles: true }));
      if (sel) f.setSelectionRange(sel.start, sel.end);
    },
    select: async (id, start, end) => { fieldOf(id)?.setSelectionRange(start, end); },
  },
  media: {
    play: async (id) => { await mediaOf(id)?.play(); },
    pause: async (id) => { mediaOf(id)?.pause(); },
    seek: async (id, time) => {
      const m = mediaOf(id);
      if (m) m.currentTime = time;
    },
    state: async (id) => {
      const m = mediaOf(id);
      return { time: m?.currentTime ?? 0, duration: m && Number.isFinite(m.duration) ? m.duration : null, playing: !!m && !m.paused };
    },
  },
  webview: {
    post: async (id, data, origin) => { frameOf(id)?.contentWindow?.postMessage(data, origin ?? "*"); },
    eval: () => unsupported("webview.eval"),
    load: async (id, url) => {
      const f = frameOf(id);
      if (f) f.src = url;
    },
    loadHtml: async (id, html) => {
      const f = frameOf(id);
      if (f) f.srcdoc = html;
    },
    reload: async (id) => { frameOf(id)?.contentWindow?.location.reload(); },
    back: async (id) => { frameOf(id)?.contentWindow?.history.back(); },
    forward: async (id) => { frameOf(id)?.contentWindow?.history.forward(); },
    focus: async (id) => { frameOf(id)?.focus(); },
    blur: async (id) => { frameOf(id)?.blur(); },
    zoom: async () => {},
    url: async (id) => {
      const f = frameOf(id);
      try { return f?.contentWindow?.location.href ?? f?.src ?? null; } catch { return f?.src ?? null; }
    },
    state: async (id) => {
      const f = frameOf(id);
      const r = f?.getBoundingClientRect();
      return { rect: r ? [r.left, r.top, r.width, r.height] : [], shown: !!f, covered: false, covering: [], fits: true, clip: null };
    },
    respond: async () => {},
  },
  control: {
    input: () => unsupported("control.input"),
    elements: async () => [],
    screenshot: () => unsupported("control.screenshot"),
    record: () => unsupported("control.record"),
  },
  quit: () => {},
};

function screenDisplay() {
  const s = window.screen;
  const bounds = { x: 0, y: 0, width: s.width, height: s.height };
  return { id: 1, primary: true, scaleFactor: window.devicePixelRatio, bounds, workArea: { ...bounds, width: s.availWidth, height: s.availHeight } };
}

let selectionTimer: ReturnType<typeof setTimeout> | null = null;
let hadSelection = false;

/** `selection` events: once a selection settles (pointer or keys released), or when it clears. */
export function startSelectionEvents() {
  const settle = () => {
    if (selectionTimer) clearTimeout(selectionTimer);
    selectionTimer = setTimeout(() => {
      const s = selectionNow();
      if (s?.rect) {
        hadSelection = true;
        emit({ t: "selection", window: "main", n: 0, text: s.text, rect: s.rect });
      } else if (hadSelection) {
        hadSelection = false;
        emit({ t: "selection", window: "main", n: 0, cleared: true });
      }
    }, 60);
  };
  document.addEventListener("pointerup", settle, true);
  document.addEventListener("keyup", settle, true);
  document.addEventListener("selectionchange", () => {
    if (hadSelection && !selectionNow()) settle();
  });
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (e) => emit({ t: "appearance", dark: e.matches }));
}
