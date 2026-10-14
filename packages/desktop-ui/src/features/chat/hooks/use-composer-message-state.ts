import { useState, useSyncExternalStore } from "react";
import type { Dispatch, SetStateAction } from "react";

export const resolveSetStateAction = <T,>(
  action: SetStateAction<T>,
  current: T,
): T =>
  typeof action === "function"
    ? (action as (prev: T) => T)(current)
    : action;

export interface ComposerMessageStore {
  getSnapshot: () => string;
  subscribe: (listener: () => void) => () => void;
}

export interface ComposerMessageStoreState {
  store: ComposerMessageStore;
  setMessage: Dispatch<SetStateAction<string>>;
}

const createComposerMessageStore = (
  initialValue: string,
): ComposerMessageStoreState => {
  let message = initialValue;
  const listeners = new Set<() => void>();
  return {
    store: {
      getSnapshot: () => message,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    setMessage: (action) => {
      const next = resolveSetStateAction(action, message);
      if (next === message) return;
      message = next;
      for (const listener of [...listeners]) listener();
    },
  };
};

export function useComposerMessageStore(
  initialValue = "",
): ComposerMessageStoreState {
  const [state] = useState(() => createComposerMessageStore(initialValue));
  return state;
}

export const useComposerMessage = (store: ComposerMessageStore): string =>
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

export const useComposerMessageSelector = <T,>(
  store: ComposerMessageStore,
  select: (message: string) => T,
): T => {
  const getSelected = () => select(store.getSnapshot());
  return useSyncExternalStore(store.subscribe, getSelected, getSelected);
};
