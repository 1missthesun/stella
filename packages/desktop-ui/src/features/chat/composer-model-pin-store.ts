import { useSyncExternalStore } from "react";
import { uiState } from "@/platform/ui-state";

const STORAGE_KEY = "stella.composer.showModelPicker";
const CHANGED_EVENT = "stella:composer-model-pin-changed";

const isPinned = (): boolean => {
  if (typeof window === "undefined") return false;
  return uiState.getItem(STORAGE_KEY) === "1";
};

const setPinned = (next: boolean): void => {
  if (typeof window === "undefined" || next === isPinned()) return;
  if (next) uiState.setItem(STORAGE_KEY, "1");
  else uiState.removeItem(STORAGE_KEY);
  window.dispatchEvent(new Event(CHANGED_EVENT));
};

const subscribe = (onChange: () => void): (() => void) => {
  const stopExternal = uiState.onExternalChange((key) => {
    if (key === STORAGE_KEY) onChange();
  });
  window.addEventListener(CHANGED_EVENT, onChange);
  return () => {
    stopExternal();
    window.removeEventListener(CHANGED_EVENT, onChange);
  };
};

export const composerModelPin = {
  isPinned,
  setPinned,
  toggle(): void {
    setPinned(!isPinned());
  },
};

export function useComposerModelPinned(): boolean {
  return useSyncExternalStore(subscribe, isPinned, () => false);
}
