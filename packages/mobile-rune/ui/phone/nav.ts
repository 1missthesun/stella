import { useSyncExternalStore } from "react";

/** The phone's places: the bottom bar's tabs, and the drawer beside the page (account at the start, chat settings at the end). */
export type PhoneTab = "chat" | "schedule" | "apps" | "files";
export type PhoneDrawer = "account" | "chat-settings" | null;

export const PHONE_TABS: readonly PhoneTab[] = ["chat", "schedule", "apps", "files"];

type Nav = { tab: PhoneTab; drawer: PhoneDrawer };
let nav: Nav = { tab: "chat", drawer: null };
const listeners = new Set<() => void>();

function set(next: Partial<Nav>) {
  const merged = { ...nav, ...next };
  if (merged.tab === nav.tab && merged.drawer === nav.drawer) return;
  nav = merged;
  for (const l of listeners) l();
}

export const phoneNav = {
  selectTab: (tab: PhoneTab) => set({ tab, drawer: null }),
  openDrawer: (drawer: Exclude<PhoneDrawer, null>) => set({ drawer }),
  closeDrawer: () => set({ drawer: null }),
  get: () => nav,
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
const read = () => nav;

export const usePhoneNav = () => useSyncExternalStore(subscribe, read, read);
