import { useSyncExternalStore } from "react";

const LEVEL_TICK_MS = 80;

type DictationMeterSnapshot = {
  active: boolean;
  startedAt: number;
  level: number;
  revision: number;
};

let snapshot: DictationMeterSnapshot = {
  active: false,
  startedAt: 0,
  level: 0,
  revision: 0,
};
const MAX_QUEUED_LEVELS = 16;

let queuedLevels: number[] = [];
let tickTimer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

const publish = (next: Omit<DictationMeterSnapshot, "revision">): void => {
  snapshot = { ...next, revision: snapshot.revision + 1 };
  for (const listener of listeners) listener();
};

const clearTick = (): void => {
  if (tickTimer !== null) clearInterval(tickTimer);
  tickTimer = null;
  queuedLevels = [];
};

export const startDictationMeter = (startedAt: number): void => {
  clearTick();
  publish({ active: true, startedAt, level: 0 });
  tickTimer = setInterval(() => {
    const level = queuedLevels.shift();
    if (level === undefined) return;
    publish({ ...snapshot, level });
  }, LEVEL_TICK_MS);
};

export const pushDictationLevels = (levels: readonly number[]): void => {
  for (const level of levels) {
    queuedLevels.push(Math.max(0, Math.min(1, level)));
  }
  if (queuedLevels.length > MAX_QUEUED_LEVELS) {
    queuedLevels = queuedLevels.slice(queuedLevels.length - MAX_QUEUED_LEVELS);
  }
};

export const stopDictationMeter = (): void => {
  clearTick();
  if (!snapshot.active) return;
  publish({ active: false, startedAt: 0, level: 0 });
};

export const getDictationMeterSnapshot = (): DictationMeterSnapshot => snapshot;

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useDictationMeterTick = (): number =>
  useSyncExternalStore(
    subscribe,
    () => snapshot.revision,
    () => snapshot.revision,
  );

export const useDictationMeterStartedAt = (): number =>
  useSyncExternalStore(
    subscribe,
    () => (snapshot.active ? snapshot.startedAt : 0),
    () => (snapshot.active ? snapshot.startedAt : 0),
  );
