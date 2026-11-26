import type { BoxProps, Side } from "../../host/rune-jsx/props";
import { elementOf, whenElement } from "./registry";

let topLayer: HTMLElement | null = null;

/** The window's top layer: fixed and anchored elements paint here, above the app, as in Rune. */
export function topLayerRoot(): HTMLElement {
  if (topLayer?.isConnected) return topLayer;
  topLayer = document.createElement("div");
  topLayer.dataset.runeTop = "";
  topLayer.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:1000;display:block;";
  document.body.appendChild(topLayer);
  return topLayer;
}

type Anchor = NonNullable<BoxProps["anchor"]>;

const VIEWPORT_MARGIN = 8;

/** Places `el` (position:fixed) against the anchor's rect: Rune's anchored layer, flipped and clamped to stay on screen. */
export function placeAnchored(el: HTMLElement, anchor: Anchor) {
  const target = elementOf(anchor.to);
  if (!target) {
    el.style.visibility = "hidden";
    return;
  }
  el.style.visibility = "";
  const a = target.getBoundingClientRect();
  const gap = anchor.gap ?? 4;
  let side: Side = anchor.side ?? "bottom";
  const align = anchor.align ?? "start";
  if (anchor.fit && (side === "top" || side === "bottom")) el.style.minWidth = `${a.width}px`;
  if (anchor.fit && (side === "left" || side === "right")) el.style.minHeight = `${a.height}px`;
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const room = { top: a.top - gap, bottom: vh - a.bottom - gap, left: a.left - gap, right: vw - a.right - gap };
  const need = side === "top" || side === "bottom" ? r.height : r.width;
  const opposite: Record<Side, Side> = { top: "bottom", bottom: "top", left: "right", right: "left" };
  if (room[side] < need && room[opposite[side]] > room[side]) side = opposite[side];
  let x: number;
  let y: number;
  if (side === "top" || side === "bottom") {
    y = side === "bottom" ? a.bottom + gap : a.top - gap - r.height;
    x = align === "start" ? a.left : align === "end" ? a.right - r.width : a.left + (a.width - r.width) / 2;
    if (document.documentElement.dir === "rtl" || target.closest("[dir=rtl]")) {
      if (align === "start") x = a.right - r.width;
      else if (align === "end") x = a.left;
    }
  } else {
    x = side === "right" ? a.right + gap : a.left - gap - r.width;
    y = align === "start" ? a.top : align === "end" ? a.bottom - r.height : a.top + (a.height - r.height) / 2;
  }
  x = Math.max(VIEWPORT_MARGIN, Math.min(x, vw - r.width - VIEWPORT_MARGIN));
  y = Math.max(VIEWPORT_MARGIN, Math.min(y, vh - r.height - VIEWPORT_MARGIN));
  if (side === "bottom" || side === "top") el.style.maxHeight = el.style.maxHeight || `${Math.max(120, (side === "bottom" ? vh - y : a.top - gap) - VIEWPORT_MARGIN)}px`;
  el.style.left = `${Math.round(x)}px`;
  el.style.top = `${Math.round(y)}px`;
  el.dataset.side = side;
}

/** Keeps an anchored element placed while its anchor, itself or the viewport move. */
export function trackAnchor(el: HTMLElement, get: () => Anchor): () => void {
  let frame = 0;
  const place = () => {
    frame = 0;
    if (el.isConnected) placeAnchored(el, get());
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(place); };
  place();
  const ro = new ResizeObserver(schedule);
  ro.observe(el);
  let stopWait = whenElement(get().to, (t) => { ro.observe(t); schedule(); });
  window.addEventListener("resize", schedule);
  window.addEventListener("scroll", schedule, true);
  const interval = setInterval(schedule, 250);
  return () => {
    cancelAnimationFrame(frame);
    ro.disconnect();
    stopWait();
    stopWait = () => {};
    clearInterval(interval);
    window.removeEventListener("resize", schedule);
    window.removeEventListener("scroll", schedule, true);
  };
}

type ModalEntry = { el: HTMLElement; get: () => { modal: NonNullable<BoxProps["modal"]>; onDismiss?: () => void }; restore: Element | null };
const modals: ModalEntry[] = [];

const topModal = () => modals[modals.length - 1];

function onKeyDown(e: KeyboardEvent) {
  const top = topModal();
  if (!top) return;
  if (e.key === "Escape" && !e.isComposing) {
    const { onDismiss } = top.get();
    if (onDismiss) {
      e.preventDefault();
      e.stopPropagation();
      onDismiss();
    }
    return;
  }
  if (e.key === "Tab") {
    const focusables = [...top.el.querySelectorAll<HTMLElement>("[tabindex]:not([tabindex='-1']), input, textarea, button, a[href], iframe")].filter((n) => !n.closest(".hid") && n.offsetParent !== null);
    if (focusables.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusables[0]!;
    const last = focusables[focusables.length - 1]!;
    const active = document.activeElement;
    if (!top.el.contains(active)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

function onPointerDown(e: PointerEvent) {
  const top = topModal();
  if (!top) return;
  const target = e.target as Node | null;
  if (target && top.el.contains(target)) return;
  if (target instanceof Element && target.closest("[data-rune-modal]") && !top.el.contains(target)) {
    const owner = target.closest<HTMLElement>("[data-rune-modal]");
    if (owner && modals.some((m) => m.el === owner)) return;
  }
  const { modal, onDismiss } = top.get();
  if (modal.clickOutside && onDismiss) {
    e.stopPropagation();
    onDismiss();
  }
}

function onWheel(e: WheelEvent) {
  const top = topModal();
  if (!top) return;
  const target = e.target as Node | null;
  if (target && top.el.contains(target)) return;
  const { modal, onDismiss } = top.get();
  if (modal.wheelOutside && onDismiss) onDismiss();
}

let listening = false;
function listen() {
  if (listening) return;
  listening = true;
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("wheel", onWheel, { capture: true, passive: true });
}

/** `modal`: Escape and an outside press dismiss the topmost; focus stays inside it and returns where it was. */
export function pushModal(el: HTMLElement, get: ModalEntry["get"]): () => void {
  listen();
  const entry: ModalEntry = { el, get, restore: document.activeElement };
  modals.push(entry);
  el.dataset.runeModal = "";
  queueMicrotask(() => {
    if (el.contains(document.activeElement)) return;
    const auto = el.querySelector<HTMLElement>("[data-autofocus]") ?? el.querySelector<HTMLElement>("input, textarea") ;
    if (auto) auto.focus({ preventScroll: true });
    else {
      if (!el.hasAttribute("tabindex")) el.tabIndex = -1;
      el.focus({ preventScroll: true });
    }
  });
  return () => {
    const i = modals.indexOf(entry);
    if (i >= 0) modals.splice(i, 1);
    const restore = entry.restore;
    if (restore instanceof HTMLElement && restore.isConnected && (el.contains(document.activeElement) || document.activeElement === document.body)) restore.focus({ preventScroll: true });
  };
}
