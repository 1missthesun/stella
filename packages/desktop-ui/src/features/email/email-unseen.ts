import { useMemo, useSyncExternalStore } from "react";
import { useBackendView } from "@/platform/backend/use-backend-view";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { useEmailFeature } from "./email-feature";

// When the Email page was last looked at on this computer. What Stella put
// under "Needs you" after it is unseen and badges the Email entry.
const KEY = "stella.email.seenAt";
const listeners = new Set<() => void>();

const read = (): number => {
  const stored = Number(window.localStorage.getItem(KEY));
  if (Number.isFinite(stored) && stored > 0) return stored;
  const now = Date.now();
  window.localStorage.setItem(KEY, String(now));
  return now;
};

let seenAt = read();

export const markEmailSeen = (): void => {
  seenAt = Date.now();
  window.localStorage.setItem(KEY, String(seenAt));
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The Email page while Email runs here and the user is signed in. */
export function useEmailPageView() {
  const { hasConnectedAccount } = useAuthSessionState();
  const on = useEmailFeature();
  return useBackendView("email.page", hasConnectedAccount && on ? {} : "skip");
}

/** When the Email page was last looked at on this computer. */
export const useEmailSeenAt = (): number => useSyncExternalStore(subscribe, () => seenAt);

/** Items that need the user and changed since the Email page was last open. */
export function useEmailUnseenCount(): number {
  const items = useEmailPageView().value?.page.items;
  const seen = useEmailSeenAt();
  return useMemo(
    () => (items ?? []).filter((item) => item.section === "needs_you" && item.at > seen).length,
    [items, seen],
  );
}
