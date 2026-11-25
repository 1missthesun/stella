import { useSyncExternalStore } from "react";
import type { CloudAppsState } from "./use-cloud-apps";

let state: CloudAppsState | null = null;
const listeners = new Set<() => void>();

export const publishCloudApps = (next: CloudAppsState | null): void => {
  if (state === next) return;
  state = next;
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useSharedCloudApps = (): CloudAppsState | null =>
  useSyncExternalStore(
    subscribe,
    () => state,
    () => null,
  );
