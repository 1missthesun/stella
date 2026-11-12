import { useSyncExternalStore } from "react";

let requested = false;
/** Where the request lands: the chat, or the Email page for an urgent-email notification. */
let requestedTab: "chat" | "email" = "chat";
const listeners = new Set<() => void>();

const publish = (next: boolean) => {
  if (requested === next) return;
  requested = next;
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => requested;

export function requestMainChat(tab: "chat" | "email" = "chat"): void {
  requestedTab = tab;
  publish(true);
}

/** The tab the last request asked for; read it right after taking the request. */
export function requestedMainTab(): "chat" | "email" {
  const tab = requestedTab;
  requestedTab = "chat";
  return tab;
}

export function takeMainChatRequest(): boolean {
  const was = requested;
  publish(false);
  return was;
}

export function useMainChatRequested(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
