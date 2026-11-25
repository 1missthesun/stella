import { useSyncExternalStore } from "react";
import { uiState } from "@/platform/ui-state";
import { getFileEntries } from "./files-index";
import { displayTabs } from "./tab-store";
import { fileViewer } from "./file-viewer-store";
import type { DisplayTab, DisplayTabKind } from "./types";

export const SIDEBAR_SECTIONS = [
  "home",
  "files",
  "apps",
  "browser",
  "schedule",
  "updates",
  "email",
  "takeover",
] as const;

export type SidebarSection = (typeof SIDEBAR_SECTIONS)[number];

export const isSidebarSection = (value: unknown): value is SidebarSection =>
  typeof value === "string" &&
  (SIDEBAR_SECTIONS as readonly string[]).includes(value);

const LEGACY_SECTION_ALIASES: Readonly<Record<string, SidebarSection>> = {
  tasks: "home",
  search: "home",
  settings: "home",
  quickchat: "home",
};

export const resolveSidebarSection = (value: unknown): SidebarSection => {
  if (isSidebarSection(value)) return value;
  if (typeof value === "string" && Object.hasOwn(LEGACY_SECTION_ALIASES, value))
    return LEGACY_SECTION_ALIASES[value];
  return "home";
};

const restoreTabKind = (
  value: unknown,
): { kind: SidebarSection; keepLocation: boolean } | null => {
  if (isSidebarSection(value)) return { kind: value, keepLocation: true };
  if (typeof value === "string" && Object.hasOwn(LEGACY_SECTION_ALIASES, value))
    return { kind: LEGACY_SECTION_ALIASES[value], keepLocation: false };
  return null;
};

const SINGLE_TAB_SECTIONS: ReadonlySet<SidebarSection> = new Set(["updates", "email", "schedule"]);

const SINGLE_EMPTY_TAB_SECTIONS: ReadonlySet<SidebarSection> = new Set([
  "apps",
  "browser",
  "files",
]);

const isSingleEmptyTab = (kind: SidebarSection, location: string | null) =>
  location === null && SINGLE_EMPTY_TAB_SECTIONS.has(kind);

const isSingletonTab = (kind: SidebarSection, location: string | null) =>
  SINGLE_TAB_SECTIONS.has(kind) || isSingleEmptyTab(kind, location);

const withoutRepeats = (tabs: SidebarTab[]): SidebarTab[] => {
  const seen = new Set<SidebarSection>();
  return tabs.filter((tab) => {
    if (!isSingletonTab(tab.kind, tab.location)) return true;
    if (seen.has(tab.kind)) return false;
    seen.add(tab.kind);
    return true;
  });
};

export type SidebarFileRecord = {
  title: string;
  kind: DisplayTabKind;
  payload?: unknown;
};

export type SidebarTab = {
  id: string;
  kind: SidebarSection;
  location: string | null;
  file?: SidebarFileRecord;
  unread?: boolean;
};

export type SidebarSectionsSnapshot = {
  tabs: SidebarTab[];
  activeTabId: string | null;
};

type Listener = () => void;

const STORAGE_KEY_TABS = "stella.topbar.tabs";
const STORAGE_KEY_SIDEBAR_TABS = "stella.sidebar.tabs";
const STORAGE_KEY_SECTION = "stella.sidebar.activeSection";
const STORAGE_KEY_LOCATIONS = "stella.sidebar.sectionLocations";
const STORAGE_KEY_OPEN_TABS = "stella.sidebar.openTabs";

