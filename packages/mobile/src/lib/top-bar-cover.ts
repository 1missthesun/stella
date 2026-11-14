import { useSyncExternalStore } from "react";
import { makeMutable } from "react-native-reanimated";

/** How much of the main top bar is covered by the page under it, 0 to 1. */
export const topBarCover = makeMutable(0);

let covered = false;
const listeners = new Set<() => void>();

export function setTopBarCovered(next: boolean): void {
  if (covered === next) return;
  covered = next;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => covered;

export function useTopBarCovered(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
