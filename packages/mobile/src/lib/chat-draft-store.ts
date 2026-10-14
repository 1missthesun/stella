import { useCallback, useSyncExternalStore } from "react";

export type ChatDraftStore = {
  get: () => string;
  set: (next: string | ((previous: string) => string)) => void;
  subscribe: (listener: () => void) => () => void;
};

export const createChatDraftStore = (initial = ""): ChatDraftStore => {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next) => {
      const resolved = typeof next === "function" ? next(value) : next;
      if (resolved === value) return;
      value = resolved;
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

export const useChatDraft = (store: ChatDraftStore): string =>
  useSyncExternalStore(store.subscribe, store.get, store.get);

export const useChatDraftSelector = <T extends string | number | boolean>(
  store: ChatDraftStore,
  select: (draft: string) => T,
): T => {
  const getSnapshot = useCallback(() => select(store.get()), [select, store]);
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
};
