import { useEffect, useState, useSyncExternalStore } from "react";
import type { HostElement } from "../../../desktop-rune/host/reconciler";
import { command } from "../../../desktop-rune/host/bridge";
import { usePhoneNav as usePhoneNavState, type PhoneDrawer } from "./nav";

// packages/mobile's DrawerStage, in Rune's terms. A drawer doesn't slide over the page: it waits
// behind it, and the page itself moves aside (it slides by the drawer's travel, shrinks to 0.9 and
// rounds its corners), blurred and veiled in the app's background, while the drawer fades, sharpens
// and grows into place. The top bar's round button turns into a chevron that rides with the page
// to the drawer's title row. Everything here is a function of the drawer's progress `v`, 0 (shut)
// to 1 (open), which the engine owns (`mobile/stage.rs`): it follows the finger and RN's springs
// frame by frame, and every piece rides it through a `stage` prop of tracks over `v`, so a
// swipe or a spring never waits on a React render.

export const DRAWER_SCALE = 0.9;
export const DRAWER_RADIUS = 40;
const PAGE_STRIP = 60;

/** packages/mobile's drawerTravel: three quarters of the window, 320–400 pt, leaving a strip of the page. */
export const drawerTravel = (w: number) => Math.round(Math.max(Math.min(w * 0.75, 320), Math.min(w * (1 + DRAWER_SCALE) * 0.5 - PAGE_STRIP, 400)));

/** Roughly how long RN's OPEN spring (stiffness 340, damping 31) takes to settle, for what plays alongside it. */
export const OPEN_SETTLE_S = 0.36;

export const sideOf = (drawer: PhoneDrawer): "start" | "end" => (drawer === "chat-settings" ? "end" : "start");
/** Which way the page moves: right for the account (start) drawer, left for chat settings. */
export const signOf = (drawer: PhoneDrawer) => (sideOf(drawer) === "start" ? 1 : -1);

/** CSS / Reanimated `cubic-bezier(x1, y1, x2, y2)` at `t`: x solved by Newton's method, then y. */
function cubicBezier(x1: number, y1: number, x2: number, y2: number, t: number): number {
  const ax = 3 * x1 - 3 * x2 + 1, bx = 3 * x2 - 6 * x1, cx = 3 * x1;
  const ay = 3 * y1 - 3 * y2 + 1, by = 3 * y2 - 6 * y1, cy = 3 * y1;
  let u = t;
  for (let i = 0; i < 8; i++) {
    const x = ((ax * u + bx) * u + cx) * u - t;
    const dx = (3 * ax * u + 2 * bx) * u + cx;
    if (Math.abs(x) < 1e-6 || Math.abs(dx) < 1e-6) break;
    u -= x / dx;
  }
  u = Math.max(0, Math.min(1, u));
  return ((ay * u + by) * u + cy) * u;
}

/** packages/mobile's drawerVeil: the page's veil over its progress (0 until 0.15, full at 0.9, on `cubic-bezier(0.25, 0, 0.6, 0.7)`). */
export function drawerVeil(v: number): number {
  const t = (v - 0.15) / 0.75;
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return cubicBezier(0.25, 0, 0.6, 0.7, t);
}

/** packages/mobile's drawerBlur: the page's blur over its progress, a third of the way in by 0.15 and full at 0.9. */
export function drawerBlur(v: number): number {
  const knee = 0.15;
  const kneeAmount = 0.38;
  const end = 0.9;
  if (v <= 0) return 0;
  if (v >= end) return 1;
  if (v <= knee) {
    const t = 1 - v / knee;
    return kneeAmount * (1 - t * t * t);
  }
  return kneeAmount + (1 - kneeAmount) * Math.pow((v - knee) / (end - knee), 1.5);
}

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** A track over the stage's progress: `[v, value]` points, linear between them. */
export type Track = [number, number][];
/** The engine carries a track on past its ends along its end segments; this one holds its end values instead (RN's `Extrapolation.CLAMP`). */
export const held = (t: Track): Track => [[t[0][0] - 1, t[0][1]], ...t, [t[t.length - 1][0] + 1, t[t.length - 1][1]]];
/** `f` over [0, 1] in `n` steps, held past the ends. */
export const sampled = (f: (v: number) => number, n = 24): Track => held(Array.from({ length: n + 1 }, (_, i) => [i / n, f(i / n)] as [number, number]));

export type StageTracks = { x?: Track; y?: Track; scale?: Track; opacity?: Track; rotate?: Track; radius?: Track; blur?: Track; tint?: Track; signed?: boolean; hideAbove?: number };

/** The page's own motion (DrawerStage's stage style): slid by the travel toward the drawer's side, shrunk to 0.9 (on past open as a finger pulls), its corners rounded over the first 12 %. */
export const pageTracks = (travel: number): StageTracks => ({ x: [[0, 0], [1, travel]], scale: [[0, 1], [1, DRAWER_SCALE]], signed: true });
/**
 * The page's corner radius over the stage's progress. The page itself isn't clipped round (a
 * rounded clip draws the whole page into a window-sized layer every frame of the motion):
 * `PageCorners` paints the background over its corners instead, and the veil and blur over it
 * take the same radius.
 */
export const PAGE_RADIUS: Track = held([[0, 0], [0.12, DRAWER_RADIUS]]);

