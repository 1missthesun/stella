import { useSyncExternalStore } from "react";

/** The phone's places: the bottom bar's tabs, and the drawer beside the page (account at the start, chat settings at the end). */
export type PhoneTab = "chat" | "schedule" | "apps" | "files";
export type PhoneDrawer = "account" | "chat-settings" | null;

export const PHONE_TABS: readonly PhoneTab[] = ["chat", "schedule", "apps", "files"];

/**
 * `drawer` is the open drawer; `shown` is the one on screen, which stays while it slides shut so
 * the page can spring home over it (packages/mobile's `useDrawerLive`). `drag` is a finger's
 * travel while it pulls the open drawer shut, in points along the drawer's own direction.
 */
type Nav = { tab: PhoneTab; drawer: PhoneDrawer; shown: PhoneDrawer; drag: number | null };
let nav: Nav = { tab: "chat", drawer: null, shown: null, drag: null };
const listeners = new Set<() => void>();
let settleTimer: ReturnType<typeof setTimeout> | null = null;

/** How long the page takes to spring home after a drawer closes, before the drawer stops drawing. */
const CLOSE_SETTLE_MS = 520;

function set(next: Partial<Nav>) {
  const merged = { ...nav, ...next };
  if (merged.tab === nav.tab && merged.drawer === nav.drawer && merged.shown === nav.shown && merged.drag === nav.drag) return;
  nav = merged;
  for (const l of listeners) l();
}

function close(extra: Partial<Nav> = {}) {
  if (!nav.drawer && !nav.shown) return set(extra);
  set({ ...extra, drawer: null, drag: null });
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    settleTimer = null;
    if (!nav.drawer) set({ shown: null });
  }, CLOSE_SETTLE_MS);
}

export const phoneNav = {
  selectTab: (tab: PhoneTab) => (nav.drawer ? close({ tab }) : set({ tab })),
  openDrawer: (drawer: Exclude<PhoneDrawer, null>) => {
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = null;
    set({ drawer, shown: drawer, drag: null });
  },
  closeDrawer: () => close(),
  /** A finger pulling the open drawer shut has travelled `toward` points toward closing it, since it pressed. */
  dragDrawer: (toward: number) => {
    if (!nav.drawer) return;
    set({ drag: Math.max(0, toward) });
  },
  /** The finger lifted: shut past a third of the travel, else spring back open. */
  releaseDrawer: (travel: number) => {
    if (!nav.drawer) return;
    if ((nav.drag ?? 0) > travel * 0.3) close();
    else set({ drag: null });
  },
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
