import { useSyncExternalStore } from "react";
import type { DesktopServerState } from "@stella/contracts/desktop/self-host";

export type SelfHostDialog =
  | { kind: "connect"; link: string | null; notice?: string }
  | { kind: "device" }
  | null;

let dialog: SelfHostDialog = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const selfHostDialogs = {
  openConnect(link: string | null = null, notice?: string) {
    dialog = { kind: "connect", link, notice };
    emit();
  },
  openDevice() {
    dialog = { kind: "device" };
    emit();
  },
  close() {
    if (!dialog) return;
    dialog = null;
    emit();
  },
};

export const useSelfHostDialog = () =>
  useSyncExternalStore(subscribe, () => dialog, () => null);

let serverState: DesktopServerState | null = null;
let serverStateLoading: Promise<void> | null = null;

const loadServerState = () => {
  serverStateLoading ??= (async () => {
    const api = window.electronAPI?.selfHost;
    if (!api) return;
    try {
      serverState = await api.getState();
      emit();
    } catch {
      // Older main process: no server switching.
    }
  })();
};

export const useDesktopServerState = (): DesktopServerState | null => {
  loadServerState();
  return useSyncExternalStore(subscribe, () => serverState, () => null);
};
