const TOLERATED_SKEW_MS = 30_000;
const JUMP_MS = 1_000;

let wallAt = Date.now();
let ticksAt = performance.now();
let steadyOffsetMs = wallAt - ticksAt;
let offsetMs = 0;
const listeners = new Set<() => void>();

const withinTolerance = (ms: number): number => (Math.abs(ms) < TOLERATED_SKEW_MS ? 0 : ms);

const settle = (): number => {
  const ticks = performance.now();
  const wall = Date.now();
  const jump = Math.round(wall - wallAt - (ticks - ticksAt));
  if (Math.abs(jump) >= JUMP_MS) {
    const clockWasSet = jump < 0 || (offsetMs > 0 && Math.abs(jump - offsetMs) < TOLERATED_SKEW_MS);
    if (clockWasSet) offsetMs = withinTolerance(offsetMs - jump);
    else steadyOffsetMs += jump;
    wallAt = wall;
    ticksAt = ticks;
  }
  return Math.floor(ticks + steadyOffsetMs);
};

/**
 * Milliseconds that never run backwards and include time the device slept, unlike `Date.now()` (the
 * device's clock can be set) and `performance.now()` (stops during sleep on macOS and Linux). Only for
 * measuring within this process: not a date, and not comparable across processes or restarts.
 */
export const steadyNow = (): number => settle();

/** How long ago a saved device-clock timestamp was; one from the future was written by a wrong clock and counts as expired. */
export const savedAgeMs = (savedAt: number, now = Date.now()): number => {
  const age = now - savedAt;
  return age < -TOLERATED_SKEW_MS ? Number.POSITIVE_INFINITY : Math.max(0, age);
};

/** How long until a saved device-clock due time; one further off than `longestMs` was written by a wrong clock and is due now. */
export const savedWaitMs = (dueAt: number, longestMs: number, now = Date.now()): number => {
  const wait = dueAt - now;
  return wait > longestMs + TOLERATED_SKEW_MS ? 0 : Math.max(0, wait);
};

export const noteServerTime = (serverTimeMs: number): void => {
  if (!Number.isFinite(serverTimeMs) || serverTimeMs <= 0) return;
  settle();
  const next = withinTolerance(serverTimeMs - Date.now());
  const moved = Math.abs(next - offsetMs) >= TOLERATED_SKEW_MS;
  offsetMs = next;
  if (moved) for (const listener of listeners) listener();
};

export const noteServerDate = (response: Response): void => {
  noteServerTime(Date.parse(response.headers.get("date") ?? ""));
};

export const onServerClockMove = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const serverOffset = (): number => {
  settle();
  return offsetMs;
};

export const serverNow = (): number => Date.now() + serverOffset();

export const toServerTime = (deviceTimeMs: number): number => deviceTimeMs + serverOffset();

export const toDeviceTime = (serverTimeMs: number): number => serverTimeMs - serverOffset();
