import { useSyncExternalStore } from "react";

type DictationMeterSnapshot = {
  active: boolean;
  startedAt: number;
};

let snapshot: DictationMeterSnapshot = { active: false, startedAt: 0 };
const listeners = new Set<() => void>();
const levelListeners = new Set<(levels: readonly number[]) => void>();

const publish = (next: DictationMeterSnapshot): void => {
  snapshot = next;
  for (const listener of listeners) listener();
};

export const startDictationMeter = (startedAt: number): void => {
  publish({ active: true, startedAt });
};

export const pushDictationLevels = (levels: readonly number[]): void => {
  if (!snapshot.active || levels.length === 0) return;
  for (const listener of levelListeners) listener(levels);
};

export const stopDictationMeter = (): void => {
  if (!snapshot.active) return;
  publish({ active: false, startedAt: 0 });
};

export const subscribeDictationLevels = (
  listener: (levels: readonly number[]) => void,
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
