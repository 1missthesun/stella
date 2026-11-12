import { useMemo, useSyncExternalStore } from "react";
import { useBackendView } from "@/platform/backend/use-backend-view";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { useEmailFeature } from "./email-feature";

// When the Email section was last looked at on this computer. Sorted mail that
// arrived after it is "unseen" and badges the Email entry; the chat itself only
// ever shows the newest email line.
const KEY = "stella.email.seenAt";
const listeners = new Set<() => void>();

const read = (): number => {
  const stored = Number(window.localStorage.getItem(KEY));
  if (Number.isFinite(stored) && stored > 0) return stored;
  // First run on this computer: start counting from now, not from the whole week.
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

/** Items on Today that arrived (or came back from Later) since the Email section was last open. */
export function useEmailUnseenCount(): number {
  const { hasConnectedAccount } = useAuthSessionState();
  const on = useEmailFeature();
  const open = useBackendView("email.today", hasConnectedAccount && on ? {} : "skip").value?.open;
  const seen = useSyncExternalStore(subscribe, () => seenAt);
  return useMemo(
    () => (open ?? []).filter((matter) => Math.max(matter.arrivedAt, matter.returnedAt ?? 0) > seen).length,
    [open, seen],
  );
}

/** When the Email section was last looked at on this computer. */
export const useEmailSeenAt = (): number => useSyncExternalStore(subscribe, () => seenAt);
