// The phone's Stella Views host: the newest version of every view in the conversation (from the
// orchestrator's `view` tool results, which carry the whole source), and one running session per
// view that every surface showing it shares (the chat card and the full screen), like the desktop's
// views host. A newer source swaps into the running session in place, keeping its state.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import { ViewSession, type ViewSnapshot, type ViewStorage } from "@stella/views/session";
import type { ViewTheme } from "@stella/views/protocol";
import { viewFileName, viewIdentityFromPath, viewKey, viewLiveKey } from "@stella/views/paths";
import { ViewStorageSync, backendViewStorageRemote, normalizeViewStorageRecord, syncedViewId, viewSlugFromPath, type ViewStorageDisk } from "@stella/views/storage-sync";
import { getBackendClient } from "../lib/backend";
import type { ChatMessage, ChatViewRef } from "../types";
import { nativeViewVm } from "./native-vm";
import { viewCapabilities } from "./view-capabilities";
import { onViewsAccount, viewsAccount } from "./views-account";

const KEEP_ALIVE_MS = 60_000;

type Newest = { messageId: string; ref: ChatViewRef };

let scope = "";
let generation = 0;
let newest = new Map<string, Newest>();
let lastMessages: readonly ChatMessage[] | null = null;
const newestListeners = new Set<() => void>();

/** Reads every view the conversation's replies made; the newest reply per file holds its live card. */
export function publishConversationViews(conversationId: string, messages: readonly ChatMessage[]) {
  if (messages === lastMessages && conversationId === scope) return;
  lastMessages = messages;
  const next = new Map<string, Newest>();
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (!message.views) continue;
    for (let v = message.views.length - 1; v >= 0; v -= 1) {
      const ref = message.views[v]!;
      // One view, wherever its copy lives (a computer's file, the cloud's Drive copy).
      const key = viewLiveKey(ref.filePath);
      if (!next.has(key)) next.set(key, { messageId: message.id, ref });
    }
  }
  const changed =
    conversationId !== scope ||
    next.size !== newest.size ||
    [...next].some(([file, entry]) => {
      const prior = newest.get(file);
      return !prior || prior.messageId !== entry.messageId || prior.ref !== entry.ref;
    });
  if (!changed) return;
  if (conversationId !== scope) {
    for (const entry of entries.values()) entry.dispose();
    entries.clear();
    generation += 1;
    if (fullScreen) setFullScreen(null);
  }
  scope = conversationId;
  newest = next;
  for (const [key, entry] of next) entries.get(key)?.load(entry.ref);
  for (const listener of newestListeners) listener();
}

const subscribeNewest = (listener: () => void) => {
  newestListeners.add(listener);
  return () => void newestListeners.delete(listener);
};

/** Whether `messageId` is the newest reply that made or changed the view at `file`. */
export function useIsLiveView(file: string, messageId: string): boolean {
  return useSyncExternalStore(subscribeNewest, () => newest.get(viewLiveKey(file))?.messageId === messageId);
}

export function useNewestView(file: string | null): ChatViewRef | null {
  return useSyncExternalStore(subscribeNewest, () => (file ? (newest.get(viewLiveKey(file))?.ref ?? null) : null));
}

// ------------------------------------------------------------------ storage

const storageKey = (file: string) => `stella-views:v1:${viewKey(file)}`;

function phoneStorage(file: string): ViewStorage {
  const key = storageKey(file);
  let values: Record<string, unknown> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const write = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      void AsyncStorage.setItem(key, JSON.stringify(values ?? {})).catch(() => undefined);
    }, 150);
  };
  return {
    load: async () => {
      if (!values) {
        try {
          const parsed = JSON.parse((await AsyncStorage.getItem(key)) ?? "{}") as unknown;
          values = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
        } catch {
          values = {};
        }
      }
      return { ...values };
    },
    set: async (k, value) => {
      (values ??= {})[k] = value;
      write();
    },
    remove: async (k) => {
      if (values) delete values[k];
      write();
    },
    clear: async () => {
      values = {};
      write();
    },
  };
}

