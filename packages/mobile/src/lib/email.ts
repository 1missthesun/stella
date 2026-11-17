import { useMemo, useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { authClient } from "./auth-client";
import { useEmailFeature } from "./email-feature";
import { useBackendView } from "./backend";

// When the Email page was last looked at on this phone. What Stella put under
// "Needs you" after it is unseen and badges the Email entry.
const SEEN_KEY = "stella.email.seenAt";
let seenAt = Number.POSITIVE_INFINITY;
const seenListeners = new Set<() => void>();
const setSeen = (at: number) => {
  seenAt = at;
  for (const listener of seenListeners) listener();
};
void AsyncStorage.getItem(SEEN_KEY)
  .then((raw) => {
    const stored = Number(raw);
    if (Number.isFinite(stored) && stored > 0) setSeen(stored);
    else {
      const now = Date.now();
      setSeen(now);
      void AsyncStorage.setItem(SEEN_KEY, String(now));
    }
  })
  .catch(() => setSeen(Date.now()));

export const markEmailSeen = (): void => {
  const now = Date.now();
  setSeen(now);
  void AsyncStorage.setItem(SEEN_KEY, String(now)).catch(() => undefined);
};

const subscribeSeen = (listener: () => void) => {
  seenListeners.add(listener);
  return () => seenListeners.delete(listener);
};

/** The Email page while Email runs here and the user is signed in. */
export function useEmailPageView() {
  const signedIn = Boolean(authClient.useSession().data?.user);
  const on = useEmailFeature();
  return useBackendView("email.page", signedIn && on ? {} : "skip");
}

/** Items that need the user and changed since the Email page was last open. */
export function useEmailUnseenCount(): number {
  const items = useEmailPageView().value?.page.items;
  const seen = useSyncExternalStore(subscribeSeen, () => seenAt);
  return useMemo(
    () => (items ?? []).filter((item) => item.section === "needs_you" && item.at > seen).length,
    [items, seen],
  );
}
