// App state lives here, outside the hot-swapped app modules, so a live edit keeps it.

import { useSyncExternalStore } from "react";

export type Message = { id: string; role: "user" | "assistant"; text: string; at: string };

export type AppState = {
  dark: boolean;
  sidebarOpen: boolean;
  messages: Message[];
  draft: string;
  activeChat: string;
  error: string | null;
  swaps: number;
  lastSwapMs: number | null;
  preview: string | null;
  /** The launch splash has gone: it shows once a run, as desktop-ui's `#stella-launch` does, not again per swap. */
  launched?: boolean;
};

type Listener = () => void;

export function createStore(initial: AppState) {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => state,
    set(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
      const p = typeof patch === "function" ? patch(state) : patch;
      state = { ...state, ...p };
      for (const l of listeners) l();
    },
    subscribe(l: Listener) { listeners.add(l); return () => listeners.delete(l); },
  };
}

export type Store = ReturnType<typeof createStore>;

/** Selector hook the app uses (reached through globalThis.stella so the app bundle shares it). */
export function makeUseStore(store: Store) {
  return function useStore<T>(sel: (s: AppState) => T): T {
    return useSyncExternalStore(store.subscribe, () => sel(store.get()));
  };
}