/** What the view kept on this phone before it synced, for its first sync. */
const legacyPhoneStorage = async (file: string): Promise<Record<string, unknown> | null> => {
  try {
    const parsed = JSON.parse((await AsyncStorage.getItem(storageKey(file))) ?? "null") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) && Object.keys(parsed).length > 0 ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

/** Per account (records from before that are keyed by the view id alone, `v1`). */
const syncedKey = (viewId: string, account: string | null) => (account === null ? `stella-views:synced:v1:${viewId}` : `stella-views:synced:v2:${account}:${viewId}`);
const syncedDisk: ViewStorageDisk = {
  read: async (viewId, account) => {
    try {
      return normalizeViewStorageRecord(JSON.parse((await AsyncStorage.getItem(syncedKey(viewId, account))) ?? "null"));
    } catch {
      return null;
    }
  },
  write: (viewId, record, account) => AsyncStorage.setItem(syncedKey(viewId, account), JSON.stringify(record)),
};

/** Views' storage, synced through Stella Cloud as `<conversationId>/<slug>` (packages/views/src/storage-sync.ts), per account. */
const sync = new ViewStorageSync(syncedDisk, (message, detail) => console.warn(`[views] ${message}`, detail));
let remote: ReturnType<typeof backendViewStorageRemote> | null | undefined;
let listening = false;

/** Points views' storage at the signed-in account; on a switch, the running views restart on the new account's values. */
const connectSync = () => {
  const account = viewsAccount();
  if (account === undefined) return;
  if (remote === undefined) {
    try {
      remote = backendViewStorageRemote(getBackendClient());
    } catch {
      // No backend configured (a build without one): views keep their storage on the phone.
      remote = null;
    }
  }
  if (!listening) {
    listening = true;
    // Back in front (often back online too): replay what's queued instead of waiting out a retry.
    AppState.addEventListener("change", (state) => {
      if (state === "active") sync.retryNow();
    });
  }
  if (sync.connect(account, account ? remote : null) && entries.size > 0) {
    for (const entry of entries.values()) entry.dispose();
    entries.clear();
    generation += 1;
    for (const listener of newestListeners) listener();
  }
};
onViewsAccount(connectSync);

/** A view's storage: synced when the conversation (or the view's own path) names it, else on the phone alone. */
function viewStorage(file: string, ref: ChatViewRef): ViewStorage {
  const named = viewIdentityFromPath(file);
  const viewId = named ? syncedViewId(named.conversationId, named.slug) : scope ? syncedViewId(scope, ref.slug || viewSlugFromPath(file)) : null;
  if (!viewId) return phoneStorage(file);
  connectSync();
  return sync.storage(viewId, () => legacyPhoneStorage(file));
}

// ------------------------------------------------------------------ sessions

const requestFrame = (fn: (time: number) => void) => requestAnimationFrame(fn);
const now = () => performance.now();

class Entry {
  readonly session: ViewSession;
  refs = 0;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private loaded: ChatViewRef | null = null;

  constructor(
    /** The view's key in `entries` and `newest` (see `viewLiveKey`). */
    readonly key: string,
    readonly file: string,
    ref: ChatViewRef,
    theme: ViewTheme,
  ) {
    this.session = new ViewSession({
      id: file,
      title: ref.title,
      vm: nativeViewVm,
      storage: viewStorage(file, ref),
      capabilities: viewCapabilities,
      theme,
      data: ref.data ?? null,
      requestFrame,
      now,
      onLog: (log) => {
        if (__DEV__ || log.level === "error") console.log(`[view ${viewFileName(file)}] ${log.level}: ${log.text}`);
      },
    });
    if (__DEV__) {
      let seen = { first: null as number | null, swap: null as number | null };
      this.session.subscribe((s) => {
        if (s.firstRenderMs !== null && s.firstRenderMs !== seen.first) console.log(`[views] ${viewFileName(file)} first tree in ${s.firstRenderMs.toFixed(1)} ms`);
        if (s.swapMs !== null && s.swapMs !== seen.swap) console.log(`[views] ${viewFileName(file)} new source to tree in ${s.swapMs.toFixed(1)} ms`);
        seen = { first: s.firstRenderMs, swap: s.swapMs };
      });
    }
    this.load(ref);
  }

  load(ref: ChatViewRef) {
    if (this.loaded === ref) return;
    const prior = this.loaded;
    this.loaded = ref;
    if (prior && JSON.stringify(prior.data ?? null) !== JSON.stringify(ref.data ?? null)) this.session.setData(ref.data ?? null);
    void this.session.load(ref.source, viewFileName(ref.filePath));
  }

  acquire() {
    this.refs += 1;
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.closeTimer = null;
  }

  release() {
    this.refs -= 1;
    if (this.refs > 0) return;
    this.closeTimer = setTimeout(() => {
      if (this.refs > 0) return;
      this.dispose();
      entries.delete(this.key);
    }, KEEP_ALIVE_MS);
  }

  dispose() {
    if (this.closeTimer) clearTimeout(this.closeTimer);
    this.session.dispose();
  }
}

const entries = new Map<string, Entry>();

/** The running session of the view at `file` (its newest source) while the caller is mounted. */
export function useViewSession(file: string, theme: ViewTheme): { session: ViewSession | null; snapshot: ViewSnapshot | null } {
  const key = viewLiveKey(file);
  const hasRef = useSyncExternalStore(subscribeNewest, () => newest.has(key));
  const scopeGeneration = useSyncExternalStore(subscribeNewest, () => generation);
  const [session, setSession] = useState<ViewSession | null>(null);
  const [snapshot, setSnapshot] = useState<ViewSnapshot | null>(null);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  useEffect(() => {
    const current = newest.get(key)?.ref;
    if (!hasRef || !current) return;
    let entry = entries.get(key);
    if (!entry) {
      entry = new Entry(key, current.filePath, current, themeRef.current);
      entries.set(key, entry);
    }
    entry.acquire();
    const held = entry;
    setSession(held.session);
    setSnapshot(held.session.current);
    const off = held.session.subscribe(setSnapshot);
    return () => {
      off();
      held.release();
    };
  }, [key, hasRef, scopeGeneration]);
  useEffect(() => {
    session?.setTheme(theme);
  }, [session, theme]);
  return { session, snapshot };
}

// ------------------------------------------------------------------ full screen

let fullScreen: string | null = null;
const fullScreenListeners = new Set<() => void>();
const setFullScreen = (file: string | null) => {
  fullScreen = file;
  for (const listener of fullScreenListeners) listener();
};
const subscribeFullScreen = (listener: () => void) => {
  fullScreenListeners.add(listener);
  return () => void fullScreenListeners.delete(listener);
};

export const openViewFullScreen = (file: string) => setFullScreen(file);
export const closeViewFullScreen = () => setFullScreen(null);
export const useFullScreenView = () => useSyncExternalStore(subscribeFullScreen, () => fullScreen);
