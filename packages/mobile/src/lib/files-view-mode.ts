import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

export type FilesViewMode = "grid" | "list";

const KEY = "stella-mobile:files-view";

let mode: FilesViewMode = "grid";
let loaded = false;
const listeners = new Set<() => void>();

const apply = (next: FilesViewMode) => {
  if (next === mode) return;
  mode = next;
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  if (!loaded) {
    loaded = true;
    void AsyncStorage.getItem(KEY)
      .then((stored) => {
        if (stored === "list" || stored === "grid") apply(stored);
      })
      .catch(() => undefined);
  }
  return () => {
    listeners.delete(listener);
  };
};

const read = () => mode;

export const useFilesViewMode = (): FilesViewMode =>
  useSyncExternalStore(subscribe, read, read);

export const setFilesViewMode = (next: FilesViewMode): void => {
  loaded = true;
  apply(next);
  void AsyncStorage.setItem(KEY, next).catch(() => undefined);
};
