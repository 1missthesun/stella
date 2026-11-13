import { useEffect, useSyncExternalStore } from "react";
import { uiState } from "@/platform/ui-state";

export type NotificationKind =
  | "device-change"
  | "update"
  | "email"
  | "sign-in"
  | "plan"
  | "problem"
  | "info";

export type NotificationAction = {
  label: string;
  primary?: boolean;
  disabled?: boolean;
  /** The notification stays after this action (its source withdraws it when done). */
  keep?: boolean;
  run: () => void | Promise<unknown>;
};

export type NotificationInput = {
  /** Stable: the same id updates in place and never toasts twice. */
  id: string;
  kind: NotificationKind;
  title: string;
  detail?: string;
  createdAt?: number;
  /** An action of this notification is under way (e.g. "Adding…"). */
  busy?: boolean;
  busyLabel?: string;
  actions?: NotificationAction[];
  /** Default true: a new notification first shows as a toast under the bell. */
  toast?: boolean;
  onDismiss?: () => void;
};

export type AppNotification = Omit<NotificationInput, "createdAt"> & {
  createdAt: number;
  source: string | null;
};

const MEMORY_KEY = "stella.notifications";
const MEMORY_CAP = 300;

type Memory = { dismissed: string[]; seen: string[]; toasted: string[] };

const readMemory = (): Memory => {
  try {
    const raw = JSON.parse(uiState.getItem(MEMORY_KEY) ?? "null") as Partial<Memory> | null;
    const list = (value: unknown) =>
      Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
    return { dismissed: list(raw?.dismissed), seen: list(raw?.seen), toasted: list(raw?.toasted) };
  } catch {
    return { dismissed: [], seen: [], toasted: [] };
  }
};

const remember = (field: keyof Memory, ids: readonly string[]) => {
  const memory = readMemory();
  const known = new Set(memory[field]);
  const added = ids.filter((id) => !known.has(id));
  if (added.length === 0) return;
  memory[field] = [...memory[field], ...added].slice(-MEMORY_CAP);
  uiState.setItem(MEMORY_KEY, JSON.stringify(memory));
};

const forget = (field: keyof Memory, id: string) => {
  const memory = readMemory();
  if (!memory[field].includes(id)) return;
  memory[field] = memory[field].filter((entry) => entry !== id);
  uiState.setItem(MEMORY_KEY, JSON.stringify(memory));
};

const isRemembered = (field: keyof Memory, id: string) => readMemory()[field].includes(id);

type State = {
  items: AppNotification[];
  toastId: string | null;
  running: ReadonlySet<string>;
  panelOpen: boolean;
};

let state: State = { items: [], toastId: null, running: new Set(), panelOpen: false };
const listeners = new Set<() => void>();

const set = (next: Partial<State>) => {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const signature = (item: NotificationInput | AppNotification) =>
  JSON.stringify([
    item.kind,
    item.title,
    item.detail ?? "",
    item.busy ?? false,
    item.busyLabel ?? "",
    item.createdAt ?? 0,
    (item.actions ?? []).map((action) => [action.label, action.primary, action.disabled, action.keep]),
  ]);

const upsert = (input: NotificationInput, source: string | null): void => {
  const existing = state.items.find((item) => item.id === input.id);
  if (existing) {
    const next: AppNotification = {
      ...input,
      createdAt: input.createdAt ?? existing.createdAt,
      source,
    };
    if (signature(next) === signature(existing)) {
      Object.assign(existing, { actions: input.actions, onDismiss: input.onDismiss });
      return;
    }
    set({ items: state.items.map((item) => (item.id === input.id ? next : item)) });
    return;
  }
  const item: AppNotification = { ...input, createdAt: input.createdAt ?? Date.now(), source };
  const toast =
    input.toast !== false && !state.panelOpen && !isRemembered("toasted", item.id) && !isRemembered("seen", item.id);
  if (state.panelOpen) remember("seen", [item.id]);
  if (toast) remember("toasted", [item.id]);
  set({ items: [...state.items, item], ...(toast ? { toastId: item.id } : {}) });
};

const remove = (id: string): AppNotification | undefined => {
  const item = state.items.find((entry) => entry.id === id);
  if (!item) return undefined;
  set({
    items: state.items.filter((entry) => entry.id !== id),
    ...(state.toastId === id ? { toastId: null } : {}),
  });
  return item;
};

/** Show a notification now (an event). A dismissed id shows again when notified again. */
export const notify = (input: NotificationInput): void => {
  forget("dismissed", input.id);
  upsert(input, null);
};

/** Take a notification away without the person dismissing it (it was dealt with elsewhere). */
export const withdrawNotification = (id: string): void => {
  remove(id);
};

export const dismissNotification = (id: string): void => {
  const item = remove(id);
  if (!item) return;
  if (item.source) remember("dismissed", [id]);
  item.onDismiss?.();
};

export const clearNotifications = (): void => {
  for (const item of [...state.items]) dismissNotification(item.id);
};

export const runNotificationAction = async (
  id: string,
  action: NotificationAction,
): Promise<void> => {
  if (state.running.has(id)) return;
  set({ running: new Set([...state.running, id]) });
  try {
    await action.run();
  } finally {
    const running = new Set(state.running);
    running.delete(id);
    set({ running });
  }
  if (!action.keep) remove(id);
};

export const endNotificationToast = (id: string): void => {
  if (state.toastId === id) set({ toastId: null });
};

export const setNotificationPanelOpen = (open: boolean): void => {
  if (open) {
    remember("seen", state.items.map((item) => item.id));
    set({ panelOpen: true, toastId: null });
    return;
  }
  set({ panelOpen: false });
};

const byNewest = (a: AppNotification, b: AppNotification) => b.createdAt - a.createdAt;

export const useNotifications = (): readonly AppNotification[] => {
  const items = useSyncExternalStore(subscribe, () => state.items);
  return [...items].sort(byNewest);
};

export const useNotificationRunning = (): ReadonlySet<string> =>
  useSyncExternalStore(subscribe, () => state.running);

export const useNotificationToast = (): AppNotification | null =>
  useSyncExternalStore(subscribe, () =>
    state.toastId ? (state.items.find((item) => item.id === state.toastId) ?? null) : null,
  );

export const useNotificationPanelOpen = (): boolean =>
  useSyncExternalStore(subscribe, () => state.panelOpen);

/** How many notifications the person hasn't seen in the panel yet. */
export const useUnseenNotificationCount = (): number =>
  useSyncExternalStore(subscribe, () => {
    if (state.items.length === 0) return 0;
    const seen = new Set(readMemory().seen);
    return state.items.filter((item) => !seen.has(item.id)).length;
  });

const sourceIds = (source: string) =>
  state.items.filter((item) => item.source === source).map((item) => item.id);

/**
 * Keep the notifications of one source equal to `items`, a list derived from
 * live state: new ones appear (once; a dismissed id stays dismissed), changed
 * ones update, and ones no longer listed are withdrawn.
 */
export const syncNotificationSource = (source: string, items: readonly NotificationInput[]): void => {
  const wanted = new Set<string>();
  for (const item of items) {
    if (isRemembered("dismissed", item.id)) continue;
    wanted.add(item.id);
    upsert(item, source);
  }
  for (const id of sourceIds(source)) {
    if (!wanted.has(id)) remove(id);
  }
};

export const useNotificationSource = (source: string, items: readonly NotificationInput[]): void => {
  useEffect(() => {
    syncNotificationSource(source, items);
  });
  useEffect(
    () => () => {
      for (const id of sourceIds(source)) remove(id);
    },
    [source],
  );
};
