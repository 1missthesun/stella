import { useSyncExternalStore } from "react";
import { uiState } from "@/platform/ui-state";
import type { DisplayTab, DisplayTabSpec, OpenTabOptions } from "./types";

type DisplayTabsState = {
  tabs: DisplayTab[];
  activeTabId: string | null;
  panelOpen: boolean;
  panelExpanded: boolean;
  panelWidth: number | null;
};
type TabListSnapshot = Pick<DisplayTabsState, "tabs" | "activeTabId">;
type LayoutSnapshot = Pick<
  DisplayTabsState,
  "panelOpen" | "panelExpanded" | "panelWidth"
>;
type NavSnapshot = {
  currentEntryId: string;
  canGoBack: boolean;
  canGoForward: boolean;
};
type Listener = () => void;
export const OVERVIEW_ENTRY_ID = "__overview__";
export const DISPLAY_PANEL_MIN_WIDTH = 320;
export const DISPLAY_MAIN_CONTENT_MIN_WIDTH = 352;
const STORAGE_KEY_WIDTH = "stella.displayPanel.width";
const STORAGE_KEY_EXPANDED = "stella.displayPanel.expanded";
const readPersistedWidth = (): number | null => {
  if (typeof window === "undefined") return null;
  const raw = uiState.getItem(STORAGE_KEY_WIDTH);
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
};
const readPersistedExpanded = (): boolean => {
  if (typeof window === "undefined") return false;
  return uiState.getItem(STORAGE_KEY_EXPANDED) === "1";
};
const writePersistedWidthNow = (width: number | null) => {
  if (typeof window === "undefined") return;
  if (width == null) uiState.removeItem(STORAGE_KEY_WIDTH);
  else uiState.setItem(STORAGE_KEY_WIDTH, String(Math.round(width)));
};
let pendingPersistedWidth: { value: number | null } | null = null;
let persistedWidthTimer: ReturnType<typeof setTimeout> | null = null;
const PERSIST_WIDTH_DEBOUNCE_MS = 150;
const flushPersistedWidth = () => {
  if (persistedWidthTimer) {
    clearTimeout(persistedWidthTimer);
    persistedWidthTimer = null;
  }
  if (!pendingPersistedWidth) return;
  writePersistedWidthNow(pendingPersistedWidth.value);
  pendingPersistedWidth = null;
};
const schedulePersistedWidth = (width: number | null) => {
  pendingPersistedWidth = { value: width };
  if (persistedWidthTimer) return;
  persistedWidthTimer = setTimeout(() => {
    persistedWidthTimer = null;
    flushPersistedWidth();
  }, PERSIST_WIDTH_DEBOUNCE_MS);
};
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushPersistedWidth);
  window.addEventListener("beforeunload", flushPersistedWidth);
}
const writePersistedExpanded = (expanded: boolean) => {
  if (typeof window === "undefined") return;
  if (expanded) uiState.setItem(STORAGE_KEY_EXPANDED, "1");
  else uiState.removeItem(STORAGE_KEY_EXPANDED);
};
const EMPTY_SNAPSHOT: DisplayTabsState = {
  tabs: [],
  activeTabId: null,
  panelOpen: false,
  panelExpanded: readPersistedExpanded(),
  panelWidth: readPersistedWidth(),
};
let state = EMPTY_SNAPSHOT;
let tabListSnapshot: TabListSnapshot = {
  tabs: state.tabs,
  activeTabId: state.activeTabId,
};
let layoutSnapshot: LayoutSnapshot = {
  panelOpen: state.panelOpen,
  panelExpanded: state.panelExpanded,
  panelWidth: state.panelWidth,
};
let nextOrd = 1;
const tabListListeners = new Set<Listener>();
const layoutListeners = new Set<Listener>();
let history: string[] = [OVERVIEW_ENTRY_ID];
let historyIndex = 0;
const navListeners = new Set<Listener>();
const computeNavSnapshot = (): NavSnapshot => ({
  currentEntryId: history[historyIndex] ?? OVERVIEW_ENTRY_ID,
  canGoBack: historyIndex > 0,
  canGoForward: historyIndex < history.length - 1,
});
let navSnapshot = computeNavSnapshot();
const emitNav = () => {
  navSnapshot = computeNavSnapshot();
  for (const listener of navListeners) listener();
};
const pushHistory = (entryId: string) => {
  if (history[historyIndex] === entryId) return;
  history = [...history.slice(0, historyIndex + 1), entryId];
  historyIndex = history.length - 1;
  emitNav();
};
const dropFromHistory = (entryId: string) => {
  const filtered = history.filter((id) => id !== entryId);
  const deduped: string[] = [];
  for (const id of filtered) {
    if (deduped[deduped.length - 1] !== id) deduped.push(id);
  }
  const next = deduped.length > 0 ? deduped : [OVERVIEW_ENTRY_ID];
  historyIndex = Math.min(historyIndex, next.length - 1);
  history = next;
  emitNav();
};
const emit = (
  next: DisplayTabsState,
  options: { tabsChanged?: boolean; layoutChanged?: boolean } = {},
) => {
  state = next;
  if (options.tabsChanged) {
    tabListSnapshot = { tabs: next.tabs, activeTabId: next.activeTabId };
    for (const listener of tabListListeners) listener();
  }
  if (options.layoutChanged) {
    layoutSnapshot = {
      panelOpen: next.panelOpen,
      panelExpanded: next.panelExpanded,
      panelWidth: next.panelWidth,
    };
    for (const listener of layoutListeners) listener();
  }
};
const findIndex = (snap: DisplayTabsState, tabId: string) =>
  snap.tabs.findIndex((tab) => tab.id === tabId);
