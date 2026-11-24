import type { WorkspaceApp } from "@stella/contracts/workspace-apps";
import { useSyncExternalStore } from "react";

export type AppsPageState = {
  apps: WorkspaceApp[] | null;
  error: string | null;
  opening: string | null;
  open: (app: WorkspaceApp) => void;
};

let state: AppsPageState | null = null;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const read = () => state;

export function publishAppsPage(next: AppsPageState | null): void {
  if (state === next) return;
  state = next;
  for (const listener of listeners) listener();
}

export function useAppsPage(): AppsPageState | null {
  return useSyncExternalStore(subscribe, read, read);
}
