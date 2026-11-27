import { useSyncExternalStore } from "react";

/** The phone's window edges: the safe area (status bar, home indicator) and the keyboard's height, in points. */
export type PhoneInsets = { top: number; right: number; bottom: number; left: number; keyboard: number };

let insets: PhoneInsets = { top: 0, right: 0, bottom: 0, left: 0, keyboard: 0 };
const listeners = new Set<() => void>();

type Appearance = { safeArea?: Partial<Omit<PhoneInsets, "keyboard">>; keyboard?: number };

/** The engine's `appearance` event (entry.ts) carries both. */
export function notePhoneAppearance(a: Appearance) {
  const s = a.safeArea ?? {};
  const next: PhoneInsets = {
    top: s.top ?? insets.top,
    right: s.right ?? insets.right,
    bottom: s.bottom ?? insets.bottom,
    left: s.left ?? insets.left,
    keyboard: Math.max(0, a.keyboard ?? insets.keyboard),
  };
  if ((Object.keys(next) as (keyof PhoneInsets)[]).every((k) => Math.abs(next[k] - insets[k]) < 0.5)) return;
  insets = next;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const read = () => insets;

export const usePhoneInsets = () => useSyncExternalStore(subscribe, read, read);
