import { useSyncExternalStore } from "react";

/** desktop-ui's `--topbar-open-tab-left/right`: the open tab's window x-range (its feet included), where the stage's top edge opens. */
export type OpenTabNotch = { left: number; right: number } | null;

const FOOT_REACH = 7;

let notch: OpenTabNotch = null;
const listeners = new Set<() => void>();

export const openTabNotch = {
  set(tab: { x: number; w: number } | null, chatRight: number, stripRight: number) {
    const left = tab ? Math.max(tab.x - FOOT_REACH, chatRight) : 0;
    const right = tab ? Math.min(tab.x + tab.w + FOOT_REACH, stripRight) : 0;
    const next = right > left ? { left: Math.round(left), right: Math.round(right) } : null;
    if (next?.left === notch?.left && next?.right === notch?.right) return;
    notch = next;
    for (const listener of listeners) listener();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  get: () => notch,
};

export const useOpenTabNotch = (): OpenTabNotch => useSyncExternalStore(openTabNotch.subscribe, openTabNotch.get, openTabNotch.get);
