import { useMemo, useSyncExternalStore } from "react";
import { Keyboard, useWindowDimensions } from "react-native";
import { Gesture } from "react-native-gesture-handler";
import {
  Easing,
  cancelAnimation,
  makeMutable,
  runOnJS,
  withSpring,
  type WithSpringConfig,
} from "react-native-reanimated";

export type DrawerSide = "start" | "end";

export const drawerProgress = makeMutable(0);
export const drawerSign = makeMutable(1);

type DrawerState = { open: boolean; live: boolean; side: DrawerSide };

let state: DrawerState = { open: false, live: false, side: "start" };
const listeners = new Set<() => void>();

function setState(next: Partial<DrawerState>) {
  const merged = { ...state, ...next };
  if (
    merged.open === state.open &&
    merged.live === state.live &&
    merged.side === state.side
  ) {
    return;
  }
  state = merged;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const readOpen = () => state.open;
const readLive = () => state.live;
const readSide = () => state.side;

export function useDrawerOpen(): boolean {
  return useSyncExternalStore(subscribe, readOpen, readOpen);
}

export function useDrawerLive(): boolean {
  return useSyncExternalStore(subscribe, readLive, readLive);
}

export function useDrawerSide(): DrawerSide {
  return useSyncExternalStore(subscribe, readSide, readSide);
}

const OPEN: WithSpringConfig = { stiffness: 340, damping: 31, mass: 1 };
const CLOSE: WithSpringConfig = {
  stiffness: 420,
  damping: 42,
  mass: 1,
  overshootClamping: true,
};

let openedAt = 0;

function setOpen(open: boolean) {
  if (open && !state.open) openedAt = Date.now();
  setState({ open, live: open || state.live });
}

export function drawerJustOpened(): boolean {
  return Date.now() - openedAt < 380;
}

function setLive(live: boolean) {
  setState({ live });
}

function begin(side: DrawerSide) {
  setState({ live: true, side });
}

function claimSide(side: DrawerSide) {
  if (state.side === side) return;
  if (state.live) cancelAnimation(drawerProgress);
  drawerProgress.value = 0;
  drawerSign.value = side === "start" ? 1 : -1;
  setState({ side });
}

function rested() {
  if (!state.open) setLive(false);
}

function settleDrawer(open: boolean, velocity = 0) {
  "worklet";
  drawerProgress.value = withSpring(
    open ? 1 : 0,
    { ...(open ? OPEN : CLOSE), velocity },
    (done) => {
      if (done && !open) runOnJS(rested)();
    },
  );
}

export function openDrawer(side: DrawerSide = "start") {
  Keyboard.dismiss();
  claimSide(side);
  setOpen(true);
  settleDrawer(true);
}

export function closeDrawer() {
  setOpen(false);
  settleDrawer(false);
}

export function isDrawerOpen(side?: DrawerSide): boolean {
  return state.open && (side === undefined || state.side === side);
}

export function useDrawerMetrics() {
  const { width } = useWindowDimensions();
  const travel = Math.round(Math.min(width * 0.75, 320));
  return { width, travel, scale: 0.9, radius: 40 };
}

export const DRAWER_VEIL = {
  start: 0.15,
  end: 0.9,
  curve: [0.25, 0, 0.6, 0.7] as const,
};

const veilCurve = Easing.bezierFn(...DRAWER_VEIL.curve);

export function drawerVeil(progress: number) {
  "worklet";
  const t =
    (progress - DRAWER_VEIL.start) / (DRAWER_VEIL.end - DRAWER_VEIL.start);
  return t <= 0 ? 0 : t >= 1 ? 1 : veilCurve(t);
}

export const DRAWER_BLUR = {
  knee: 0.15,
  kneeAmount: 0.38,
  end: 0.9,
  tail: 1.5,
};

export function drawerBlur(progress: number) {
  "worklet";
  const { knee, kneeAmount, end, tail } = DRAWER_BLUR;
  if (progress <= 0) return 0;
  if (progress >= end) return 1;
  if (progress <= knee) {
    const t = 1 - progress / knee;
    return kneeAmount * (1 - t * t * t);
  }
  const u = (progress - knee) / (end - knee);
  return kneeAmount + (1 - kneeAmount) * Math.pow(u, tail);
}

function rubber(over: number) {
  "worklet";
  const limit = 0.09;
  return (1 - 1 / ((over * 0.6) / limit + 1)) * limit;
}

const dismissKeyboard = () => Keyboard.dismiss();

const dragging = makeMutable(0);
const dragOrigin = makeMutable(0);

function grab(sign: number, translationX: number, travel: number) {
  "worklet";
  cancelAnimation(drawerProgress);
  if (drawerSign.value !== sign) {
    drawerSign.value = sign;
    drawerProgress.value = 0;
  }
  dragOrigin.value = drawerProgress.value - (sign * translationX) / travel;
  dragging.value = 1;
  runOnJS(begin)(sign === 1 ? "start" : "end");
}

function track(translationX: number, travel: number) {
  "worklet";
  if (dragging.value !== 1) return;
  const raw = dragOrigin.value + (drawerSign.value * translationX) / travel;
  drawerProgress.value = raw < 0 ? 0 : raw > 1 ? 1 + rubber(raw - 1) : raw;
}

function release(velocityX: number, travel: number) {
  "worklet";
  if (dragging.value !== 1) return;
  dragging.value = 0;
  const v = (drawerSign.value * velocityX) / travel;
  const open = drawerProgress.value + v * 0.2 > 0.5;
  runOnJS(setOpen)(open);
  settleDrawer(open, v);
}

/**
 * The page's drag. At rest the direction picks the sidebar (right for the
 * start one, left for the end one); a drawer still moving is caught where it
 * is, whichever way the finger goes. Nothing it reads changes mid-drag, so the
 * gesture is never rebuilt under a finger, and every drag ends in a settle.
 */
export function useDrawerOpenPan({
  start,
  end,
  open,
}: {
  start: boolean;
  end: boolean;
  open: boolean;
}) {
  const { travel } = useDrawerMetrics();
  return useMemo(() => {
    const offset: number | [number, number] =
      start && end ? [-12, 12] : start ? 12 : -12;
    return Gesture.Pan()
      .enabled((start || end) && !open)
      .activeOffsetX(offset)
      .failOffsetY([-14, 14])
      .onStart((e) => {
        let sign = drawerSign.value;
        if (drawerProgress.value <= 0.001) {
          sign = e.translationX > 0 ? 1 : -1;
          if (sign === 1 ? !start : !end) return;
        }
        grab(sign, e.translationX, travel);
        runOnJS(dismissKeyboard)();
      })
      .onUpdate((e) => track(e.translationX, travel))
      .onFinalize((e) => release(e.velocityX, travel));
  }, [start, end, open, travel]);
}

/** The open sidebar's drag back toward closed, from its panel or the page. */
export function useDrawerClosePan(side: DrawerSide) {
  const { travel } = useDrawerMetrics();
  const sign = side === "start" ? 1 : -1;
  return useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX(sign > 0 ? -12 : 12)
        .failOffsetY([-14, 14])
        .onStart((e) => grab(sign, e.translationX, travel))
        .onUpdate((e) => track(e.translationX, travel))
        .onFinalize((e) => release(e.velocityX, travel)),
    [sign, travel],
  );
}
