// `globalThis.stella.views` on the web (stella.sh/chat): the desktop's views host
// (host/views/views-host.ts) for a browser. There is no file to watch here, so the source comes from
// the conversation: the orchestrator's `view` tool results carry each version whole, and the newest
// one for a file is the view that runs (an agent's edit arrives as a new result and swaps in, keeping
// its state). Programs run in PsychoScript's WebAssembly in a worker each (wasm-vm.ts), storage is
// kept in IndexedDB (storage.ts), and the capabilities are the browser's (capabilities.ts).
import { ViewSession, type ViewCapabilities, type ViewSnapshot } from "@stella/views/session";
import type { ViewTheme } from "@stella/views/protocol";
import { latestConversationViews, viewOwnedBy, type ConversationView, type ViewToolEvent } from "@stella/views/conversation";
import { isViewPath, viewFileName, viewIdentityFromPath, viewKey, viewTitle } from "@stella/views/paths";
import { browserCapabilities } from "./capabilities";
import { MovableViewStorage, ViewStorageSync, backendViewStorageRemote, syncedViewId, viewSlugFromPath, type ViewStorageBackend, type ViewStorageRemote } from "@stella/views/storage-sync";
import { browserStorage, browserSyncedDisk, legacyBrowserStorage } from "./storage";
import { ViewHistory, previewStorage, restoreCardArgs, restoredVersion, viewPreviewKey, type ViewPublishBackend, type ViewVersion } from "@stella/views/history";
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
  /** A preview of an older version (its own run beside the live one): the source it runs. */
  preview?: string;
};

type Message = { toolEvents?: readonly ViewToolEvent[] };

const asWeb = (theme: ViewTheme): ViewTheme => (theme.platform === "web" ? theme : { ...theme, platform: "web" });

export type WebViewsHostOptions = {
  /** Narrows the browser's capabilities (a shared view on stella.sh has no Stella to ask or chat to send to). */
  capabilities?: (browser: ViewCapabilities) => ViewCapabilities;
};

