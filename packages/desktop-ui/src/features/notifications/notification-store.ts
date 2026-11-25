import { useEffect, useSyncExternalStore } from "react";
import { uiState } from "@/platform/ui-state";
import { openNotificationTarget } from "./notification-openers";

export type NotificationKind =
  | "device-change"
  | "update"
  | "email"
  | "sign-in"
  | "plan"
  | "problem"
  | "info";

export type NotificationOpener =
  | { open: "whats-new"; release?: string }
  | { open: "email" }
  | { open: "plans" }
  | { open: "models" };

export type NotificationAction = {
  label: string;
  primary?: boolean;
  disabled?: boolean;
  keep?: boolean;
  panelOnly?: boolean;
  lasting?: NotificationOpener;
  run: () => void | Promise<unknown>;
};

export type NotificationLink = {
  label: string;
  lasting?: NotificationOpener;
  run: () => void;
};

export type NotificationInput = {
  id: string;
  kind: NotificationKind;
  title: string;
  detail?: string;
  more?: NotificationLink;
  createdAt?: number;
  busy?: boolean;
  busyLabel?: string;
  actions?: NotificationAction[];
  toast?: boolean;
  onDismiss?: () => void;
};

export type AppNotification = {
  id: string;
  kind: NotificationKind;
  title: string;
  detail?: string;
  more?: NotificationLink;
  createdAt: number;
  busy?: boolean;
  busyLabel?: string;
  actions: NotificationAction[];
  live: boolean;
  unread: boolean;
  source: string | null;
};

export const NOTIFICATION_HISTORY_CAP = 200;
const HISTORY_PREFIX = "stella:notificationHistory:";
const REMOVED_CAP = 300;
const DETAIL_CHARS = 400;
const LEGACY_MEMORY_KEY = "stella.notifications";

type StoredLink = { label: string; opens: NotificationOpener };

type StoredEntry = {
  id: string;
  kind: NotificationKind;
  title: string;
  detail?: string;
  at: number;
  read?: true;
  more?: StoredLink;
  links?: StoredLink[];
};

type StoredHistory = { version: 1; entries: StoredEntry[]; removed: string[] };

type Live = { input: NotificationInput; source: string | null };

const KINDS: ReadonlySet<string> = new Set<NotificationKind>([
  "device-change",
  "update",
  "email",
  "sign-in",
  "plan",
  "problem",
  "info",
]);
const OPENERS: ReadonlySet<string> = new Set<NotificationOpener["open"]>([
  "whats-new",
  "email",
  "plans",
  "models",
]);

const historyKey = (scope: string) => `${HISTORY_PREFIX}${encodeURIComponent(scope)}`;

const parseOpener = (value: unknown): NotificationOpener | null => {
  if (typeof value !== "object" || value === null) return null;
  const { open, release } = value as { open?: unknown; release?: unknown };
  if (typeof open !== "string" || !OPENERS.has(open)) return null;
  if (open === "whats-new") return typeof release === "string" ? { open, release } : { open };
  return { open } as NotificationOpener;
};

const parseLink = (value: unknown): StoredLink | null => {
  if (typeof value !== "object" || value === null) return null;
  const { label, opens } = value as { label?: unknown; opens?: unknown };
  const opener = parseOpener(opens);
  return typeof label === "string" && opener ? { label, opens: opener } : null;
};

const parseEntry = (value: unknown): StoredEntry | null => {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== "string" || typeof raw.title !== "string") return null;
  if (typeof raw.kind !== "string" || !KINDS.has(raw.kind)) return null;
  if (typeof raw.at !== "number" || !Number.isFinite(raw.at)) return null;
  const more = parseLink(raw.more);
  const links = Array.isArray(raw.links)
    ? raw.links.map(parseLink).filter((link): link is StoredLink => link !== null)
    : [];
  return {
    id: raw.id,
    kind: raw.kind as NotificationKind,
    title: raw.title,
    ...(typeof raw.detail === "string" ? { detail: raw.detail } : {}),
    at: raw.at,
    ...(raw.read === true ? { read: true as const } : {}),
    ...(more ? { more } : {}),
    ...(links.length > 0 ? { links } : {}),
  };
};