export const displayTabs = {
  subscribeTabList(listener: Listener) {
    tabListListeners.add(listener);
    return () => {
      tabListListeners.delete(listener);
    };
  },
  subscribeLayout(listener: Listener) {
    layoutListeners.add(listener);
    return () => {
      layoutListeners.delete(listener);
    };
  },
  subscribeNav(listener: Listener) {
    navListeners.add(listener);
    return () => {
      navListeners.delete(listener);
    };
  },
  getSnapshot(): DisplayTabsState {
    return state;
  },
  getTabListSnapshot(): TabListSnapshot {
    return tabListSnapshot;
  },
  getLayoutSnapshot(): LayoutSnapshot {
    return layoutSnapshot;
  },
  getNavSnapshot(): NavSnapshot {
    return navSnapshot;
  },
  openTab(spec: DisplayTabSpec, opts: OpenTabOptions = {}) {
    const activate = opts.activate ?? true;
    const openPanel = opts.openPanel ?? (activate ? true : state.panelOpen);
    const existingIndex = findIndex(state, spec.id);
    let nextTabs: DisplayTab[];
    if (existingIndex === -1) {
      const tab = { ...spec, ord: nextOrd++ };
      nextTabs = [...state.tabs, tab];
    } else {
      const previous = state.tabs[existingIndex];
      const refreshed = { ...spec, ord: previous.ord };
      nextTabs = state.tabs.map((tab, idx) =>
        idx === existingIndex ? refreshed : tab,
      );
    }
    const nextActiveTabId = activate ? spec.id : (state.activeTabId ?? spec.id);
    emit(
      {
        ...state,
        tabs: nextTabs,
        activeTabId: nextActiveTabId,
        panelOpen: openPanel,
      },
      {
        tabsChanged: true,
        layoutChanged: openPanel !== state.panelOpen,
      },
    );
    if (activate) pushHistory(spec.id);
  },
  activateTab(tabId: string) {
    if (findIndex(state, tabId) === -1) return;
    if (state.activeTabId === tabId && state.panelOpen) {
      pushHistory(tabId);
      return;
    }
    const tabsChanged = state.activeTabId !== tabId;
    const layoutChanged = !state.panelOpen;
    emit(
      { ...state, activeTabId: tabId, panelOpen: true },
      { tabsChanged, layoutChanged },
    );
    pushHistory(tabId);
  },
  showOverview() {
    const layoutChanged = !state.panelOpen;
    if (layoutChanged) {
      emit({ ...state, panelOpen: true }, { layoutChanged: true });
    }
    pushHistory(OVERVIEW_ENTRY_ID);
  },
  back() {
    if (historyIndex <= 0) return;
    historyIndex -= 1;
    const entryId = history[historyIndex] ?? OVERVIEW_ENTRY_ID;
    if (entryId !== OVERVIEW_ENTRY_ID && findIndex(state, entryId) !== -1) {
      if (state.activeTabId !== entryId) {
        emit({ ...state, activeTabId: entryId }, { tabsChanged: true });
      }
    }
    emitNav();
  },
  forward() {
    if (historyIndex >= history.length - 1) return;
    historyIndex += 1;
    const entryId = history[historyIndex] ?? OVERVIEW_ENTRY_ID;
    if (entryId !== OVERVIEW_ENTRY_ID && findIndex(state, entryId) !== -1) {
      if (state.activeTabId !== entryId) {
        emit({ ...state, activeTabId: entryId }, { tabsChanged: true });
      }
    }
    emitNav();
  },
  closeTab(tabId: string) {
    const idx = findIndex(state, tabId);
    if (idx === -1) return;
    const remaining = state.tabs.filter((tab) => tab.id !== tabId);
    if (remaining.length === 0) {
      emit(
        { ...state, tabs: [], activeTabId: null, panelOpen: false },
        { tabsChanged: true, layoutChanged: state.panelOpen },
      );
      dropFromHistory(tabId);
      return;
    }
    let nextActive = state.activeTabId;
    if (state.activeTabId === tabId) {
      const fallback = remaining[idx - 1] ?? remaining[idx] ?? remaining[0];
      nextActive = fallback?.id ?? null;
    }
    emit(
      { ...state, tabs: remaining, activeTabId: nextActive },
      { tabsChanged: true },
    );
    dropFromHistory(tabId);
  },
  setPanelOpen(open: boolean) {
    if (state.panelOpen === open) return;
    emit({ ...state, panelOpen: open }, { layoutChanged: true });
  },
  reorderTab(tabId: string, targetIndex: number) {
    const idx = findIndex(state, tabId);
    if (idx === -1) return;
    const boundedTarget = Math.max(
      0,
      Math.min(targetIndex, state.tabs.length - 1),
    );
    if (idx === boundedTarget) return;
    const nextTabs = [...state.tabs];
    const [tab] = nextTabs.splice(idx, 1);
    if (!tab) return;
    nextTabs.splice(boundedTarget, 0, tab);
    emit({ ...state, tabs: nextTabs }, { tabsChanged: true });
  },
  setPanelExpanded(expanded: boolean) {
    if (state.panelExpanded === expanded) return;
    writePersistedExpanded(expanded);
    emit({ ...state, panelExpanded: expanded }, { layoutChanged: true });
  },
  togglePanelExpanded() {
    this.setPanelExpanded(!state.panelExpanded);
  },
  setPanelWidth(width: number | null) {
    if (state.panelWidth === width) return;
    schedulePersistedWidth(width);
    emit({ ...state, panelWidth: width }, { layoutChanged: true });
  },
  flushPersistedWidth,
  reset() {
    nextOrd = 1;
    writePersistedExpanded(false);
    writePersistedWidthNow(null);
    pendingPersistedWidth = null;
    if (persistedWidthTimer) {
      clearTimeout(persistedWidthTimer);
      persistedWidthTimer = null;
    }
    history = [OVERVIEW_ENTRY_ID];
    historyIndex = 0;
    emitNav();
    emit(
      {
        tabs: [],
        activeTabId: null,
        panelOpen: false,
        panelExpanded: false,
        panelWidth: null,
      },
      { tabsChanged: true, layoutChanged: true },
    );
  },
};
export const useDisplayTabList = () =>
  useSyncExternalStore(
    displayTabs.subscribeTabList,
    displayTabs.getTabListSnapshot,
    displayTabs.getTabListSnapshot,
  );
const useLayoutSlice = <T>(pick: (snapshot: LayoutSnapshot) => T) =>
  useSyncExternalStore(
    displayTabs.subscribeLayout,
    () => pick(displayTabs.getLayoutSnapshot()),
    () => pick(displayTabs.getLayoutSnapshot()),
  );
export const useDisplayPanelOpen = () => useLayoutSlice((s) => s.panelOpen);
export const useDisplayPanelExpanded = () =>
  useLayoutSlice((s) => s.panelExpanded);
