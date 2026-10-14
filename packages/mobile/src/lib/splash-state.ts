import { useSyncExternalStore } from "react";

let hidden = false;
const listeners = new Set<() => void>();

export function markSplashHidden(): void {
  if (hidden) return;
  hidden = true;
  for (const listener of [...listeners]) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => hidden;

export const useSplashHidden = (): boolean =>
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
