// `globalThis.stella.views` on the web (stella.sh/chat): the desktop's views host
// (host/views/views-host.ts) for a browser. There is no file to watch here, so the source comes from
// the conversation: the orchestrator's `view` tool results carry each version whole, and the newest
// one for a file is the view that runs (an agent's edit arrives as a new result and swaps in, keeping
// its state). Programs run in PsychoScript's WebAssembly in a worker each (wasm-vm.ts), storage is
// kept in IndexedDB (storage.ts), and the capabilities are the browser's (capabilities.ts).
import { ViewSession, type ViewSnapshot } from "@stella/views/session";
import type { ViewTheme } from "@stella/views/protocol";
import { latestConversationViews, type ConversationView, type ViewToolEvent } from "@stella/views/conversation";
import { isViewPath, viewFileName, viewKey, viewTitle } from "@stella/views/paths";
import { browserCapabilities } from "./capabilities";
import { MovableViewStorage, ViewStorageSync, backendViewStorageRemote, syncedViewId, viewSlugFromPath, type ViewStorageBackend } from "@stella/views/storage-sync";
import { browserStorage, browserSyncedDisk, legacyBrowserStorage } from "./storage";
import { createWasmVm, preloadViews } from "./wasm-vm";

const KEEP_ALIVE_MS = 60_000;
/** How long an open view waits for its source to arrive with the conversation before it says so. */
const SOURCE_WAIT_MS = 4_000;

type Entry = {
  session: ViewSession;
  filePath: string;
  storage: MovableViewStorage;
  viewId: string | null;
  refs: number;
  closeTimer: ReturnType<typeof setTimeout> | null;
  waitTimer: ReturnType<typeof setTimeout> | null;
  source: string | null;
  data: string | null;
};

type Message = { toolEvents?: readonly ViewToolEvent[] };

const asWeb = (theme: ViewTheme): ViewTheme => (theme.platform === "web" ? theme : { ...theme, platform: "web" });

