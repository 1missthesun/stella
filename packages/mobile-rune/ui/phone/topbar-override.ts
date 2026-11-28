import { useSyncExternalStore } from "react";
import type { PhoneTab } from "./nav";

// What a tab page puts in the top bar while it shows something pushed over its root (packages/mobile's
// stack screens: a folder in Files, Email over Apps): a title in place of the tab's, and a back
// button in place of the account button. Tapping the tab again while one shows goes back to its root.

export type TopBarOverride = { title: string | null; back: { label: string; onPress: () => void } | null };

const NONE: TopBarOverride = { title: null, back: null };
let state: Partial<Record<PhoneTab, TopBarOverride>> = {};
const resets = new Map<PhoneTab, () => void>();
const listeners = new Set<() => void>();

export const topBarOverride = {
  set(tab: PhoneTab, next: TopBarOverride | null) {
    const cur = state[tab] ?? NONE;
    const value = next ?? NONE;
    if (cur.title === value.title && cur.back === value.back) return;
    state = { ...state, [tab]: value };
    for (const l of listeners) l();
  },
  get: (tab: PhoneTab): TopBarOverride => state[tab] ?? NONE,
  /** The tab page's way back to its root, run when its tab is tapped again. */
  onReset(tab: PhoneTab, reset: () => void): () => void {
    resets.set(tab, reset);
    return () => {
      if (resets.get(tab) === reset) resets.delete(tab);
    };
  },
  reset(tab: PhoneTab) {
    resets.get(tab)?.();
  },
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const useTopBarOverride = (tab: PhoneTab): TopBarOverride => useSyncExternalStore(subscribe, () => state[tab] ?? NONE);