export function createWebViewsHost(options: WebViewsHostOptions = {}) {
  const entries = new Map<string, Entry>();
  /** The newest version of each view the conversations shown so far carry. */
  const known = new Map<string, ConversationView>();
  /** Each message's views, by its tool events array, so a new message doesn't rescan the others. */
  const scanned = new WeakMap<readonly ViewToolEvent[], Map<string, ConversationView>>();
  /** Which synced view each file is (`<conversationId>/<slug>`), from the conversation that made it. */
  const identities = new Map<string, string>();
  const sync = new ViewStorageSync(browserSyncedDisk(), (message, detail) => console.warn(`[views] ${message}`, detail));
  /** Every version of each view the conversations carry, the restores made here, and what's being previewed. */
  const history = new ViewHistory();
  let backend: (ViewStorageBackend & Partial<ViewPublishBackend>) | null = null;
  if (typeof window !== "undefined") window.addEventListener("online", () => sync.retryNow());
  const remotes = new WeakMap<ViewStorageBackend, ViewStorageRemote>();
  const remoteFor = (client: ViewStorageBackend): ViewStorageRemote => {
    let remote = remotes.get(client);
    if (!remote) remotes.set(client, (remote = backendViewStorageRemote(client)));
    return remote;
  };
  const syncedStorage = (filePath: string, viewId: string) => sync.storage(viewId, () => legacyBrowserStorage(viewKey(filePath)));
  const bind = (entry: Entry, viewId: string) => {
    if (entry.viewId === viewId) return;
    entry.viewId = viewId;
    void entry.storage.move(syncedStorage(entry.filePath, viewId));
  };
  const vm = createWasmVm();
  const noticeListeners = new Set<(notice: { filePath: string; kind: "copied" }) => void>();
  const browserCaps = browserCapabilities((viewId, kind) => {
    const entry = [...entries.values()].find((e) => e.session.id === viewId);
    if (entry) for (const listener of noticeListeners) listener({ filePath: entry.filePath, kind });
  });
  const caps = options.capabilities ? options.capabilities(browserCaps) : browserCaps;
  const now = () => performance.now();
  const requestFrame = (fn: (time: number) => void) => {
    requestAnimationFrame(() => fn(now()));
  };

  const apply = (entry: Entry) => {
    if (entry.preview !== undefined) {
      if (entry.source === entry.preview) return;
      entry.source = entry.preview;
      void entry.session.load(entry.preview, "preview.view.tsx");
      return;
    }
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
    void entry.session.load(view.source, viewFileName(entry.filePath), { freshIfStateBreaks: view.by?.kind === "restore" });
  };

  const open = (filePath: string, theme: ViewTheme): Entry => {
    const existing = entries.get(filePath);
    if (existing) {
      if (existing.closeTimer) clearTimeout(existing.closeTimer);
      existing.closeTimer = null;
      return existing;
    }
    const view = known.get(filePath);
    const named = viewIdentityFromPath(filePath);
    const viewId = identities.get(filePath) ?? (named ? syncedViewId(named.conversationId, named.slug) : null);
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

  /** An older version, run beside the live view: it starts from the view's saved values and data as they are now, and keeps its changes to itself. */
  const openPreview = (filePath: string, version: ViewVersion, theme: ViewTheme): Entry => {
    const key = viewPreviewKey(filePath, version.id);
    const existing = entries.get(key);
    if (existing) {
      if (existing.closeTimer) clearTimeout(existing.closeTimer);
      existing.closeTimer = null;
      return existing;
    }
    const live = entries.get(filePath);
    const storage = new MovableViewStorage(previewStorage(live?.storage ?? null));
    const session = new ViewSession({ id: viewKey(key), title: version.title, vm, storage, capabilities: caps, theme: asWeb(theme), data: known.get(filePath)?.data ?? null, requestFrame, now });
    const entry: Entry = { session, filePath: key, storage, viewId: null, refs: 0, closeTimer: null, waitTimer: null, source: null, data: null, preview: version.source };
    entries.set(key, entry);
    apply(entry);
    return entry;
  };

  const attach = (entry: Entry, theme: ViewTheme, listener: (snapshot: ViewSnapshot) => void, keepAliveMs: number): (() => void) => {
    if (entry.closeTimer) clearTimeout(entry.closeTimer);
    entry.closeTimer = null;
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
      entry.closeTimer = setTimeout(() => close(entry.filePath), keepAliveMs);
    };
  };

  /** Makes `versionId` the view's newest version again, as a new version (so it can be undone too), on every device. */
  const restore = async (filePath: string, versionId: string): Promise<{ restored: boolean; shared: boolean; error?: string }> => {
    const target = history.find(filePath, versionId);
    if (!target) return { restored: false, shared: false, error: "That version isn't in this conversation any more." };
    const conversationId = history.conversationOf(filePath);
    if (!conversationId || !backend?.call) return { restored: false, shared: false, error: "Restoring needs Stella Cloud, which isn't connected." };
    const args = restoreCardArgs(target, history.latest(filePath), conversationId, Date.now());
    const version = restoredVersion(args);
    history.addPending(version);
    history.setPreview(filePath, null);
    // Here at once; the conversation brings the same version back (and to every other device).
    const prior = known.get(filePath);
    offer({ filePath, slug: args.slug, title: args.title, source: args.source, createdAt: args.createdAt, by: version.by, ...(prior?.data !== undefined ? { data: prior.data } : {}) });
    try {
      const { posted } = await backend.call("conversations.publishView", args);
      return { restored: true, shared: posted };
    } catch (error) {
      console.error("[views] couldn't publish a restore:", error);
      return { restored: true, shared: false, error: error instanceof Error ? error.message : String(error) };
    }
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
      return attach(open(filePath, theme), theme, listener, KEEP_ALIVE_MS);
    },
    history: (filePath: string): readonly ViewVersion[] => history.versions(filePath),
    previewing: (filePath: string): ViewVersion | null => history.preview(filePath),
    setPreview: (filePath: string, versionId: string | null) => history.setPreview(filePath, versionId),
    onHistory: (listener: (filePath: string) => void): (() => void) => history.subscribe(listener),
    subscribePreview(filePath: string, versionId: string, theme: ViewTheme, listener: (snapshot: ViewSnapshot) => void): () => void {
      const version = history.find(filePath, versionId);
      if (!version) {
        listener({ status: "failed", tree: null, rev: 0, problem: { phase: "history", message: "That version isn't in this conversation any more." }, keys: [], firstRenderMs: null, swapMs: null });
        return () => undefined;
      }
      return attach(openPreview(filePath, version, theme), theme, listener, 5_000);
    },
    restore,
    snapshot: (filePath: string): ViewSnapshot | null => entries.get(filePath)?.session.current ?? null,
    dispatch: (filePath: string, handler: number, value?: unknown) => withEntry(filePath, (e) => e.session.dispatch(handler, value)),
    key: (filePath: string, chord: string) => withEntry(filePath, (e) => e.session.key(chord)),
    viewport: (filePath: string, width: number, height: number) => withEntry(filePath, (e) => e.session.setViewport(width, height)),
    theme: (filePath: string, theme: ViewTheme) => withEntry(filePath, (e) => e.session.setTheme(asWeb(theme))),
    restart: (filePath: string) => withEntry(filePath, (e) => void e.session.restart()),
    logs: (filePath: string) => entries.get(filePath)?.session.logs.slice() ?? [],
    onNotice(listener: (notice: { filePath: string; kind: "copied" }) => void): () => void {
      noticeListeners.add(listener);
      return () => noticeListeners.delete(listener);
    },
    reload: (filePath: string) =>
      withEntry(filePath, (e) => {
        e.source = null;
        apply(e);
      }),
    /**
     * The signed-in account (`account:<userId>`) and its backend, which views' storage syncs
     * and restores publish through; a null client while signed out. Each account keeps its own
     * copy of every view's storage: after a switch, open views move onto the new account's.
     */
    connectBackend(client: (ViewStorageBackend & Partial<ViewPublishBackend>) | null, account: string | null) {
      backend = client;
      if (!sync.connect(client ? account : null, client ? remoteFor(client) : null)) return;
      for (const entry of entries.values()) {
        if (!entry.viewId) continue;
        void entry.storage.move(syncedStorage(entry.filePath, entry.viewId));
      }
    },
    syncState: (filePath: string): { viewId: string | null; account: string | null; connected: boolean; synced: boolean } | null => {
      const entry = entries.get(filePath);
      if (!entry) return null;
      const target = entry.storage.target as { synced?: boolean; account?: string | null };
      return { viewId: entry.viewId, account: target.account ?? null, connected: sync.connected, synced: target.synced ?? true };
    },
    /** The views a conversation carries (its messages' `view` tool results): the newest of each runs. */
    offerMessages(messages: readonly Message[], conversationId?: string | null) {
      history.offerMessages(messages, conversationId);
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
          if (!viewOwnedBy(view, conversationId)) continue;
          any = true;
          // A view in a chat's own folder is named by its path; an older one by the chat that made it.
          const named = viewIdentityFromPath(view.filePath);
          const viewId = named ? syncedViewId(named.conversationId, named.slug) : conversationId ? syncedViewId(conversationId, view.slug ?? viewSlugFromPath(view.filePath)) : null;
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