export function createWebViewsHost() {
  const entries = new Map<string, Entry>();
  /** The newest version of each view the conversations shown so far carry. */
  const known = new Map<string, ConversationView>();
  /** Each message's views, by its tool events array, so a new message doesn't rescan the others. */
  const scanned = new WeakMap<readonly ViewToolEvent[], Map<string, ConversationView>>();
  /** Which synced view each file is (`<conversationId>/<slug>`), from the conversation that made it. */
  const identities = new Map<string, string>();
  const sync = new ViewStorageSync(browserSyncedDisk(), (message, detail) => console.warn(`[views] ${message}`, detail));
  if (typeof window !== "undefined") window.addEventListener("online", () => sync.retryNow());
  const syncedStorage = (filePath: string, viewId: string) => sync.storage(viewId, () => legacyBrowserStorage(viewKey(filePath)));
  const bind = (entry: Entry, viewId: string) => {
    if (entry.viewId === viewId) return;
    entry.viewId = viewId;
    void entry.storage.move(syncedStorage(entry.filePath, viewId));
  };
  const vm = createWasmVm();
  const caps = browserCapabilities();
  const now = () => performance.now();
  const requestFrame = (fn: (time: number) => void) => {
    requestAnimationFrame(() => fn(now()));
  };

  const apply = (entry: Entry) => {
    const view = known.get(entry.filePath);
    if (!view) return;
    if (entry.waitTimer) clearTimeout(entry.waitTimer);
    entry.waitTimer = null;
    const data = view.data === undefined ? null : JSON.stringify(view.data);
    if (data !== entry.data) {
      entry.data = data;
      entry.session.setData(view.data ?? null);
    }
    if (view.source === entry.source) return;
    entry.source = view.source;
    void entry.session.load(view.source, viewFileName(entry.filePath));
  };

  const open = (filePath: string, theme: ViewTheme): Entry => {
    const existing = entries.get(filePath);
    if (existing) {
      if (existing.closeTimer) clearTimeout(existing.closeTimer);
      existing.closeTimer = null;
      return existing;
    }
    const view = known.get(filePath);
    const viewId = identities.get(filePath) ?? null;
    const storage = new MovableViewStorage(viewId ? syncedStorage(filePath, viewId) : browserStorage(viewKey(filePath)));
    const session = new ViewSession({
      id: viewKey(filePath),
      title: view?.title ?? viewTitle(filePath),
      vm,
      storage,
      capabilities: caps,
      theme: asWeb(theme),
      data: view?.data ?? null,
      requestFrame,
      now,
      onLog: (log) => {
        if (log.level === "error") console.error(`[view ${viewFileName(filePath)}] ${log.text}`);
      },
    });
    const entry: Entry = { session, filePath, storage, viewId, refs: 0, closeTimer: null, waitTimer: null, source: null, data: view?.data === undefined ? null : JSON.stringify(view.data) };
    entries.set(filePath, entry);
    if (view) apply(entry);
    else
      entry.waitTimer = setTimeout(() => {
        entry.waitTimer = null;
        if (!entry.source) session.report("source", "This view's source isn't in this conversation. It shows here once an agent writes it with the view tool.");
      }, SOURCE_WAIT_MS);
    return entry;
  };

  const close = (filePath: string) => {
    const entry = entries.get(filePath);
    if (!entry) return;
    if (entry.waitTimer) clearTimeout(entry.waitTimer);
    entry.session.dispose();
    entries.delete(filePath);
  };

  const withEntry = (filePath: string, fn: (entry: Entry) => void) => {
    const entry = entries.get(filePath);
    if (entry) fn(entry);
  };

  const offer = (view: ConversationView) => {
    const previous = known.get(view.filePath);
    if (previous && previous.createdAt > view.createdAt) return;
    if (previous && previous.source === view.source && previous.data === view.data) return;
    known.set(view.filePath, view);
    const entry = entries.get(view.filePath);
    if (entry) apply(entry);
  };

  return {
    isViewPath,
    /** Opens (or shares) the view at `filePath` and calls `listener` with each snapshot; returns the release. */
    subscribe(filePath: string, theme: ViewTheme, listener: (snapshot: ViewSnapshot) => void): () => void {
      const entry = open(filePath, theme);
      entry.refs += 1;
      entry.session.setTheme(asWeb(theme));
      const off = entry.session.subscribe(listener);
      listener(entry.session.current);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        off();
        entry.refs -= 1;
        if (entry.refs > 0) return;
        entry.closeTimer = setTimeout(() => close(filePath), KEEP_ALIVE_MS);
      };
    },
    snapshot: (filePath: string): ViewSnapshot | null => entries.get(filePath)?.session.current ?? null,
    dispatch: (filePath: string, handler: number, value?: unknown) => withEntry(filePath, (e) => e.session.dispatch(handler, value)),
    key: (filePath: string, chord: string) => withEntry(filePath, (e) => e.session.key(chord)),
    viewport: (filePath: string, width: number, height: number) => withEntry(filePath, (e) => e.session.setViewport(width, height)),
    theme: (filePath: string, theme: ViewTheme) => withEntry(filePath, (e) => e.session.setTheme(asWeb(theme))),
    restart: (filePath: string) => withEntry(filePath, (e) => void e.session.restart()),
    logs: (filePath: string) => entries.get(filePath)?.session.logs.slice() ?? [],
    reload: (filePath: string) =>
      withEntry(filePath, (e) => {
        e.source = null;
        apply(e);
      }),
    /** The signed-in account's backend, which views' storage syncs through; null while signed out. */
    connectBackend(client: ViewStorageBackend | null) {
      sync.setRemote(client ? backendViewStorageRemote(client) : null);
    },
    syncState: (filePath: string): { viewId: string | null; connected: boolean; synced: boolean } | null => {
      const entry = entries.get(filePath);
      if (!entry) return null;
      const target = entry.storage.target as { synced?: boolean };
      return { viewId: entry.viewId, connected: sync.connected, synced: target.synced ?? true };
    },
    /** The views a conversation carries (its messages' `view` tool results): the newest of each runs. */
    offerMessages(messages: readonly Message[], conversationId?: string | null) {
      let any = false;
      for (const message of messages) {
        const events = message.toolEvents;
        if (!events?.length) continue;
        let views = scanned.get(events);
        if (!views) {
          views = latestConversationViews(events);
          scanned.set(events, views);
        }
        for (const view of views.values()) {
          any = true;
          const viewId = conversationId ? syncedViewId(conversationId, view.slug ?? viewSlugFromPath(view.filePath)) : null;
          if (viewId) identities.set(view.filePath, viewId);
          offer(view);
          const entry = entries.get(view.filePath);
          if (entry && viewId) bind(entry, viewId);
        }
      }
      // A view is on its way to the screen: start compiling the WebAssembly now.
      if (any) preloadViews();
    },
  };
}

export type WebViewsHost = ReturnType<typeof createWebViewsHost>;
