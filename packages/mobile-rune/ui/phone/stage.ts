import { useSyncExternalStore } from "react";
import type { HostElement } from "../../../desktop-rune/host/reconciler";
import { usePhoneNav as usePhoneNavState, type PhoneDrawer } from "./nav";

// packages/mobile's DrawerStage, in Rune's terms. A drawer doesn't slide over the page: it waits
// behind it, and the page itself moves aside (it slides by the drawer's travel, shrinks to 0.9 and
// rounds its corners), veiled in the app's background, while the drawer fades and grows into
// place. The top bar's round button turns into a chevron that rides with the page to the
// drawer's title row. Everything here is a function of the drawer's progress, 0 (shut) to 1 (open),
// so the springs (open and shut) and a finger dragging it shut move every piece together.

export const DRAWER_SCALE = 0.9;
export const DRAWER_RADIUS = 40;
const PAGE_STRIP = 60;

/** packages/mobile's drawerTravel: three quarters of the window, 320–400 pt, leaving a strip of the page. */
export const drawerTravel = (w: number) => Math.round(Math.max(Math.min(w * 0.75, 320), Math.min(w * (1 + DRAWER_SCALE) * 0.5 - PAGE_STRIP, 400)));

/** packages/mobile's OPEN (stiffness 340, damping 31) and CLOSE (420, 42, clamped) springs. */
export const OPEN_SPRING = { dur: 0.36, bounce: 0.08 };
export const CLOSE_SPRING = { dur: 0.34, bounce: 0 };

export const sideOf = (drawer: PhoneDrawer): "start" | "end" => (drawer === "chat-settings" ? "end" : "start");
/** Which way the page moves: right for the account (start) drawer, left for chat settings. */
export const signOf = (drawer: PhoneDrawer) => (sideOf(drawer) === "start" ? 1 : -1);

/** The drawer's progress: open is 1, shut is 0, and a drag shutting it sits in between. */
export function drawerProgress(open: boolean, drag: number | null, travel: number): number {
  if (!open) return 0;
  if (drag === null) return 1;
  return Math.max(0, Math.min(1, 1 - drag / travel));
}

/** packages/mobile's drawerVeil: the page's veil over its progress (0 until 0.15, full at 0.9, eased). */
export function drawerVeil(v: number): number {
  const t = (v - 0.15) / 0.75;
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  // cubic-bezier(0.25, 0, 0.6, 0.7), close enough by its polynomial.
  return t * t * (3 - 2 * t) * 0.92 + t * 0.08;
}

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Where the page sits at progress `v`. */
export function stageLook(v: number, sign: number, travel: number) {
  return { x: sign * v * travel, scale: 1 - (1 - DRAWER_SCALE) * v, radius: v > 0.001 ? DRAWER_RADIUS * Math.min(1, v / 0.12) : 0 };
}

/** Where the drawer itself sits at progress `v`: it fades in over the first 40 %, growing from 0.95 and easing in from a little behind. */
export function panelLook(v: number, sign: number, travel: number) {
  return { x: -sign * travel * 0.18 * (1 - v), scale: 0.95 + 0.05 * v, opacity: clamp01(v / 0.4) };
}

// The drawers render where the page's transform and clip can't reach them: inside this element,
// which PhoneRoot puts behind the page (`elementPortal`).
let host: HostElement | null = null;
const listeners = new Set<() => void>();
export function setDrawerHost(next: HostElement | null) {
  if (host === next) return;
  host = next;
  for (const l of listeners) l();
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const read = () => host;
export const useDrawerHost = () => useSyncExternalStore(subscribe, read, read);

// The window's size, which the page measures (the chevrons' path and the drawers' width follow it).
let size = { w: (globalThis as { __native?: { env?: { width?: number } } }).__native?.env?.width ?? 390, h: 844 };
const sizeListeners = new Set<() => void>();
export function noteWindowSize(w: number, h: number) {
  if (Math.abs(size.w - w) < 0.5 && Math.abs(size.h - h) < 0.5) return;
  size = { w, h };
  for (const l of sizeListeners) l();
}
const subscribeSize = (l: () => void) => {
  sizeListeners.add(l);
  return () => {
    sizeListeners.delete(l);
  };
};
const readSize = () => size;
export const useWindowSize = () => useSyncExternalStore(subscribeSize, readSize, readSize);

/**
 * The page's transform at this moment, for everything that moves with it. The page's own column
 * carries it, but `fixed` chrome inside the page (the top and bottom bars, the tab pages, the veil)
 * is laid out against the window and doesn't inherit an ancestor's transform, so each of those
 * applies it itself through `stageFollow`.
 */
export function useStage() {
  const nav = usePhoneNavState();
  const size = useWindowSize();
  const travel = drawerTravel(size.w);
  const live = nav.shown !== null;
  const v = drawerProgress(nav.drawer !== null, nav.drag, travel);
  const sign = signOf(nav.shown);
  const look = stageLook(v, sign, travel);
  const motion = nav.drag !== null ? undefined : nav.drawer ? OPEN_SPRING : CLOSE_SPRING;
  return { ...look, v, sign, travel, live, motion, size, drawer: nav.drawer, drag: nav.drag };
}

export type Stage = ReturnType<typeof useStage>;

/**
 * Props that move a fixed element `h` tall whose top is `top` points down the window as the page
 * moves: the same slide, and the same shrink about the window's centre (its `origin`, as a
 * fraction of the element, may lie outside it).
 */
export function stageFollow(st: Stage, top: number, h: number) {
  const oy = h > 0 ? (st.size.h / 2 - top) / h : 0.5;
  // The spring only while a drawer is out: motion reaches every change beneath it, and the bars change with the keyboard each frame.
  return { x: st.x, scale: st.scale, origin: [0.5, oy] as [number, number], motion: st.live ? st.motion : undefined };
}

// The app's background, for the page's own column (PhoneRoot), which renders outside the theme's
// provider: PhoneChrome, inside it, publishes the colour.
let stageBg: string | null = null;
const bgListeners = new Set<() => void>();
export function setStageBackground(next: string) {
  if (stageBg === next) return;
  stageBg = next;
  for (const l of bgListeners) l();
}
const subscribeBg = (l: () => void) => {
  bgListeners.add(l);
  return () => bgListeners.delete(l);
};
export const useStageBackground = () => useSyncExternalStore(subscribeBg, () => stageBg, () => stageBg);