const VEIL_TRACK = sampled((v) => drawerVeil(v), 48);
export const veilTrack = (scale: number): Track => VEIL_TRACK.map(([v, o]) => [v, o * scale]);

/**
 * iOS's light and dark blur materials (UIBlurEffect, which expo-blur's BlurView shows) at an
 * animator fraction `f` (BlurView's `intensity / 100`), measured on the simulator: the blur's
 * standard deviation grows linearly to 30 pt (light) or 20 pt (dark), and its tint, white or
 * #1b1b1b, to 30 % or 73 % alpha. Nothing fades: the blur itself deepens and clears.
 */
export const BLUR_MATERIAL = {
  light: { sigma: 30, tint: "#ffffff", alpha: 0.3 },
  dark: { sigma: 20, tint: "#1b1b1b", alpha: 0.73 },
} as const;
export const blurMaterial = (dark: boolean) => (dark ? BLUR_MATERIAL.dark : BLUR_MATERIAL.light);

/** packages/mobile's PAGE_BLUR: the page's BlurView at intensity `drawerBlur(v) * 30`. */
const PAGE_INTENSITY = 0.3;
/** packages/mobile's PANEL_BLUR: the drawer's BlurView at intensity 34, clearing to 0 by `v = 0.9`. */
const PANEL_INTENSITY = 0.34;
const PAGE_FRACTION = sampled((v) => drawerBlur(v) * PAGE_INTENSITY, 48);
const PANEL_FRACTION = held([[0, PANEL_INTENSITY], [0.9, 0]]);

/** The page's blur as the drawer opens: its sigma and its tint's alpha (DrawerStage's `pageBlur`). */
export const pageBlurTracks = (dark: boolean): StageTracks => {
  const m = blurMaterial(dark);
  return { blur: PAGE_FRACTION.map(([v, f]) => [v, f * m.sigma]), tint: PAGE_FRACTION.map(([v, f]) => [v, f * m.alpha]) };
};

/** The drawer's own blur, sharpening as it opens and gone from 97 % (DrawerPanel's `panelFocus`). */
export const panelBlurTracks = (dark: boolean): StageTracks => {
  const m = blurMaterial(dark);
  return { blur: PANEL_FRACTION.map(([v, f]) => [v, f * m.sigma]), tint: PANEL_FRACTION.map(([v, f]) => [v, f * m.alpha]), hideAbove: 0.97 };
};

/**
 * DrawerPanel's fade in over the first 40 %, drawn as the app's background over the drawer
 * fading out rather than as the drawer's opacity: the drawer sits on that background, so it is
 * the same picture, without drawing the whole drawer into a layer of its own each frame.
 */
export const PANEL_DIM: StageTracks = { opacity: held([[0, 1], [0.4, 0]]), hideAbove: 0.4 };

/** Where the drawer itself sits (DrawerPanel): it grows from 0.95 and eases in from a little behind (its fade is `PANEL_DIM`). */
export const panelTracks = (sign: number, travel: number): StageTracks => ({
  x: held([[0, -sign * travel * 0.18], [1, 0]]),
  scale: held([[0, 0.95], [1, 1]]),
});

/** Tells the engine the drawer's travel, which a finger's travel is measured against. */
let sentTravel = 0;
export function noteTravel(travel: number) {
  if (travel === sentTravel) return;
  sentTravel = travel;
  command({ cmd: "stage", travel });
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
  noteTravel(drawerTravel(w));
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
 * What moves with the page. The page's own column carries it, but `fixed` chrome inside the page
 * (the top and bottom bars, the tab pages, the veil) is laid out against the window and doesn't
 * inherit an ancestor's transform, so each of those rides the stage itself through `stageFollow`.
 */
export function useStage() {
  const nav = usePhoneNavState();
  const size = useWindowSize();
  const travel = drawerTravel(size.w);
  const live = nav.shown !== null;
  const sign = signOf(nav.shown);
  return { sign, travel, live, size, drawer: nav.drawer };
}

export type Stage = ReturnType<typeof useStage>;

/**
 * Props that move a fixed element `h` tall whose top is `top` points down the window with the
 * page: the same slide, and the same shrink about the window's centre (its `origin`, as a fraction
 * of the element, may lie outside it).
 */
export function stageFollow(st: Stage, top: number, h: number) {
  const oy = h > 0 ? (st.size.h / 2 - top) / h : 0.5;
  const page = pageTracks(st.travel);
  return { stage: { x: page.x, scale: page.scale, signed: true }, origin: [0.5, oy] as [number, number] };
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

/** How long after launch a drawer's contents mount while it's shut. */
const WARM_MOUNT_MS = 1200;

/**
 * Whether a drawer's contents are mounted: from its first showing, or shortly after launch while
 * it is still shut, as packages/mobile's DrawerStage always holds both panels. Mounted ahead, the
 * first opening neither builds the whole panel in the frame it starts in nor fades it in (an
 * element mounted by a tap enters on Rune's default fade, in a layer of its own); a commit no
 * input caused mounts at once.
 */
export function useWarmMount(showing: boolean): boolean {
  const [mounted, setMounted] = useState(showing);
  if (showing && !mounted) setMounted(true);
  useEffect(() => {
    if (mounted) return;
    const timer = setTimeout(() => setMounted(true), WARM_MOUNT_MS);
    return () => clearTimeout(timer);
  }, [mounted]);
  return mounted;
}
