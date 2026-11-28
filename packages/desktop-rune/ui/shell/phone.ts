import { useSyncExternalStore } from "react";

/** Whether this UI runs as the phone app (packages/mobile-rune sets `stella.phone` before the UI loads). */
export const onPhone = (): boolean => Boolean((globalThis as { stella?: { phone?: unknown } }).stella?.phone);

// Whether a phone page covers the chat whole (the Schedule, Apps and Files tabs are opaque over
// it): the chat then isn't drawn, glass and all, though it stays mounted and keeps its place.
let chatCovered = false;
const coveredListeners = new Set<() => void>();
export function setChatCovered(next: boolean) {
  if (chatCovered === next) return;
  chatCovered = next;
  for (const listener of coveredListeners) listener();
}
export const subscribeChatCovered = (listener: () => void) => {
  coveredListeners.add(listener);
  return () => {
    coveredListeners.delete(listener);
  };
};
export const isChatCovered = () => chatCovered;

// The phone's status bar height (its safe area's top), which the phone's chrome publishes for
// shared UI that reaches the top of the screen (the file viewer's top sheet).
let safeTop = 0;
const safeTopListeners = new Set<() => void>();
export function setPhoneSafeTop(next: number) {
  if (Math.abs(safeTop - next) < 0.5) return;
  safeTop = next;
  for (const listener of safeTopListeners) listener();
}
const subscribeSafeTop = (listener: () => void) => {
  safeTopListeners.add(listener);
  return () => {
    safeTopListeners.delete(listener);
  };
};
const readSafeTop = () => safeTop;
export const usePhoneSafeTop = () => useSyncExternalStore(subscribeSafeTop, readSafeTop, readSafeTop);

// The phone's Files tab keeps Drive pictures it has shown in its caches: a picture's file there, by Drive path,
// lets the file viewer's strip show it without downloading it again.
let cachedDrivePicture: ((drivePath: string) => string | null) | null = null;
export const setPhoneDrivePictures = (find: (drivePath: string) => string | null) => {
  cachedDrivePicture = find;
};
export const phoneDrivePicture = (drivePath: string): string | null => cachedDrivePicture?.(drivePath) ?? null;