const readHistory = (scope: string): StoredHistory | null => {
  try {
    const raw = JSON.parse(uiState.getItem(historyKey(scope)) ?? "null") as Partial<StoredHistory> | null;
    if (!raw || raw.version !== 1) return null;
    const entries = Array.isArray(raw.entries)
      ? raw.entries.map(parseEntry).filter((entry): entry is StoredEntry => entry !== null)
      : [];
    const removed = Array.isArray(raw.removed)
      ? raw.removed.filter((id): id is string => typeof id === "string")
      : [];
    return { version: 1, entries, removed };
  } catch {
    return null;
  }
};

type LegacyMemory = { dismissed: ReadonlySet<string>; seen: ReadonlySet<string>; toasted: ReadonlySet<string> };
let legacyMemory: LegacyMemory | null = null;

const legacy = (): LegacyMemory => {
  if (legacyMemory) return legacyMemory;
  const list = (value: unknown) =>
    new Set(Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);
  try {
    const raw = JSON.parse(uiState.getItem(LEGACY_MEMORY_KEY) ?? "null") as Record<string, unknown> | null;
    legacyMemory = { dismissed: list(raw?.dismissed), seen: list(raw?.seen), toasted: list(raw?.toasted) };
  } catch {
    legacyMemory = { dismissed: new Set(), seen: new Set(), toasted: new Set() };
  }
  return legacyMemory;
};

type State = {
  scope: string | null;
  owner: string | null;
  entries: StoredEntry[];
  removed: string[];
  live: ReadonlyMap<string, Live>;
  fresh: ReadonlySet<string>;
  toastId: string | null;
  running: ReadonlySet<string>;
  panelOpen: boolean;
};

let state: State = {
  scope: null,
  owner: null,
  entries: [],
  removed: [],
  live: new Map(),
  fresh: new Set(),
  toastId: null,
  running: new Set(),
  panelOpen: false,
};
const sources = new Map<string, readonly NotificationInput[]>();
const toastCandidates = new Set<string>();
const provisionalAt = new Set<string>();
const withdrawn = new Set<string>();
let resyncing = false;
let written: string | null = null;
let view: { from: State | null; items: AppNotification[] } = { from: null, items: [] };
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const prune = (from: State): State => {
  if (from.entries.length <= NOTIFICATION_HISTORY_CAP) return from;
  const newest = [...from.entries].sort((a, b) => b.at - a.at);
  const kept = new Set<string>();
  for (const entry of newest) if (from.live.get(entry.id)?.source) kept.add(entry.id);
  for (const entry of newest) {
    if (kept.size >= NOTIFICATION_HISTORY_CAP) break;
    kept.add(entry.id);
  }
  return {
    ...from,
    entries: from.entries.filter((entry) => kept.has(entry.id)),
    live: new Map([...from.live].filter(([id]) => kept.has(id))),
    ...(from.toastId && !kept.has(from.toastId) ? { toastId: null } : {}),
  };
};

const persist = () => {
  if (!state.scope || state.scope !== state.owner) return;
  const body = JSON.stringify({ version: 1, entries: state.entries, removed: state.removed } satisfies StoredHistory);
  if (body === written) return;
  written = body;
  uiState.setItem(historyKey(state.scope), body);
};

const set = (next: Partial<State>, options: { persist?: boolean } = {}) => {
  state = { ...state, ...next };
  if (next.entries) state = prune(state);
  if (options.persist !== false && (next.entries || next.removed)) persist();
  for (const listener of listeners) listener();
};

const clip = (text: string | undefined) =>
  text === undefined || text.length <= DETAIL_CHARS ? text : `${text.slice(0, DETAIL_CHARS - 1).trimEnd()}…`;

const toEntry = (input: NotificationInput, at: number, read: boolean): StoredEntry => {
  const links = (input.actions ?? []).flatMap((action) =>
    action.lasting ? [{ label: action.label, opens: action.lasting }] : [],
  );
  const detail = clip(input.detail);
  return {
    id: input.id,
    kind: input.kind,
    title: input.title,
    ...(detail ? { detail } : {}),
    at,
    ...(read ? { read: true as const } : {}),
    ...(input.more?.lasting ? { more: { label: input.more.label, opens: input.more.lasting } } : {}),
    ...(links.length > 0 ? { links } : {}),
  };
};