const createTabId = (): string =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? `tab-${crypto.randomUUID()}`
    : `tab-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;

const makeTab = (
  kind: SidebarSection,
  location: string | null = null,
): SidebarTab => ({
  id: createTabId(),
  kind: resolveSidebarSection(kind),
  location: location ?? null,
});

const defaultTabs = (): SidebarTab[] => [];

const MAX_PERSISTED_FILE_PAYLOAD_CHARS = 32_000;

const fileRecordFrom = (
  title: string,
  kind: DisplayTabKind,
  payload: unknown,
): SidebarFileRecord => {
  if (payload === undefined) return { title, kind };
  const size = JSON.stringify(payload)?.length ?? 0;
  return size <= MAX_PERSISTED_FILE_PAYLOAD_CHARS
    ? { title, kind, payload }
    : { title, kind };
};

const resolveFileRecord = (location: string): SidebarFileRecord | undefined => {
  const spec = (displayTabs.getSnapshot().tabs as DisplayTab[]).find(
    (tab) => tab.id === location,
  );
  if (spec) return fileRecordFrom(spec.title, spec.kind, spec.payload);
  const entry = getFileEntries().find((item) => item.id === location);
  if (entry) return fileRecordFrom(entry.title, entry.kind, entry.payload);
  return undefined;
};

const withLocation = (
  tab: SidebarTab,
  kind: SidebarSection,
  location: string | null,
): SidebarTab => {
  const next: SidebarTab = { id: tab.id, kind, location };
  if (kind !== "files" || location === null) return next;
  if (tab.kind === kind && tab.location === location && tab.file) {
    return { ...next, file: tab.file };
  }
  const file = resolveFileRecord(location);
  return file ? { ...next, file } : next;
};

const readFileRecord = (value: unknown): SidebarFileRecord | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Partial<SidebarFileRecord>;
  if (typeof record.title !== "string" || typeof record.kind !== "string") {
    return undefined;
  }
  return {
    title: record.title,
    kind: record.kind as DisplayTabKind,
    ...(record.payload !== undefined ? { payload: record.payload } : {}),
  };
};

export const fileNameFromDisplayTabId = (location: string): string => {
  const withoutDrive = location.startsWith("drive:")
    ? location.slice("drive:".length)
    : location;
  const separator = withoutDrive.indexOf(":");
  const rest =
    separator > 0 ? withoutDrive.slice(separator + 1) : withoutDrive;
  const first = rest.split("|")[0] ?? rest;
  return first.split(/[\\/]/).filter(Boolean).pop() || first || "File";
};

/** A file or app with its own tab; it opens in the viewer, not the stage. */
export const isDocumentTab = (tab: SidebarTab): boolean =>
  tab.location !== null && (tab.kind === "files" || tab.kind === "apps");

type PersistedState = { tabs: SidebarTab[]; activeTabId: string | null };

const withActive = (
  tabs: SidebarTab[],
  activeTabId: string | null,
): string | null => {
  const places = tabs.filter((tab) => !isDocumentTab(tab));
  if (activeTabId && places.some((tab) => tab.id === activeTabId)) {
    return activeTabId;
  }
  return places[places.length - 1]?.id ?? null;
};

const migrateLegacyTabs = (): PersistedState | null => {
  if (typeof window === "undefined") return null;
  const rawOpenTabs = uiState.getItem(STORAGE_KEY_OPEN_TABS);
  if (!rawOpenTabs) return null;
  try {
    const parsedOpen: unknown = JSON.parse(rawOpenTabs);
    if (!Array.isArray(parsedOpen)) return null;
    const rawLocations = uiState.getItem(STORAGE_KEY_LOCATIONS);
    const locations: Record<string, unknown> = rawLocations
      ? (JSON.parse(rawLocations) as Record<string, unknown>)
      : {};
    const activeSection = resolveSidebarSection(
      uiState.getItem(STORAGE_KEY_SECTION),
    );
    const tabs: SidebarTab[] = [];
    for (const item of parsedOpen) {
      const restored = restoreTabKind(item);
      if (!restored) continue;
      const loc = restored.keepLocation ? locations[item as string] : undefined;
      tabs.push(
        makeTab(restored.kind, typeof loc === "string" && loc ? loc : null),
      );
    }
    if (tabs.length === 0) return null;
    const active =
      tabs.find((tab) => tab.kind === activeSection) ?? tabs[tabs.length - 1]!;
    return { tabs, activeTabId: active.id };
  } catch {
    return null;
  }
};

const keptFromSidebar = (tab: SidebarTab): boolean => {
  if (tab.kind === "browser") return true;
  if (tab.kind === "apps") return tab.location !== null;
  if (tab.kind === "files" && tab.location) {
    return tab.file?.kind === "canvas" || tab.location.startsWith("canvas:");
  }
  return false;
};

const fromSidebarLayout = (
  state: PersistedState | null,
): PersistedState | null => {
  if (!state) return null;
  const tabs = state.tabs.filter(keptFromSidebar);
  return { tabs, activeTabId: withActive(tabs, state.activeTabId) };
};

const readPersistedState = (): PersistedState => {
  if (typeof window === "undefined") {
    return { tabs: defaultTabs(), activeTabId: null };
  }
  if (uiState.getItem(STORAGE_KEY_TABS) === null) {
    const migrated =
      fromSidebarLayout(readSavedTabs(STORAGE_KEY_SIDEBAR_TABS)) ??
      fromSidebarLayout(migrateLegacyTabs());
    if (migrated) return migrated;
    return { tabs: defaultTabs(), activeTabId: null };
  }
  return (
    readSavedTabs(STORAGE_KEY_TABS) ?? { tabs: defaultTabs(), activeTabId: null }
  );
};

const readSavedTabs = (key: string): PersistedState | null => {
  const raw = uiState.getItem(key);
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        const record = parsed as { tabs?: unknown; activeTabId?: unknown };
        if (Array.isArray(record.tabs)) {
          const tabs: SidebarTab[] = [];
          for (const entry of record.tabs) {
            if (!entry || typeof entry !== "object") continue;
            const candidate = entry as Partial<SidebarTab>;
            if (typeof candidate.id !== "string") continue;
            const restored = restoreTabKind(candidate.kind);
            if (!restored) continue;
            if (restored.kind === "takeover") continue;
            if (restored.kind === "home") continue;
            const location =
              restored.keepLocation &&
              typeof candidate.location === "string" &&
              candidate.location
                ? candidate.location
                : null;
            const file =
              restored.kind === "files" && location !== null
                ? readFileRecord(candidate.file)
                : undefined;
            tabs.push({
              id: candidate.id,
              kind: restored.kind,
              location,
              ...(file ? { file } : {}),
              ...(candidate.unread === true ? { unread: true } : {}),
            });
          }
          const kept = withoutRepeats(tabs);
          if (kept.length > 0) {
            const activeTabId =
              typeof record.activeTabId === "string" ? record.activeTabId : null;
            return { tabs: kept, activeTabId: withActive(kept, activeTabId) };
          }
        }
      }
    } catch {}
  }
  return null;
};

let snapshot: SidebarSectionsSnapshot = readPersistedState();
if (snapshot.activeTabId === null) {
  snapshot = { ...snapshot, activeTabId: withActive(snapshot.tabs, null) };
}

const listeners = new Set<Listener>();

const persist = (next: SidebarSectionsSnapshot): void => {
  if (typeof window === "undefined") return;
  const tabs = next.tabs.filter((tab) => tab.kind !== "takeover");
  uiState.setItem(
    STORAGE_KEY_TABS,
    JSON.stringify({
      tabs,
      activeTabId: withActive(tabs, next.activeTabId),
    }),
  );
};

const emit = (next: SidebarSectionsSnapshot): void => {
  snapshot = next;
  persist(next);
  for (const listener of listeners) listener();
};

const activeTabOf = (state: SidebarSectionsSnapshot): SidebarTab | null =>
  state.tabs.find((tab) => tab.id === state.activeTabId) ?? null;

const isReusableNavTab = (tab: SidebarTab): boolean =>
  tab.location === null && (tab.kind === "files" || tab.kind === "apps");

export const sidebarSections = {
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  getSnapshot(): SidebarSectionsSnapshot {
    return snapshot;
  },

  hasLocation(section: SidebarSection, location: string): boolean {
    return snapshot.tabs.some(
      (tab) => tab.kind === section && tab.location === location,
    );
  },

  getActiveTab(): SidebarTab | null {
    return activeTabOf(snapshot);
  },

  openSectionTab(section: SidebarSection): void {
    const kind = resolveSidebarSection(section);
    const existing = isSingletonTab(kind, null)
      ? snapshot.tabs.find((tab) => tab.kind === kind && tab.location === null)
      : undefined;
    if (existing) {
      this.activateTab(existing.id);
    } else {
      const created = makeTab(kind, null);
      emit({ tabs: [...snapshot.tabs, created], activeTabId: created.id });
    }
    displayTabs.setPanelOpen(true);
  },

  openLocation(section: SidebarSection, location: string | null): void {
    const kind = resolveSidebarSection(section);
    const loc = location ?? null;

    if (loc !== null && (kind === "files" || kind === "apps")) {
      this.openDocument(kind, loc);
      return;
    }

    if (loc !== null || isSingletonTab(kind, loc)) {
      const existing = snapshot.tabs.find(
        (tab) =>
          tab.kind === kind &&
          (SINGLE_TAB_SECTIONS.has(kind) || tab.location === loc),
      );
      if (existing) {
        if (snapshot.activeTabId !== existing.id || existing.unread) {
          emit({
            tabs: snapshot.tabs.map((tab) =>
              tab.id === existing.id && tab.unread
                ? { ...tab, unread: false }
                : tab,
            ),
            activeTabId: existing.id,
          });
        }
        displayTabs.setPanelOpen(true);
        return;
      }
    }

    const active = activeTabOf(snapshot);
    if (
      active &&
      isReusableNavTab(active) &&
      displayTabs.getLayoutSnapshot().panelOpen
    ) {
      const tabs = snapshot.tabs.map((tab) =>
        tab.id === active.id ? withLocation(tab, kind, loc) : tab,
      );
      emit({ tabs, activeTabId: active.id });
    } else {
      const created = makeTab(kind, loc);
      const tab = withLocation(created, created.kind, created.location);
      emit({ tabs: [...snapshot.tabs, tab], activeTabId: tab.id });
    }
    displayTabs.setPanelOpen(true);
  },

  /** Gives a file or app its tab, read, without moving the stage to it. */
  openDocument(kind: "files" | "apps", location: string): void {
    const existing = snapshot.tabs.find(
      (tab) => tab.kind === kind && tab.location === location,
    );
    if (existing && !existing.unread) return;
    emit({
      ...snapshot,
      tabs: existing
        ? snapshot.tabs.map((tab) =>
            tab.id === existing.id ? { ...tab, unread: false } : tab,
          )
        : [...snapshot.tabs, withLocation(makeTab(kind, location), kind, location)],
    });
  },

  selectSection(section: SidebarSection): void {
    this.openLocation(section, null);
  },

  activateTab(tabId: string): void {
    const target = snapshot.tabs.find((tab) => tab.id === tabId);
    if (!target || isDocumentTab(target)) return;
    if (snapshot.activeTabId === tabId && !target.unread) return;
    emit({
      tabs: target.unread
        ? snapshot.tabs.map((tab) =>
            tab.id === tabId ? { ...tab, unread: false } : tab,
          )
        : snapshot.tabs,
      activeTabId: tabId,
    });
  },

  markRead(tabId: string): void {
    if (!snapshot.tabs.some((tab) => tab.id === tabId && tab.unread)) return;
    emit({
      ...snapshot,
      tabs: snapshot.tabs.map((tab) =>
        tab.id === tabId ? { ...tab, unread: false } : tab,
      ),
    });
  },

  addInBackground(section: SidebarSection, location: string): void {
    const kind = resolveSidebarSection(section);
    const existing = snapshot.tabs.find(
      (tab) => tab.kind === kind && tab.location === location,
    );
    const showing =
      existing !== undefined && fileViewer.surfaceOf(location) !== null;
    if (existing) {
      if (showing || existing.unread) return;
      emit({
        ...snapshot,
        tabs: snapshot.tabs.map((tab) =>
          tab.id === existing.id ? { ...tab, unread: true } : tab,
        ),
      });
      return;
    }
    const created = makeTab(kind, location);
    const tab = { ...withLocation(created, kind, location), unread: true };
    emit({ ...snapshot, tabs: [...snapshot.tabs, tab] });
  },

  moveTab(tabId: string, toIndex: number): void {
    const from = snapshot.tabs.findIndex((tab) => tab.id === tabId);
    if (from === -1) return;
    const to = Math.max(0, Math.min(snapshot.tabs.length - 1, toIndex));
    if (to === from) return;
    const tabs = [...snapshot.tabs];
    const [moved] = tabs.splice(from, 1);
    tabs.splice(to, 0, moved!);
    emit({ ...snapshot, tabs });
  },

  closeTab(tabId: string): void {
    const index = snapshot.tabs.findIndex((tab) => tab.id === tabId);
    if (index === -1) return;
    const closed = snapshot.tabs[index]!;
    const tabs = snapshot.tabs.filter((tab) => tab.id !== tabId);
    if (isDocumentTab(closed)) {
      emit({ ...snapshot, tabs });
      fileViewer.closeItem(closed.location!);
      return;
    }
    if (snapshot.activeTabId !== tabId) {
      emit({ ...snapshot, tabs });
      return;
    }
    const before = snapshot.tabs.slice(0, index).filter((tab) => !isDocumentTab(tab));
    const after = snapshot.tabs.slice(index + 1).filter((tab) => !isDocumentTab(tab));
    const next = after[0] ?? before[before.length - 1] ?? null;
    emit({ tabs, activeTabId: next?.id ?? null });
    if (!next) displayTabs.setPanelOpen(false);
  },

  rememberFile(
    tabId: string,
    location: string,
    title: string,
    kind: DisplayTabKind,
    payload: unknown,
  ): void {
    const tab = snapshot.tabs.find((item) => item.id === tabId);
    if (!tab || tab.kind !== "files" || tab.location !== location) return;
    if (
      tab.file &&
      tab.file.title === title &&
      tab.file.kind === kind &&
      (payload === undefined || tab.file.payload === payload)
    ) {
      return;
    }
    const file =
      payload === undefined && tab.file?.payload !== undefined
        ? { title, kind, payload: tab.file.payload }
        : fileRecordFrom(title, kind, payload);
    emit({
      ...snapshot,
      tabs: snapshot.tabs.map((item) =>
        item.id === tabId ? { ...item, file } : item,
      ),
    });
  },

  retargetFile(tabId: string, from: string, to: string): void {
    const tab = snapshot.tabs.find((item) => item.id === tabId);
    if (!tab || tab.kind !== "files" || tab.location !== from || from === to)
      return;
    emit({
      ...snapshot,
      tabs: snapshot.tabs.map((item) =>
        item.id === tabId ? { ...item, location: to } : item,
      ),
    });
  },

  reset(): void {
    emit({ tabs: defaultTabs(), activeTabId: null });
  },
};

export const useActiveSidebarSection = (): SidebarSection =>
  useSyncExternalStore(
    sidebarSections.subscribe,
    () => activeTabOf(sidebarSections.getSnapshot())?.kind ?? "home",
    () => activeTabOf(sidebarSections.getSnapshot())?.kind ?? "home",
  );

export const useSidebarOpenTabs = (): SidebarTab[] =>
  useSyncExternalStore(
    sidebarSections.subscribe,
    () => sidebarSections.getSnapshot().tabs,
    () => sidebarSections.getSnapshot().tabs,
  );

export const useSidebarActiveTabId = (): string | null =>
  useSyncExternalStore(
    sidebarSections.subscribe,
    () => sidebarSections.getSnapshot().activeTabId,
    () => sidebarSections.getSnapshot().activeTabId,
  );
