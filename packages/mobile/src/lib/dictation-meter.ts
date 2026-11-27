import { useSyncExternalStore } from "react";

type DictationMeterSnapshot = {
  active: boolean;
  startedAt: number;
};

let snapshot: DictationMeterSnapshot = { active: false, startedAt: 0 };
const listeners = new Set<() => void>();
const levelListeners = new Set<(level: number) => void>();

const publish = (next: DictationMeterSnapshot): void => {
  snapshot = next;
  for (const listener of listeners) listener();
};

export const startDictationMeter = (startedAt: number): void => {
  publish({ active: true, startedAt });
};

export const pushDictationLevel = (level: number): void => {
  if (!snapshot.active) return;
  const clamped = Math.max(0, Math.min(1, level));
  for (const listener of levelListeners) listener(clamped);
};

export const stopDictationMeter = (): void => {
  if (!snapshot.active) return;
  publish({ active: false, startedAt: 0 });
};

export const subscribeDictationLevel = (
  listener: (level: number) => void,
): (() => void) => {
  levelListeners.add(listener);
  return () => {
    levelListeners.delete(listener);
  };
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const startedAtSnapshot = () => (snapshot.active ? snapshot.startedAt : 0);

export const useDictationMeterStartedAt = (): number =>
  useSyncExternalStore(subscribe, startedAtSnapshot, startedAtSnapshot);