const sameEntry = (a: StoredEntry, b: StoredEntry) => JSON.stringify(a) === JSON.stringify(b);

const liveSignature = (input: NotificationInput) =>
  JSON.stringify([
    input.busy ?? false,
    input.busyLabel ?? "",
    input.more?.label ?? "",
    input.toast ?? true,
    (input.actions ?? []).map((action) => [action.label, action.primary, action.disabled, action.keep, action.panelOnly]),
  ]);

type Emission = "event" | "sync";

const upsert = (input: NotificationInput, source: string | null, emission: Emission): void => {
  const removedIndex = state.removed.indexOf(input.id);
  if (removedIndex >= 0 && emission === "sync") return;
  const revived = removedIndex >= 0;
  const existing = state.entries.find((entry) => entry.id === input.id);
  const wasLive = state.live.get(input.id);
  const now = Date.now();
  const recurred = emission === "event" && !wasLive && withdrawn.has(input.id);
  const at = input.createdAt ?? (existing && !recurred ? existing.at : now);
  if (state.owner === null && input.createdAt === undefined && !existing) provisionalAt.add(input.id);
  withdrawn.delete(input.id);
  const read = existing ? existing.read === true : state.panelOpen || legacy().seen.has(input.id);
  const entry = toEntry(input, at, read);
  const entryChanged = !existing || !sameEntry(existing, entry);
  const liveChanged = !wasLive || wasLive.source !== source || liveSignature(wasLive.input) !== liveSignature(input);

  if (wasLive && !liveChanged) {
    wasLive.input = input;
    if (!entryChanged) return;
  }

  const live = liveChanged ? new Map(state.live).set(input.id, { input, source }) : state.live;
  const next: Partial<State> = { live };
  if (entryChanged) {
    next.entries = existing
      ? state.entries.map((item) => (item.id === input.id ? entry : item))
      : [...state.entries, entry];
  }
  if (revived) next.removed = state.removed.filter((id) => id !== input.id);
  if (!existing && state.panelOpen) next.fresh = new Set([...state.fresh, input.id]);

  const firstSeen = !existing && !revived;
  const mayToast =
    firstSeen && !resyncing && input.toast !== false && !state.panelOpen && !legacy().toasted.has(input.id) && !read;
  if (mayToast) {
    if (state.owner === null) toastCandidates.add(input.id);
    else next.toastId = input.id;
  }
  set(next);
};

const end = (id: string): void => {
  if (!state.live.has(id)) return;
  withdrawn.add(id);
  const live = new Map(state.live);
  live.delete(id);
  set({ live });
};

const detach = (ids: readonly string[]): void => {
  const live = new Map(state.live);
  for (const id of ids) live.delete(id);
  if (live.size !== state.live.size) set({ live });
};

const markRead = (id: string): void => {
  if (!state.entries.some((entry) => entry.id === id && !entry.read)) return;
  set({ entries: state.entries.map((entry) => (entry.id === id ? { ...entry, read: true as const } : entry)) });
};

const forgetIds = (ids: ReadonlySet<string>) => {
  if (ids.size === 0) return;
  const live = new Map(state.live);
  for (const id of ids) {
    live.delete(id);
    toastCandidates.delete(id);
  }
  const fresh = new Set([...state.fresh].filter((id) => !ids.has(id)));
  const removed = [...state.removed.filter((id) => !ids.has(id)), ...ids].slice(-REMOVED_CAP);
  set({
    live,
    fresh,
    entries: state.entries.filter((entry) => !ids.has(entry.id)),
    removed,
    ...(state.toastId && ids.has(state.toastId) ? { toastId: null } : {}),
  });
};

export const notify = (input: NotificationInput): void => {
  upsert(input, null, "event");
};

export const withdrawNotification = (id: string): void => {
  end(id);
};

export const dismissNotification = (id: string): void => {
  const live = state.live.get(id);
  if (!live && !state.entries.some((entry) => entry.id === id)) return;
  forgetIds(new Set([id]));
  live?.input.onDismiss?.();
};

