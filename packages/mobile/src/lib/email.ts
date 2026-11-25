import { serverNow } from "@stella/contracts/server-clock";
import { useMemo, useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { authClient } from "./auth-client";
import { useEmailFeature } from "./email-feature";
import { useBackendView } from "./backend";

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
      const now = serverNow();
      setSeen(now);
      void AsyncStorage.setItem(SEEN_KEY, String(now));
    }
  })
  .catch(() => setSeen(serverNow()));

export const markEmailSeen = (): void => {
  const now = serverNow();
  setSeen(now);
  void AsyncStorage.setItem(SEEN_KEY, String(now)).catch(() => undefined);
};

const subscribeSeen = (listener: () => void) => {
  seenListeners.add(listener);
  return () => seenListeners.delete(listener);
};

export function useEmailPageView() {
  const signedIn = Boolean(authClient.useSession().data?.user);
  const on = useEmailFeature();
  return useBackendView("email.page", signedIn && on ? {} : "skip");
}

export function useEmailUnseenCount(): number {
  const items = useEmailPageView().value?.page.items;
  const seen = useSyncExternalStore(subscribeSeen, () => seenAt);
  return useMemo(
    () => (items ?? []).filter((item) => item.section === "needs_you" && item.at > seen).length,
    [items, seen],
  );
}
