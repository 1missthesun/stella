import { useSyncExternalStore } from "react";
import { uiState } from "@/platform/ui-state";

type Listener = () => void;

const STORAGE_KEY = "stella.displayPanel.engineOverlayOpen";

const readPersistedOpen = (): boolean => {
  if (typeof window === "undefined") return false;
  return uiState.getItem(STORAGE_KEY) === "1";
};

const writePersistedOpen = (next: boolean): void => {
  if (typeof window === "undefined") return;
  if (next) uiState.setItem(STORAGE_KEY, "1");
  else uiState.removeItem(STORAGE_KEY);
};

let isOpen = readPersistedOpen();
const listeners = new Set<Listener>();

export type EngineOverlayFocus = { section: string; seq: number };
let focus: EngineOverlayFocus | null = null;

const emit = (): void => {
  writePersistedOpen(isOpen);
  for (const listener of listeners) listener();
};

const subscribe = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const engineOverlay = {
  isOpen: (): boolean => isOpen,
  setOpen(next: boolean): void {
    if (next === isOpen) return;
    isOpen = next;
    if (!isOpen) focus = null;
    emit();
  },
  toggle(): void {
    isOpen = !isOpen;
    if (!isOpen) focus = null;
    emit();
  },
  openAt(section: string): void {
    focus = { section, seq: (focus?.seq ?? 0) + 1 };
    isOpen = true;
    emit();
  },
};

export function useEngineOverlayFocus(): EngineOverlayFocus | null {
  return useSyncExternalStore(
    subscribe,
    () => focus,
    () => null,
  );
}

export function useEngineOverlayOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => isOpen,
    () => false,
  );
}
