import { useSyncExternalStore } from "react";

type Listener = () => void;

let isPinned = false;
const listeners = new Set<Listener>();

const emit = (): void => {
  for (const listener of listeners) listener();
};

const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const composerModelPin = {
  isPinned: (): boolean => isPinned,
  setPinned(next: boolean): void {
    if (next === isPinned) return;
    isPinned = next;
    emit();
  },
  toggle(): void {
    isPinned = !isPinned;
    emit();
  },
};

export function useComposerModelPinned(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => isPinned,
    () => false,
  );
}