export const clearNotifications = (): void => {
  const ids = new Set([...state.entries.map((entry) => entry.id), ...state.live.keys()]);
  const dismissed = [...state.live.values()];
  forgetIds(ids);
  for (const live of dismissed) live.input.onDismiss?.();
};

export const runNotificationAction = async (id: string, shown: NotificationAction): Promise<void> => {
  if (state.running.has(id)) return;
  const action = state.live.get(id)?.input.actions?.find((entry) => entry.label === shown.label) ?? shown;
  markRead(id);
  set({ running: new Set([...state.running, id]) });
  try {
    await action.run();
  } finally {
    const running = new Set(state.running);
    running.delete(id);
    set({ running });
  }
  if (!action.keep) end(id);
};

export const openNotificationLink = (id: string, shown: NotificationLink): void => {
  const link = state.live.get(id)?.input.more ?? shown;
  markRead(id);
  link.run();
};

export const endNotificationToast = (id: string): void => {
  if (state.toastId === id) set({ toastId: null });
};

export const setNotificationPanelOpen = (open: boolean): void => {
  if (open === state.panelOpen) return;
  if (open) {
    const unread = state.entries.filter((entry) => !entry.read).map((entry) => entry.id);
    set({
      panelOpen: true,
      toastId: null,
      fresh: new Set(unread),
      ...(unread.length > 0
        ? { entries: state.entries.map((entry) => (entry.read ? entry : { ...entry, read: true as const })) }
        : {}),
    });
    return;
  }
  set({ panelOpen: false, fresh: new Set() });
};

const adopt = (scope: string) => {
  const stored = readHistory(scope);
  const loaded = stored?.entries ?? [];
  const removed = new Set([...(stored ? stored.removed : legacy().dismissed)]);
  const byId = new Map(loaded.map((entry) => [entry.id, entry]));
  for (const entry of state.entries) {
    const before = byId.get(entry.id);
    byId.set(
      entry.id,
      before
        ? {
            ...entry,
            ...(provisionalAt.has(entry.id) ? { at: before.at } : {}),
            ...(before.read ? { read: true as const } : {}),
          }
        : entry,
    );
  }
  provisionalAt.clear();
  for (const id of state.removed) removed.add(id);
  const entries = [...byId.values()].filter((entry) => !removed.has(entry.id));
  const live = new Map([...state.live].filter(([id]) => !removed.has(id)));
  const known = new Set(loaded.map((entry) => entry.id));
  const toast = [...toastCandidates]
    .filter((id) => !known.has(id) && live.has(id))
    .map((id) => entries.find((entry) => entry.id === id))
    .filter((entry): entry is StoredEntry => entry !== undefined && !entry.read)
    .sort((a, b) => b.at - a.at)[0];
  toastCandidates.clear();
  written = null;
  set({
    scope,
    owner: scope,
    entries,
    live,
    removed: [...removed].slice(-REMOVED_CAP),
    ...(toast && !state.panelOpen ? { toastId: toast.id } : {}),
  });
};

const switchTo = (scope: string) => {
  const stored = readHistory(scope);
  toastCandidates.clear();
  provisionalAt.clear();
  withdrawn.clear();
  written = null;
  state = {
    ...state,
    scope,
    owner: scope,
    entries: stored?.entries ?? [],
    removed: stored?.removed ?? [],
    live: new Map(),
    fresh: new Set(),
    toastId: null,
  };
  resyncing = true;
  try {
    for (const [source, items] of sources) syncNotificationSource(source, items);
  } finally {
    resyncing = false;
  }
  set({});
};

export const setNotificationAccountScope = (scopeInput: string | null): void => {
  const scope = scopeInput?.trim() || null;
  if (scope === state.scope) return;
  if (scope === null) {
    set({ scope: null }, { persist: false });
    return;
  }
  if (state.owner === null || state.owner === scope) adopt(scope);
  else switchTo(scope);
};

