import { useEffect, useState } from "react";
import type { AccountHint } from "@stella/contracts/auth-session";

const CHANGED_EVENT = "stella:account-hint-changed";

export const readAccountHint = async (): Promise<AccountHint | null> => {
  try {
    return (await window.electronAPI?.system.getAccountHint?.()) ?? null;
  } catch {
    return null;
  }
};

export const accountHintChanged = () =>
  window.dispatchEvent(new Event(CHANGED_EVENT));

/** The account last signed in on this computer, if Stella still remembers it. */
export function useAccountHint(refreshKey?: unknown): AccountHint | null {
  const [hint, setHint] = useState<AccountHint | null>(null);
  useEffect(() => {
    let canceled = false;
    const load = () =>
      void readAccountHint().then((next) => {
        if (!canceled) setHint(next);
      });
    load();
    window.addEventListener(CHANGED_EVENT, load);
    return () => {
      canceled = true;
      window.removeEventListener(CHANGED_EVENT, load);
    };
  }, [refreshKey]);
  return hint;
}

export const accountLabel = (
  account: { email?: string | null; name?: string | null } | null | undefined,
): string | null => account?.email?.trim() || account?.name?.trim() || null;
