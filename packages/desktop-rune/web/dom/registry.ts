import type { Mods } from "../../host/bridge";
import type { Layout } from "../../host/rune-jsx/props";

const byId = new Map<string, HTMLElement>();
const waiters = new Map<string, Set<(el: HTMLElement) => void>>();

export function register(id: string, el: HTMLElement) {
  byId.set(id, el);
  el.dataset.rid = id;
  const waiting = waiters.get(id);
  if (waiting) {
    waiters.delete(id);
    for (const w of waiting) w(el);
  }
}

export function unregister(id: string, el: HTMLElement) {
  if (byId.get(id) === el) byId.delete(id);
}

export const elementOf = (id: string): HTMLElement | undefined => {
  const el = byId.get(id);
  return el?.isConnected ? el : undefined;
};

/** Calls `fn` with the element once it is registered (now or on a later commit). */
export function whenElement(id: string, fn: (el: HTMLElement) => void): () => void {
  const now = elementOf(id);
  if (now) {
    fn(now);
    return () => {};
  }
  const set = waiters.get(id) ?? new Set();
  set.add(fn);
  waiters.set(id, set);
  return () => set.delete(fn);
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export const modsOf = (e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): Mods => ({
  mod: isMac ? e.metaKey : e.ctrlKey,
  shift: e.shiftKey,
  alt: e.altKey,
  ctrl: isMac ? e.ctrlKey : false,
  meta: e.metaKey,
});

type Chord = { mods: [boolean, boolean, boolean, boolean]; key: string };

const NORMAL: Record<string, string> = { return: "enter", esc: "escape", up: "arrowup", down: "arrowdown", left: "arrowleft", right: "arrowright", space: " ", spacebar: " ", del: "delete" };
const normalize = (k: string) => NORMAL[k] ?? k;

function parse(s: string): Chord | null {
  const mods: Chord["mods"] = [false, false, false, false];
  let key: string | null = null;
  const parts = s.split("+");
  parts.forEach((part, i) => {
    const lower = part.trim().toLowerCase();
    const last = i === parts.length - 1;
    if (!last && ["mod", "cmdorctrl", "commandorcontrol", "cmd", "command", "meta", "super"].includes(lower)) mods[0] = true;
    else if (!last && lower === "shift") mods[1] = true;
    else if (!last && (lower === "alt" || lower === "option")) mods[2] = true;
    else if (!last && (lower === "ctrl" || lower === "control")) mods[3] = true;
    else if (last && lower === "") key = "+";
    else key = normalize(lower);
  });
  return key === null ? null : { mods, key };
}

const parsed = new Map<string, Chord | null>();

/** The chord in `chords` the key event matches (engine/src/keys.rs semantics), if any. */
export function matchChord(chords: readonly string[] | undefined, e: KeyboardEvent): string | null {
  if (!chords?.length || e.isComposing || e.key === "Process" || e.keyCode === 229) return null;
  const m = modsOf(e);
  const key = normalize(e.key.toLowerCase());
  for (const c of chords) {
    let want = parsed.get(c);
    if (want === undefined) {
      want = parse(c);
      parsed.set(c, want);
    }
    if (!want) continue;
    if (want.key === key && want.mods[0] === m.mod && want.mods[1] === m.shift && want.mods[2] === m.alt && want.mods[3] === m.ctrl) return c;
  }
  return null;
}

let keyboardModality = false;
if (typeof window !== "undefined") {
  window.addEventListener("keydown", (e) => { if (!e.metaKey && !e.ctrlKey) keyboardModality = true; }, true);
  window.addEventListener("pointerdown", () => { keyboardModality = false; }, true);
}
export const focusIsKeyboard = () => keyboardModality;

type LayoutWatch = { el: HTMLElement; fn: (r: Layout) => void; last: string };
const layouts = new Set<LayoutWatch>();
let scheduled = false;
let observer: ResizeObserver | null = null;

function flushLayouts() {
  scheduled = false;
  for (const w of layouts) {
    if (!w.el.isConnected) continue;
    const r = w.el.getBoundingClientRect();
    const key = `${r.left}|${r.top}|${r.width}|${r.height}`;
    if (key === w.last) continue;
    w.last = key;
    w.fn({ x: r.left, y: r.top, w: r.width, h: r.height });
  }
}

export function scheduleLayout() {
  if (scheduled || layouts.size === 0) return;
  scheduled = true;
  requestAnimationFrame(flushLayouts);
}

/** `onLayout`: the element's window rect after every frame its layout changed in. */
export function watchLayout(el: HTMLElement, fn: (r: Layout) => void): { update(fn: (r: Layout) => void): void; stop(): void } {
  observer ??= new ResizeObserver(() => scheduleLayout());
  const w: LayoutWatch = { el, fn, last: "" };
  layouts.add(w);
  observer.observe(el);
  scheduleLayout();
  return {
    update(next) { w.fn = next; },
    stop() {
      layouts.delete(w);
      observer?.unobserve(el);
    },
  };
}

if (typeof window !== "undefined") {
  window.addEventListener("resize", scheduleLayout);
  window.addEventListener("scroll", scheduleLayout, true);
}
