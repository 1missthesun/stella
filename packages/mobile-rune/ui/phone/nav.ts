import { useSyncExternalStore } from "react";
import { command, onEngineEvent } from "../../../desktop-rune/host/bridge";

/** The phone's places: the bottom bar's tabs, and the drawer beside the page (account at the start, chat settings at the end). */
export type PhoneTab = "chat" | "schedule" | "apps" | "files";
export type PhoneDrawer = "account" | "chat-settings" | null;

export const PHONE_TABS: readonly PhoneTab[] = ["chat", "schedule", "apps", "files"];

/**
 * `drawer` is the open drawer; `shown` is the one on screen, which stays while it springs shut so
 * the page can spring home over it (packages/mobile's `useDrawerLive`). `swiping`: a finger is
 * pulling a drawer open from the page.
 *
 * The drawer's progress itself lives in the engine (`mobile/stage.rs`), which moves it with the
 * finger and on React Native's springs frame by frame: TS hears only where a swipe starts, where
 * a lifted finger sends it and where it comes to rest, and asks it to open or shut.
 */
type Nav = { tab: PhoneTab; drawer: PhoneDrawer; shown: PhoneDrawer; swiping: boolean };
let nav: Nav = { tab: "chat", drawer: null, shown: null, swiping: false };
const listeners = new Set<() => void>();
let settleTimer: ReturnType<typeof setTimeout> | null = null;

/** In case the engine's word that the stage came to rest shut never comes. */
const CLOSE_SETTLE_MS = 1500;

const signOfDrawer = (d: PhoneDrawer) => (d === "chat-settings" ? -1 : 1);

function set(next: Partial<Nav>) {
  const merged = { ...nav, ...next };
  if (merged.tab === nav.tab && merged.drawer === nav.drawer && merged.shown === nav.shown && merged.swiping === nav.swiping) return;
  nav = merged;
  for (const l of listeners) l();
}

function settleLater() {
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = setTimeout(() => {
    settleTimer = null;
    if (!nav.drawer) set({ shown: null });
  }, CLOSE_SETTLE_MS);
}

function close(extra: Partial<Nav> = {}) {
  if (!nav.drawer && !nav.shown) return set(extra);
  set({ ...extra, drawer: null, swiping: false });
  command({ cmd: "stage", to: 0 });
  settleLater();
}

function open(drawer: Exclude<PhoneDrawer, null>) {
  if (settleTimer) clearTimeout(settleTimer);
  settleTimer = null;
  set({ drawer, shown: drawer, swiping: false });
  command({ cmd: "stage", sign: signOfDrawer(drawer), to: 1 });
}

onEngineEvent("stage", (e) => {
  if (e.kind === "swipe") {
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = null;
    const drawer = e.side === "start" ? "account" : "chat-settings";
    set({ drawer, shown: drawer, swiping: true });
  } else if (e.kind === "release") {
    if (e.open) set({ swiping: false, drawer: nav.drawer ?? nav.shown });
    else {
      set({ swiping: false, drawer: null });
      settleLater();
    }
  } else if (e.kind === "rest") {
    if (e.v <= 0 && !nav.drawer) {
      if (settleTimer) clearTimeout(settleTimer);
      settleTimer = null;
      set({ shown: null });
    }
  }
});

export const phoneNav = {
  selectTab: (tab: PhoneTab) => (nav.drawer ? close({ tab }) : set({ tab })),
  openDrawer: open,
  closeDrawer: () => close(),
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
