import { useMemo, useSyncExternalStore } from "react";
import { Keyboard, useWindowDimensions } from "react-native";
import { Gesture } from "react-native-gesture-handler";
import {
  Easing,
  cancelAnimation,
  makeMutable,
  runOnJS,
  runOnUI,
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
  watchDrag();
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

const SCALE = 0.9;
const END_STRIP = 60;

export function drawerTravels(width: number) {
  const start = Math.round(Math.min(width * 0.75, 320));
  const end = Math.max(
    start,
    Math.round(Math.min(width * (1 + SCALE) * 0.5 - END_STRIP, 400)),
  );
  return { start, end };
}

/**
 * The sidebars' widths. The left one keeps its 3/4; the right one, with more
 * to hold, takes all but a strip of the shrunken page wide enough to tap.
 */
export function useDrawerMetrics() {
  const { width } = useWindowDimensions();
  const travels = drawerTravels(width);
  return {
    width,
    travel: travels.start,
    endTravel: travels.end,
    scale: SCALE,
    radius: 40,
  };
}

export function useDrawerTravel(side: DrawerSide) {
  const { travel, endTravel } = useDrawerMetrics();
  return side === "start" ? travel : endTravel;
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

const dragOwner = makeMutable(0);
const dragMovedAt = makeMutable(0);
const dragOrigin = makeMutable(0);
const dragTravel = makeMutable(1);

let nextOwner = 1;

function grab(
  owner: number,
  sign: number,
  translationX: number,
  travel: number,
) {
  "worklet";
  cancelAnimation(drawerProgress);
  if (drawerSign.value !== sign) {
    drawerSign.value = sign;
    drawerProgress.value = 0;
  }
  dragTravel.value = travel;
  dragOrigin.value = drawerProgress.value - (sign * translationX) / travel;
  dragOwner.value = owner;
  dragMovedAt.value = Date.now();
  runOnJS(begin)(sign === 1 ? "start" : "end");
}

function track(owner: number, translationX: number) {
  "worklet";
  if (dragOwner.value !== owner) return;
  dragMovedAt.value = Date.now();
  const raw =
    dragOrigin.value + (drawerSign.value * translationX) / dragTravel.value;
  drawerProgress.value = raw < 0 ? 0 : raw > 1 ? 1 + rubber(raw - 1) : raw;
}

function release(owner: number, velocityX: number) {
  "worklet";
  if (dragOwner.value !== owner) return;
  dragOwner.value = 0;
  const v = (drawerSign.value * velocityX) / dragTravel.value;
  const open = drawerProgress.value + v * 0.2 > 0.5;
  runOnJS(setOpen)(open);
  settleDrawer(open, v);
}

/** A finger that stops moving this long without lifting has been lost. */
const LOST_TOUCH_MS = 1500;

function abandonDrag(owner: number) {
  "worklet";
  release(owner, 0);
}

let dragWatch: ReturnType<typeof setInterval> | null = null;

/**
 * A drag whose end never arrives (the system took the touch, or the touch
 * was lost) would leave the stage part-open. While a drag is held, a touch
 * that has not moved for a while is treated as released where it is.
 */
function watchDrag() {
  if (dragWatch) return;
  dragWatch = setInterval(() => {
    const owner = dragOwner.value;
    if (owner === 0) {
      if (dragWatch) clearInterval(dragWatch);
      dragWatch = null;
      return;
    }
    if (Date.now() - dragMovedAt.value > LOST_TOUCH_MS) {
      runOnUI(abandonDrag)(owner);
    }
  }, 250);
}

/**
 * The page's drag. At rest the direction picks the sidebar (right for the
 * start one, left for the end one); a drawer still moving is caught where it
 * is, whichever way the finger goes. Nothing it reads changes mid-drag, so the
 * gesture is never rebuilt under a finger. Each drag is owned by the gesture
 * that grabbed it, and that gesture's finalize always settles it, so no path
 * leaves the stage part-open.
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
  const { travel, endTravel } = useDrawerMetrics();
  return useMemo(() => {
    const owner = nextOwner++;
    const offset: number | [number, number] =
      start && end ? [-12, 12] : start ? 12 : -12;
    return Gesture.Pan()
      .enabled((start || end) && !open)
      .activeOffsetX(offset)
      .failOffsetY([-14, 14])
      .onTouchesDown((_e, manager) => {
        if (dragOwner.value === owner) manager.end();
      })
      .onStart((e) => {
        let sign = drawerSign.value;
        if (drawerProgress.value <= 0.001) {
          sign = e.translationX > 0 ? 1 : -1;
          if (sign === 1 ? !start : !end) return;
        }
        grab(owner, sign, e.translationX, sign === 1 ? travel : endTravel);
        runOnJS(dismissKeyboard)();
      })
      .onUpdate((e) => track(owner, e.translationX))
      .onFinalize((e) => release(owner, e.velocityX));
  }, [start, end, open, travel, endTravel]);
}

/**
 * The open sidebar's drag back toward closed, from its panel or the page.
 * `scroll` is the panel's own scroll view, which would otherwise claim a
 * sideways swipe before this sees it.
 */
export function useDrawerClosePan(
  side: DrawerSide,
  scroll?: ReturnType<typeof Gesture.Native>,
) {
  const travel = useDrawerTravel(side);
  const sign = side === "start" ? 1 : -1;
  return useMemo(() => {
    const owner = nextOwner++;
    const pan = Gesture.Pan()
      .activeOffsetX(sign > 0 ? -12 : 12)
      .failOffsetY([-14, 14])
      .onTouchesDown((_e, manager) => {
        if (dragOwner.value === owner) manager.end();
      })
      .onStart((e) => grab(owner, sign, e.translationX, travel))
      .onUpdate((e) => track(owner, e.translationX))
      .onFinalize((e) => release(owner, e.velocityX));
    return scroll ? pan.simultaneousWithExternalGesture(scroll) : pan;
  }, [sign, travel, scroll]);
}
