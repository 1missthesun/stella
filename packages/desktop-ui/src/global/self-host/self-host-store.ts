import { useSyncExternalStore } from "react";
import type { DesktopServerState } from "@stella/contracts/desktop/self-host";

/**
 * Which self-host dialog is open: "Connect to your own server" (optionally
 * with a pairing link that arrived from the OS) or "Connect a device".
 */
export type SelfHostDialog =
  | { kind: "connect"; link: string | null }
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
  openConnect(link: string | null = null) {
    dialog = { kind: "connect", link };
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

/** The server this desktop install uses; null until main answers. */
export const useDesktopServerState = (): DesktopServerState | null => {
  loadServerState();
  return useSyncExternalStore(subscribe, () => serverState, () => null);
};
