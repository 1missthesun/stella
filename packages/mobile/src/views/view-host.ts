// The phone's Stella Views host: the newest version of every view in the conversation (from the
// orchestrator's `view` tool results, which carry the whole source), and one running session per
// view that every surface showing it shares (the chat card and the full screen), like the desktop's
// views host. A newer source swaps into the running session in place, keeping its state.
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ViewSession, type ViewSnapshot, type ViewStorage } from "@stella/views/session";
import type { ViewTheme } from "@stella/views/protocol";
import { viewFileName, viewKey } from "@stella/views/paths";
import type { ChatMessage, ChatViewRef } from "../types";
import { nativeViewVm } from "./native-vm";
import { viewCapabilities } from "./view-capabilities";

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
      if (!next.has(ref.filePath)) next.set(ref.filePath, { messageId: message.id, ref });
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
  for (const [file, entry] of next) entries.get(file)?.load(entry.ref);
  for (const listener of newestListeners) listener();
}

const subscribeNewest = (listener: () => void) => {
  newestListeners.add(listener);
  return () => void newestListeners.delete(listener);
};

/** Whether `messageId` is the newest reply that made or changed the view at `file`. */
export function useIsLiveView(file: string, messageId: string): boolean {
  return useSyncExternalStore(subscribeNewest, () => newest.get(file)?.messageId === messageId);
}

export function useNewestView(file: string | null): ChatViewRef | null {
  return useSyncExternalStore(subscribeNewest, () => (file ? (newest.get(file)?.ref ?? null) : null));
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

// ------------------------------------------------------------------ sessions

const requestFrame = (fn: (time: number) => void) => requestAnimationFrame(fn);
const now = () => performance.now();

class Entry {
  readonly session: ViewSession;
  refs = 0;
  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private loaded: ChatViewRef | null = null;

  constructor(
    readonly file: string,
    ref: ChatViewRef,
    theme: ViewTheme,
  ) {
    this.session = new ViewSession({
      id: file,
      title: ref.title,
      vm: nativeViewVm,
      storage: phoneStorage(file),
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
      entries.delete(this.file);
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
  const hasRef = useSyncExternalStore(subscribeNewest, () => newest.has(file));
  const scopeGeneration = useSyncExternalStore(subscribeNewest, () => generation);
  const [session, setSession] = useState<ViewSession | null>(null);
  const [snapshot, setSnapshot] = useState<ViewSnapshot | null>(null);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  useEffect(() => {
    const current = newest.get(file)?.ref;
    if (!hasRef || !current) return;
    let entry = entries.get(file);
    if (!entry) {
      entry = new Entry(file, current, themeRef.current);
      entries.set(file, entry);
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
  }, [file, hasRef, scopeGeneration]);
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