export const forgetNotificationHistory = (keep: string | null): void => {
  for (const key of uiState.keys()) {
    if (!key.startsWith(HISTORY_PREFIX)) continue;
    const scope = decodeURIComponent(key.slice(HISTORY_PREFIX.length));
    if (scope.startsWith("account:") && scope !== keep) uiState.removeItem(key);
  }
  if (state.owner?.startsWith("account:") && state.owner !== keep) {
    toastCandidates.clear();
    provisionalAt.clear();
    withdrawn.clear();
    written = null;
    set(
      {
        owner: null,
        scope: null,
        entries: state.entries.filter((entry) => state.live.has(entry.id)),
        removed: [],
        fresh: new Set(),
      },
      { persist: false },
    );
  }
};

uiState.onExternalChange((key) => {
  if (!state.scope || state.scope !== state.owner || key !== historyKey(state.scope)) return;
  const stored = readHistory(state.scope);
  written = uiState.getItem(key);
  const removed = new Set(stored?.removed ?? []);
  const entries = stored?.entries ?? [];
  const known = new Set(entries.map((entry) => entry.id));
  const live = new Map([...state.live].filter(([id]) => !removed.has(id)));
  const missing = [...live.values()]
    .filter((item) => !known.has(item.input.id))
    .map((item) => toEntry(item.input, item.input.createdAt ?? Date.now(), true));
  set({ entries: [...entries, ...missing], removed: [...removed], live }, { persist: missing.length > 0 });
});

const toLink = (stored: StoredLink): NotificationLink => ({
  label: stored.label,
  lasting: stored.opens,
  run: () => {
    setNotificationPanelOpen(false);
    openNotificationTarget(stored.opens);
  },
});

const derive = (from: State): AppNotification[] =>
  from.entries
    .map((entry): AppNotification => {
      const live = from.live.get(entry.id);
      const unread = !entry.read || from.fresh.has(entry.id);
      if (live) {
        return {
          id: entry.id,
          kind: entry.kind,
          title: entry.title,
          ...(entry.detail ? { detail: entry.detail } : {}),
          ...(live.input.more ? { more: live.input.more } : {}),
          createdAt: entry.at,
          ...(live.input.busy !== undefined ? { busy: live.input.busy } : {}),
          ...(live.input.busyLabel ? { busyLabel: live.input.busyLabel } : {}),
          actions: live.input.actions ?? [],
          live: true,
          unread,
          source: live.source,
        };
      }
      return {
        id: entry.id,
        kind: entry.kind,
        title: entry.title,
        ...(entry.detail ? { detail: entry.detail } : {}),
        ...(entry.more ? { more: toLink(entry.more) } : {}),
        createdAt: entry.at,
        actions: (entry.links ?? []).map((link) => ({ ...toLink(link), keep: true })),
        live: false,
        unread,
        source: null,
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt);

const items = () => {
  if (view.from !== state) view = { from: state, items: derive(state) };
  return view.items;
};

export const useNotifications = (): readonly AppNotification[] => useSyncExternalStore(subscribe, items);

export const useNotificationRunning = (): ReadonlySet<string> => useSyncExternalStore(subscribe, () => state.running);

export const useNotificationToast = (): AppNotification | null =>
  useSyncExternalStore(subscribe, () =>
    state.toastId ? (items().find((item) => item.id === state.toastId) ?? null) : null,
  );

export const useNotificationPanelOpen = (): boolean => useSyncExternalStore(subscribe, () => state.panelOpen);

export const useUnseenNotificationCount = (): number =>
  useSyncExternalStore(subscribe, () => {
    let count = 0;
    for (const entry of state.entries) if (!entry.read && state.live.has(entry.id)) count++;
    return count;
  });

const sourceIds = (source: string) =>
  [...state.live.entries()].filter(([, live]) => live.source === source).map(([id]) => id);

export const syncNotificationSource = (source: string, items: readonly NotificationInput[]): void => {
  sources.set(source, items);
  const wanted = new Set<string>();
  for (const item of items) {
    if (state.removed.includes(item.id)) continue;
    wanted.add(item.id);
    upsert(item, source, "sync");
  }
  for (const id of sourceIds(source)) {
    if (!wanted.has(id)) end(id);
  }
};

export const useNotificationSource = (source: string, items: readonly NotificationInput[]): void => {
  useEffect(() => {
    syncNotificationSource(source, items);
  });
  useEffect(
    () => () => {
      sources.delete(source);
      detach(sourceIds(source));
    },
    [source],
  );
};
