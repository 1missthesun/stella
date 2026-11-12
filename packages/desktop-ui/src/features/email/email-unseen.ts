import { useMemo, useSyncExternalStore } from "react";
import { useEmailFeedItems } from "./email-items";

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

/** Sorted mail worth showing that arrived since the Email section was last open. */
export function useEmailUnseenCount(): number {
  const { items } = useEmailFeedItems();
  const seen = useSyncExternalStore(subscribe, () => seenAt);
  return useMemo(() => {
    if (!items) return 0;
    let count = 0;
    for (const item of items.values()) {
      if (item.bucket !== "noise" && item.state !== "dismissed" && item.receivedAt > seen) count += 1;
    }
    return count;
  }, [items, seen]);
}
