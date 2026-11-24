import { useEffect, useId, useMemo, useSyncExternalStore } from "react";
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

export const drawerProgress = makeMutable(0);

type DrawerState = {
  open: boolean;
  live: boolean;
  held: boolean;
};

let state: DrawerState = {
  open: false,
  live: false,
  held: false,
};
const listeners = new Set<() => void>();

function setState(next: Partial<DrawerState>) {
  const merged = { ...state, ...next };
  if (
    merged.open === state.open &&
    merged.live === state.live &&
    merged.held === state.held
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
const readHeld = () => state.held;

export function useDrawerOpen(): boolean {
  return useSyncExternalStore(subscribe, readOpen, readOpen);
}

export function useDrawerLive(): boolean {
  return useSyncExternalStore(subscribe, readLive, readLive);
}

export function useDrawerHeld(): boolean {
  return useSyncExternalStore(subscribe, readHeld, readHeld);
}

const holders = new Set<string>();

export function useHoldDrawer(active: boolean) {
  const id = useId();
  useEffect(() => {
    if (!active) return;
    holders.add(id);
    setState({ held: true });
    return () => {
      holders.delete(id);
      setState({ held: holders.size > 0 });
    };
  }, [active, id]);
}

const OPEN: WithSpringConfig = { stiffness: 340, damping: 31, mass: 1 };
const CLOSE: WithSpringConfig = {
  stiffness: 420,
  damping: 42,
  mass: 1,
  overshootClamping: true,
};

function setOpen(open: boolean) {
  setState({ open, live: open || state.live });
}

function setLive(live: boolean) {
  setState({ live });
}

function begin() {
  setLive(true);
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

export function openDrawer() {
  Keyboard.dismiss();
  setOpen(true);
  settleDrawer(true);
}

export function closeDrawer() {
  setOpen(false);
  settleDrawer(false);
}

export function isDrawerOpen(): boolean {
  return state.open;
}

const SCALE = 0.9;
const PAGE_STRIP = 60;

function drawerTravel(width: number) {
  return Math.round(
    Math.max(
      Math.min(width * 0.75, 320),
      Math.min(width * (1 + SCALE) * 0.5 - PAGE_STRIP, 400),
    ),
  );
}

export function useDrawerMetrics() {
  const { width } = useWindowDimensions();
  return {
    width,
    travel: drawerTravel(width),
    scale: SCALE,
    radius: 40,
  };
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
const dragOrigin = makeMutable(0);
const dragTravel = makeMutable(1);
const dragX = makeMutable(0);
const dragY = makeMutable(0);
const dragAt = makeMutable(0);

/**
 * A move that arrives after the touch has been still this long and lands
 * this far away is not a finger: a real finger starting again from rest moves
 * a few points per sample. It means the drag's end was lost and the next
 * touch was delivered as the same one (the Simulator's injected mouse-up can
 * go missing this way).
 */
const RESUMED_GAP_MS = 150;
const RESUMED_JUMP_PT = 60;

let nextOwner = 1;

type PanPoint = { translationX: number; absoluteX: number; absoluteY: number };

function grab(owner: number, e: PanPoint, travel: number) {
  "worklet";
  cancelAnimation(drawerProgress);
  dragTravel.value = travel;
  dragOrigin.value = drawerProgress.value + e.translationX / travel;
  dragOwner.value = owner;
  dragX.value = e.absoluteX;
  dragY.value = e.absoluteY;
  dragAt.value = Date.now();
  runOnJS(begin)();
}

function track(owner: number, e: PanPoint) {
  "worklet";
  if (dragOwner.value !== owner) return;
  const now = Date.now();
  const jump = Math.hypot(e.absoluteX - dragX.value, e.absoluteY - dragY.value);
  const resumed = now - dragAt.value > RESUMED_GAP_MS && jump > RESUMED_JUMP_PT;
  dragX.value = e.absoluteX;
  dragY.value = e.absoluteY;
  dragAt.value = now;
  if (resumed) {
    abandon(owner);
    return;
  }
  const raw = dragOrigin.value - e.translationX / dragTravel.value;
  drawerProgress.value = raw < 0 ? 0 : raw > 1 ? 1 + rubber(raw - 1) : raw;
}

function abandon(owner: number) {
  "worklet";
  if (dragOwner.value !== owner) return;
  dragOwner.value = 0;
  runOnJS(setOpen)(false);
  settleDrawer(false);
}

function release(owner: number, velocityX: number) {
  "worklet";
  if (dragOwner.value !== owner) return;
  dragOwner.value = 0;
  const v = -velocityX / dragTravel.value;
  const open = drawerProgress.value + v * 0.2 > 0.5;
  runOnJS(setOpen)(open);
  settleDrawer(open, v);
}

export function useDrawerOpenPan({
  enabled,
  open,
  held,
}: {
  enabled: boolean;
  open: boolean;
  held: boolean;
}) {
  const { travel } = useDrawerMetrics();
  return useMemo(() => {
    const owner = nextOwner++;
    return Gesture.Pan()
      .enabled(enabled && !open && !held)
      .activeOffsetX(-12)
      .failOffsetX(12)
      .failOffsetY([-14, 14])
      .onTouchesDown((_e, manager) => {
        if (dragOwner.value === owner) manager.end();
      })
      .onStart((e) => {
        grab(owner, e, travel);
        runOnJS(dismissKeyboard)();
      })
      .onUpdate((e) => track(owner, e))
      .onFinalize((e) => release(owner, e.velocityX));
  }, [enabled, open, held, travel]);
}

export function useDrawerClosePan(scroll?: ReturnType<typeof Gesture.Native>) {
  const { travel } = useDrawerMetrics();
  return useMemo(() => {
    const owner = nextOwner++;
    const pan = Gesture.Pan()
      .activeOffsetX(12)
      .failOffsetY([-14, 14])
      .onTouchesDown((_e, manager) => {
        if (dragOwner.value === owner) manager.end();
      })
      .onStart((e) => grab(owner, e, travel))
      .onUpdate((e) => track(owner, e))
      .onFinalize((e) => release(owner, e.velocityX));
    return scroll ? pan.simultaneousWithExternalGesture(scroll) : pan;
  }, [travel, scroll]);
}
