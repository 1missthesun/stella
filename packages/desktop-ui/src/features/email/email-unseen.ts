import { serverNow } from "@stella/contracts/server-clock";
import { useMemo, useSyncExternalStore } from "react";
import { useBackendView } from "@/platform/backend/use-backend-view";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { useEmailFeature } from "./email-feature";

const KEY = "stella.email.seenAt";
const listeners = new Set<() => void>();

const read = (): number => {
  const stored = Number(window.localStorage.getItem(KEY));
  if (Number.isFinite(stored) && stored > 0) return stored;
  const now = serverNow();
  window.localStorage.setItem(KEY, String(now));
  return now;
};

let seenAt = read();

export const markEmailSeen = (): void => {
  seenAt = serverNow();
  window.localStorage.setItem(KEY, String(seenAt));
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useEmailPageView() {
  const { hasConnectedAccount } = useAuthSessionState();
  const on = useEmailFeature();
  return useBackendView("email.page", hasConnectedAccount && on ? {} : "skip");
}

export const useEmailSeenAt = (): number => useSyncExternalStore(subscribe, () => seenAt);

export function useEmailUnseenCount(): number {
  const items = useEmailPageView().value?.page.items;
  const seen = useEmailSeenAt();
  return useMemo(
    () => (items ?? []).filter((item) => item.section === "needs_you" && item.at > seen).length,
    [items, seen],
  );
}
