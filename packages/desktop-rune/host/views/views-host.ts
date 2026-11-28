// `globalThis.stella.views`: Stella Views on the Rune desktop. A view is a `.view.tsx` file; its
// program runs in the engine (engine/src/views.rs) and the UI renders the trees it posts
// (ui/views). The host keeps one session per file, outside the hot-swapped UI, watches the file
// so an agent's edit swaps the running view in place, and keeps the view's storage on disk. A view
// whose file isn't on this computer (made in the cloud, by another computer, or by a task) runs from
// the newest source the conversation carries, as on the web and the phone.
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, watch, writeFileSync, type FSWatcher } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join } from "node:path";
import { ViewSession, type ViewCapabilities, type ViewRun, type ViewSnapshot, type ViewStorage, type ViewVm } from "@stella/views/session";
import type { ViewMessage, ViewPost, ViewTheme } from "@stella/views/protocol";
import { latestConversationViews, viewOwnedBy, type ConversationView, type ViewToolEvent } from "@stella/views/conversation";
import {
  applyViewRestore,
  conversationViewRelPath,
  isViewPath,
  viewDataPath as dataPathFor,
  viewHostMarkerPath,
  viewIdentityFromPath,
  viewIdentityIndexPath,
  viewKey as hash,
  viewSourceHash,
  viewStatusPath,
  viewTitle as titleFor,
  type ViewHostMarker,
  type ViewIdentityIndex,
  type ViewStatusFile,
} from "@stella/views/files";
import { ViewHistory, previewStorage, restoreCardArgs, restoredVersion, viewPreviewKey, type ViewPublishBackend, type ViewVersion } from "@stella/views/history";
import {
  MovableViewStorage,
  ViewStorageSync,
  backendViewStorageRemote,
  normalizeViewStorageRecord,
  syncedViewId,
  viewSlugFromPath,
  type ViewStorageBackend,
  type ViewStorageDisk,
  type ViewStorageRemote,
} from "@stella/views/storage-sync";
import { requireViewOpenableUrl } from "@stella/views/links";
import { publicFetch } from "./public-fetch";
import type { engine as BridgeEngine, onEngineEvent as BridgeOn } from "../bridge";
import { mainContext } from "../services/main-context";
import { VIEW_ASK_LIMITS, viewSendMetadata } from "@stella/contracts/backend/views";
import { LLM_ROUTE_FAILURE_MARKERS } from "@stella/contracts/llm-route-failure";

type Engine = typeof BridgeEngine;
type On = typeof BridgeOn;

const KEEP_ALIVE_MS = 60_000;
/** The space a view has in its chat card (640 wide, less its padding), until the card says. */
const CARD_VIEWPORT = { width: 606, height: 460 };
/** A frame the engine doesn't answer in time (an engine without `views.frame`) comes from a timer. */
const FRAME_FALLBACK_MS = 100;

export { isViewPath };

const dataDir = () => process.env.STELLA_DATA_DIR?.trim() || join(homedir(), ".stella");

function engineVm(engine: Engine, on: On): ViewVm {
  let seq = 0;
  return {
    async start(program, input, events, limits) {
      const id = `view-${++seq}-${Date.now().toString(36)}`;
      const off = on("views", (event) => {
        if (event.id !== id) return;
        if (event.kind === "posts") events.posts((event.posts ?? []) as ViewPost[]);
        else if (event.kind === "warning") events.warning?.(event.message ?? "");
        else if (event.kind === "exit") {
          off();
          events.exit({ kind: event.exit ?? "stopped", ...(event.message ? { message: event.message } : {}) });
        }
      });
      try {
        await engine.views.start({ id, program, input, sliceMs: limits.sliceMs, heapBytes: limits.heapBytes });
      } catch (error) {
        off();
        throw error;
      }
      const run: ViewRun = {
        deliver: (messages: ViewMessage[]) => engine.views.deliver(id, messages),
        stop: () => {
          off();
          engine.views.stop(id);
        },
      };
      return run;
    },
  };
}

/** Where a view kept its storage before it synced: by its file's path (still used for a file no conversation names). */
const legacyStorageFile = (filePath: string) => join(dataDir(), "views", `${basename(filePath).replace(/[^\w.-]+/gu, "_").slice(0, 60)}-${hash(filePath)}`, "storage.json");

const readJsonFile = (file: string): unknown => {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as unknown;
  } catch {
    return null;
  }
};

const writeJsonFile = (file: string, value: unknown) => {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value));
  renameSync(tmp, file);
};

const readLegacy = (filePath: string): Record<string, unknown> | null => {
  const parsed = readJsonFile(legacyStorageFile(filePath));
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
};

/**
 * The views' frame clock: each request asks the engine for the main window's next display frame
 * (`views.frame`), and that frame's event runs every callback waiting, with its time. Times sit on
 * the display's refresh grid, so `useFrame`'s dt is a whole number of refreshes rather than a
 * timer's drift (a frame due on screen wins over when it was drawn, when the platform says).
 */
function displayFrameClock(engine: Engine, on: On, now: () => number) {
  let queue: Array<(time: number) => void> = [];
  let asked = false;
  let fallback: ReturnType<typeof setTimeout> | null = null;
  let grid: { anchor: number; period: number } | null = null;
  let last = -Infinity;
  const run = (time: number) => {
    asked = false;
    if (fallback) clearTimeout(fallback);
    fallback = null;
    const callbacks = queue;
    queue = [];
    last = Math.max(last, time);
    for (const fn of callbacks) fn(time);
  };
  const onGrid = (at: number, hz: number | undefined) => {
    if (!hz || !Number.isFinite(hz) || hz < 20) return at;
    const period = 1000 / hz;
    if (!grid || Math.abs(grid.period - period) > 0.01) grid = { anchor: at, period };
    let time = grid.anchor + Math.round((at - grid.anchor) / period) * period;
    // The system clock and the display's drift apart slowly: follow the display.
    if (Math.abs(time - at) > period / 2) {
      grid = { anchor: at, period };
      time = at;
    }
    return time <= last ? last + period : time;
  };
  on("views", (event) => {
    if (event.kind !== "frame" || event.id !== "" || !asked) return;
    const epoch = event.presentsAt ?? event.started ?? event.at;
    run(onGrid(epoch - performance.timeOrigin, event.hz));
  });
  return (fn: (time: number) => void) => {
    queue.push(fn);
    if (asked) return;
    asked = true;
    engine.views.frame();
    fallback = setTimeout(() => run(now()), FRAME_FALLBACK_MS);
  };
}

function fileStorage(filePath: string): ViewStorage {
  const file = legacyStorageFile(filePath);
  let values: Record<string, unknown> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const read = (): Record<string, unknown> => (values ??= readLegacy(filePath) ?? {});
  const write = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      writeJsonFile(file, read());
    }, 150);
  };
  return {
    load: async () => ({ ...read() }),
    set: async (key, value) => {
      read()[key] = value;
      write();
    },
    remove: async (key) => {
      delete read()[key];
      write();
    },
    clear: async () => {
      values = {};
      write();
    },
  };
}

/**
 * Synced views' storage on this computer: one file per view, named by its synced id, in a folder per
 * account (`views/synced/a-<hash>/`). Records from before they were kept per account sit in
 * `views/synced/` itself.
 */
const syncedDisk = (): ViewStorageDisk => {
  const fileFor = (viewId: string, account: string | null) =>
    join(dataDir(), "views", "synced", ...(account === null ? [] : [`a-${hash(account)}`]), `${viewId.split("/").pop()!.replace(/[^\w.-]+/gu, "_").slice(0, 60)}-${hash(viewId)}.json`);
  return {
    read: async (viewId, account) => normalizeViewStorageRecord(readJsonFile(fileFor(viewId, account))),
    write: async (viewId, record, account) => writeJsonFile(fileFor(viewId, account), record),
  };
};

/** A view's synced id from its path, for a view in a chat's own folder (`outputs/views/<conversation>/<slug>.view.tsx`). */
const viewIdFromPath = (filePath: string): string | null => {
  const named = viewIdentityFromPath(filePath);
  return named ? syncedViewId(named.conversationId, named.slug) : null;
};

/**
 * Which synced view each file is, learned from the conversations that made them (the `view` tool's
 * calls) and kept on disk, so a view opened from its file (the panel after a restart, a file moved
 * elsewhere) still finds its storage: by path, and by source, which a moved file keeps.
 */
function identityIndex() {
  // The `view` tool reads it too, to keep a chat's view from before views had a folder per chat at its old path.
  const file = viewIdentityIndexPath(dataDir());
  const LIMIT = 2000;
  type Index = ViewIdentityIndex;
  let index: Index | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const read = (): Index => {
    if (index) return index;
    const parsed = readJsonFile(file) as Partial<Index> | null;
    index = { byPath: { ...(parsed?.byPath ?? {}) }, bySource: { ...(parsed?.bySource ?? {}) } };
    return index;
  };
  const trim = (map: Record<string, string>) => {
    const keys = Object.keys(map);
    for (const key of keys.slice(0, Math.max(0, keys.length - LIMIT))) delete map[key];
  };
  const save = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      try {
        writeJsonFile(file, read());
      } catch (error) {
        console.error("[views] couldn't save the views identity index:", error);
      }
    }, 300);
    timer.unref?.();
  };
  return {
    lookup(filePath: string, source: string | null): string | null {
      const named = viewIdFromPath(filePath);
      if (named) return named;
      const { byPath, bySource } = read();
      return byPath[filePath] ?? (source ? (bySource[viewSourceHash(source)] ?? null) : null);
    },
    remember(filePath: string, viewId: string, source: string | null) {
      const current = read();
      let changed = false;
      if (current.byPath[filePath] !== viewId) {
        delete current.byPath[filePath];
        current.byPath[filePath] = viewId;
        changed = true;
      }
      if (source) {
        const key = viewSourceHash(source);
        if (current.bySource[key] !== viewId) {
          current.bySource[key] = viewId;
          changed = true;
        }
      }
      if (!changed) return;
      trim(current.byPath);
      trim(current.bySource);
      save();
    },
  };
}

/** Caps on `stella.ask`: the backend's (`views.ask`, which the web and phones call), and a per-view rate. */
const ASK = { ...VIEW_ASK_LIMITS, perViewPerMinute: 10 } as const;
const ASK_SYSTEM = "You answer a request from a small app the user is using inside Stella. Reply with only what the app asked for: no preamble, no follow-up questions.";
/** IP location is city-level at best. */
const IP_ACCURACY_M = 25_000;
const LOCATION_TTL_MS = 5 * 60_000;
/** Views reopen as Stella starts, before the sign-in gives the model a route: an ask waits this long for one. */
const ASK_ROUTE_WAIT_MS = 15_000;

type Runner = { runOneShotCompletion(request: { agentType: string; systemPrompt?: string; userText: string; maxOutputTokens?: number; reasoningEffort?: "low" }): Promise<{ text: string }> };

/** Calls per key within a sliding window. */
function rateLimiter() {
  const calls = new Map<string, number[]>();
  return (key: string, limit: number, windowMs: number): boolean => {
    const at = performance.now();
    const recent = (calls.get(key) ?? []).filter((t) => at - t < windowMs);
    if (recent.length >= limit) return false;
    recent.push(at);
    calls.set(key, recent);
    return true;
  };
}

/** A notice for the surfaces showing a view (what a capability did without a window of its own). */
export type ViewNotice = { filePath: string; kind: "copied" };

function capabilities(engine: Engine, notice: (viewId: string, kind: ViewNotice["kind"]) => void): ViewCapabilities {
  const string = (v: unknown) => (typeof v === "string" ? v : String(v ?? ""));
  const allowed = rateLimiter();
  let located: { at: number; value: { latitude: number; longitude: number; accuracy: number } } | null = null;
  const ipLocation = async (): Promise<{ latitude: number; longitude: number; accuracy: number } | null> => {
    const sources: Array<[string, (j: Record<string, unknown>) => [unknown, unknown]]> = [
      ["https://ipapi.co/json/", (j) => [j.latitude, j.longitude]],
      ["https://ipwho.is/", (j) => [j.latitude, j.longitude]],
    ];
    for (const [url, read] of sources) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(8_000), headers: { accept: "application/json" } });
        if (!response.ok) continue;
        const [latitude, longitude] = read((await response.json()) as Record<string, unknown>);
        if (typeof latitude === "number" && typeof longitude === "number") return { latitude, longitude, accuracy: IP_ACCURACY_M };
      } catch {
        // The next source.
      }
    }
    return null;
  };
  return {
    ask: async ([prompt, options], context) => {
      const text = string(prompt).trim();
      const system = string((options as { system?: unknown } | undefined)?.system ?? "").trim();
      if (!text) throw new Error("ask needs a prompt");
      if (text.length > ASK.maxPromptChars) throw new Error(`ask takes up to ${ASK.maxPromptChars / 1000}k characters of prompt`);
      if (system.length > ASK.maxSystemChars) throw new Error(`ask takes up to ${ASK.maxSystemChars / 1000}k characters of system prompt`);
      if (!allowed(`view:${context.viewId}`, ASK.perViewPerMinute, 60_000)) throw new Error(`ask is limited to ${ASK.perViewPerMinute} calls a minute per view`);
      if (!allowed("all", ASK.perHour, 3_600_000)) throw new Error(`ask is limited to ${ASK.perHour} calls an hour`);
      const runner = mainContext()?.state.stellaHostRunner as Runner | null | undefined;
      if (!runner) throw new Error("Stella's model isn't ready yet");
      const once = () =>
        Promise.race([
          runner.runOneShotCompletion({
            agentType: "general",
            systemPrompt: system ? `${ASK_SYSTEM}\n\n${system}` : ASK_SYSTEM,
            userText: text,
            maxOutputTokens: ASK.maxOutputTokens,
            reasoningEffort: "low",
          }),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Stella's model didn't answer within ${ASK.timeoutMs / 1000} s`)), ASK.timeoutMs).unref?.()),
        ]);
      // Until the sign-in settles there is no route to Stella's model; a view asking as it opens
      // waits for it (someone signed out still gets the error, after the wait).
      const until = performance.now() + ASK_ROUTE_WAIT_MS;
      for (let delay = 250; ; delay = Math.min(delay * 2, 2_000)) {
        try {
          return (await once()).text.trim();
        } catch (error) {
          const noRoute = error instanceof Error && error.message.includes(LLM_ROUTE_FAILURE_MARKERS["no-stella-route"]);
          if (!noRoute || performance.now() + delay > until) throw error;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    },
    share: async ([content], context) => {
      // No desktop here has a share sheet a view can open, so what would be shared is copied.
      const c = (content ?? {}) as { text?: unknown; url?: unknown; title?: unknown };
      const text = [c.title, c.text, c.url].map((v) => (v === undefined || v === null ? "" : string(v).trim())).filter(Boolean).join("\n");
      if (!text) throw new Error("share needs text, a url or a title");
      await engine.clipboard.writeText(text);
      notice(context.viewId, "copied");
    },
    location: async () => {
      if (located && performance.now() - located.at < LOCATION_TTL_MS) return located.value;
      let value: { latitude: number; longitude: number; accuracy: number } | null = null;
      try {
        const fix = await engine.location(10_000);
        value = { latitude: fix.latitude, longitude: fix.longitude, accuracy: fix.accuracy };
      } catch {
        value = await ipLocation();
      }
      if (value) located = { at: performance.now(), value };
      return value;
    },
    fetch: async ([url, init]) => {
      const target = new URL(string(url));
      const options = (init ?? {}) as { method?: string; headers?: Record<string, string>; body?: unknown };
      return await publicFetch(
        target,
        { ...(options.method ? { method: string(options.method) } : {}), ...(options.headers ? { headers: options.headers } : {}), ...(typeof options.body === "string" ? { body: options.body } : {}) },
        { allowPrivate: process.env.STELLA_VIEWS_LOCAL_NETWORK === "1", timeoutMs: 30_000, maxBytes: 8 * 1024 * 1024 },
      );
    },
    "clipboard.writeText": async ([text]) => {
      await engine.clipboard.writeText(string(text));
    },
    "clipboard.readText": async () => engine.clipboard.readText(),
    openUrl: async ([url]) => {
      await engine.shell.openExternal(requireViewOpenableUrl(url).toString());
    },
    notify: async ([title, options], context) => {
      const body = (options as { body?: string } | undefined)?.body;
      await engine.notify({ id: `view-${context.viewId}-${Date.now()}`, title: string(title) || context.title, ...(body ? { body } : {}) });
    },
    haptic: async () => undefined,
    send: async ([text], context) => {
      const chat = (globalThis as { stella?: { chat?: { send(text: string, messageMetadata?: Record<string, unknown>): Promise<void> } } }).stella?.chat;
      if (!chat) throw new Error("send needs Stella's chat, which isn't running here");
      const message = string(text).trim();
      if (message) await chat.send(message, viewSendMetadata(context.title));
    },
    saveFile: async ([name, content]) => {
      const path = await engine.dialog.saveFile({ defaultPath: string(name) });
      if (!path) return null;
      writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content, null, 2));
      return path;
    },
    pickFile: async () => {
      const path = (await engine.dialog.openFile({}))?.[0];
      if (!path) return null;
      const text = readFileSync(path, "utf8");
      return { name: basename(path), path, text: text.length > 4 * 1024 * 1024 ? text.slice(0, 4 * 1024 * 1024) : text };
    },
  };
}

type Entry = {
  session: ViewSession;
  filePath: string;
  storage: MovableViewStorage;
  viewId: string | null;
  watchers: FSWatcher[];
  refs: number;
  closeTimer: ReturnType<typeof setTimeout> | null;
  lastSource: string | null;
  lastData: string | null;
  sourceHash: string;
  /** The file isn't on this computer: the view runs from the conversation's copy. */
  remote: boolean;
  /** A preview of an older version (its own run beside the live one): the source it runs. */
  preview?: string;
  /** A restored source on its way in from the file: it swaps in like an edit, fresh if the carried state breaks it. */
  restoring?: string;
};

/** Whether a view's file is on this computer (a cloud view's path is a Drive path, not a local one). */
const isLocalViewFile = (filePath: string): boolean => isAbsolute(filePath) && existsSync(filePath);

/**
 * Keeps the view's status file current while it is open, so the agent tool that wrote the source
 * can tell whether it rendered (and how fast) or what broke, without a channel to this process.
 */
function statusWriter(entry: { filePath: string; sourceHash: string; refs: number }) {
  const file = viewStatusPath(entry.filePath);
  let last = "";
  let ready = false;
  return (snapshot: ViewSnapshot) => {
    const status: Omit<ViewStatusFile, "at"> = {
      filePath: entry.filePath,
      source: entry.sourceHash,
      status: snapshot.status,
      problem: snapshot.problem,
      renderMs: snapshot.swapMs ?? snapshot.firstRenderMs,
      shown: entry.refs > 0,
    };
    const text = JSON.stringify(status);
    if (text === last || !entry.sourceHash) return;
    last = text;
    try {
      if (!ready) mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
      ready = true;
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ ...status, at: Date.now() } satisfies ViewStatusFile));
      renameSync(tmp, file);
    } catch {
      // Status is a convenience for the agent; the view runs without it.
    }
  };
}

type Message = { toolEvents?: readonly ViewToolEvent[] };

export function createViewsHost(engine: Engine, on: On) {
  const entries = new Map<string, Entry>();
  /** The newest version of each view the open conversations carry, by file path. */
  const known = new Map<string, ConversationView>();
  const scanned = new WeakMap<readonly ViewToolEvent[], Map<string, ConversationView>>();
  const sync = new ViewStorageSync(syncedDisk(), (message, detail) => console.error(`[views] ${message}:`, detail instanceof Error ? detail.message : (detail ?? "")));
  const remotes = new WeakMap<ViewStorageBackend, ViewStorageRemote>();
  const remoteFor = (client: ViewStorageBackend): ViewStorageRemote => {
    let remote = remotes.get(client);
    if (!remote) remotes.set(client, (remote = backendViewStorageRemote(client)));
    return remote;
  };
  const identities = identityIndex();
  /** Which conversation each message's views were last bound to, so a new message doesn't rebind the others. */
  const bound = new WeakMap<readonly ViewToolEvent[], string>();
  /** Every version of each view the conversations carry, the restores made here, and what's being previewed. */
  const history = new ViewHistory();
  /** The signed-in account's backend: views' storage syncs through it, and restores reach the other devices through it. */
  let backend: (ViewStorageBackend & Partial<ViewPublishBackend>) | null = null;
  /** Restores from elsewhere already put into their files here. */
  const landed = new Set<string>();

  /** Moves an open view onto its synced storage (its old storage comes along as the seed). */
  const bind = (entry: Entry, viewId: string) => {
    if (entry.viewId === viewId) return;
    entry.viewId = viewId;
    const filePath = entry.filePath;
    void entry.storage.move(sync.storage(viewId, async () => readLegacy(filePath)));
  };
  const vm = engineVm(engine, on);
  const noticeListeners = new Set<(notice: ViewNotice) => void>();
  const caps = capabilities(engine, (viewId, kind) => {
    const entry = [...entries.values()].find((e) => e.session.id === viewId);
    if (entry) for (const listener of noticeListeners) listener({ filePath: entry.filePath, kind });
  });
  const now = () => performance.now();
  const requestFrame = displayFrameClock(engine, on, now);

  const readRemote = (entry: Entry) => {
    if (entry.preview !== undefined) {
      if (entry.lastSource === entry.preview) return;
      entry.lastSource = entry.preview;
      void entry.session.load(entry.preview, "preview.view.tsx");
      return;
    }
    // Not offered yet: the chat hands each conversation's views over as it renders.
    const view = known.get(entry.filePath);
    if (!view) return;
    const data = view.data === undefined ? null : JSON.stringify(view.data);
    if (data !== entry.lastData) {
      entry.lastData = data;
      entry.session.setData(view.data ?? null);
    }
    if (view.source === entry.lastSource) return;
    entry.lastSource = view.source;
    entry.sourceHash = viewSourceHash(view.source);
    void entry.session.load(view.source, basename(entry.filePath), { freshIfStateBreaks: view.by?.kind === "restore" });
  };

  const readSource = (entry: Entry) => {
    if (entry.remote) return readRemote(entry);
    let source: string;
    try {
      source = readFileSync(entry.filePath, "utf8");
    } catch (error) {
      entry.lastSource = null;
      entry.session.report("file", (error as NodeJS.ErrnoException).code === "ENOENT" ? "The view's file is gone." : `Can't read the view: ${(error as Error).message}`);
      return;
    }
    if (source === entry.lastSource) return;
    entry.lastSource = source;
    entry.sourceHash = viewSourceHash(source);
    if (entry.viewId) identities.remember(entry.filePath, entry.viewId, source);
    const latest = history.latest(entry.filePath);
    const restoring = entry.restoring === source || (latest?.by.kind === "restore" && latest.source === source);
    entry.restoring = undefined;
    void entry.session.load(source, basename(entry.filePath), { freshIfStateBreaks: restoring });
  };

  const readData = (entry: Entry) => {
    const path = dataPathFor(entry.filePath);
    let text: string | null = null;
    try {
      text = existsSync(path) ? readFileSync(path, "utf8") : null;
    } catch {
      text = null;
    }
    if (text === entry.lastData) return;
    entry.lastData = text;
    if (text === null) return entry.session.setData(null);
    try {
      entry.session.setData(JSON.parse(text));
    } catch {
      // A half-written data file: the next write event reads it again.
    }
  };

  const open = (filePath: string, theme: ViewTheme, viewport?: { width: number; height: number }): Entry => {
    const existing = entries.get(filePath);
    if (existing) {
      if (existing.closeTimer) clearTimeout(existing.closeTimer);
      existing.closeTimer = null;
      return existing;
    }
    const remote = !isLocalViewFile(filePath);
    let data: unknown = remote ? (known.get(filePath)?.data ?? null) : null;
    try {
      const path = dataPathFor(filePath);
      if (!remote && existsSync(path)) data = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      data = null;
    }
    let source: string | null = null;
    try {
      source = readFileSync(filePath, "utf8");
    } catch {
      source = null;
    }
    const viewId = identities.lookup(filePath, source);
    const storage = new MovableViewStorage(viewId ? sync.storage(viewId, async () => readLegacy(filePath)) : fileStorage(filePath));
    if (viewId) identities.remember(filePath, viewId, source);
    const session = new ViewSession({
      id: hash(filePath),
      title: titleFor(filePath),
      vm,
      storage,
      capabilities: caps,
      theme,
      data,
      ...(viewport ? { viewport } : {}),
      requestFrame,
      now,
      onLog: (log) => {
        if (process.env.STELLA_VIEWS_LOG === "1" || log.level === "error") console.error(`[view ${basename(filePath)}] ${log.level}: ${log.text}`);
      },
    });
    const entry: Entry = { session, filePath, storage, viewId, watchers: [], refs: 0, closeTimer: null, lastSource: null, lastData: data === null ? null : JSON.stringify(data), sourceHash: "", remote };
    session.subscribe(statusWriter(entry));
    if (process.env.STELLA_VIEWS_LOG === "1") {
      let seen = { first: null as number | null, swap: null as number | null, problem: null as string | null };
      session.subscribe((s) => {
        if (s.firstRenderMs !== seen.first && s.firstRenderMs !== null) console.error(`[views] ${basename(filePath)} first tree in ${s.firstRenderMs.toFixed(2)} ms`);
        if (s.swapMs !== seen.swap && s.swapMs !== null) console.error(`[views] ${basename(filePath)} new source to tree in ${s.swapMs.toFixed(2)} ms`);
        if (s.problem && s.problem.message !== seen.problem) console.error(`[views] ${basename(filePath)} ${s.problem.phase}: ${s.problem.message}`);
        seen = { first: s.firstRenderMs, swap: s.swapMs, problem: s.problem?.message ?? null };
      });
    }
    entries.set(filePath, entry);
    if (remote) {
      readSource(entry);
      return entry;
    }
    const dir = dirname(filePath);
    const names = new Set([basename(filePath), basename(dataPathFor(filePath))]);
    let pending: ReturnType<typeof setTimeout> | null = null;
    try {
      entry.watchers.push(
        watch(dir, (_event, name) => {
          if (name && !names.has(String(name))) return;
          if (pending) clearTimeout(pending);
          pending = setTimeout(() => {
            pending = null;
            readSource(entry);
            readData(entry);
          }, 2);
        }),
      );
    } catch (error) {
      console.error(`[views] can't watch ${dir}:`, error);
    }
    readSource(entry);
    return entry;
  };

  const close = (filePath: string) => {
    const entry = entries.get(filePath);
    if (!entry) return;
    for (const watcher of entry.watchers) watcher.close();
    entry.session.dispose();
    entries.delete(filePath);
    if (entry.preview === undefined) rmSync(viewStatusPath(filePath), { force: true });
  };

  /**
   * An older version, run beside the live view so the user can look at it: it starts from the
   * view's saved values and data as they are now, and what it changes stays with the preview.
   */
  const openPreview = (filePath: string, version: ViewVersion, theme: ViewTheme): Entry => {
    const key = viewPreviewKey(filePath, version.id);
    const existing = entries.get(key);
    if (existing) {
      if (existing.closeTimer) clearTimeout(existing.closeTimer);
      existing.closeTimer = null;
      return existing;
    }
    const live = entries.get(filePath);
    let data: unknown = known.get(filePath)?.data ?? null;
    try {
      if (live?.lastData) data = JSON.parse(live.lastData);
    } catch {
      // The live view's data is half-written: the conversation's copy.
    }
    const storage = new MovableViewStorage(previewStorage(live?.storage ?? null));
    const session = new ViewSession({ id: hash(key), title: version.title, vm, storage, capabilities: caps, theme, data, requestFrame, now });
    const entry: Entry = { session, filePath: key, storage, viewId: null, watchers: [], refs: 0, closeTimer: null, lastSource: null, lastData: null, sourceHash: "", remote: true, preview: version.source };
    entries.set(key, entry);
    readSource(entry);
    return entry;
  };

  /** Puts a restore into the view's file here, when the file is here (every surface then swaps to it). */
  /** This computer's file of the view at `filePath` (itself, or the file a cloud Drive copy of it mirrors), or null. */
  const localFileOf = (filePath: string): string | null => {
    if (isLocalViewFile(filePath)) return filePath;
    const named = viewIdentityFromPath(filePath);
    if (!named) return null;
    const local = join(dataDir(), ...conversationViewRelPath(named.conversationId, named.slug).split("/"));
    return isLocalViewFile(local) ? local : null;
  };

  const landRestore = async (version: ViewVersion) => {
    const filePath = version.by.kind === "restore" ? localFileOf(version.filePath) : null;
    if (!filePath || version.by.kind !== "restore") return;
    const entry = entries.get(filePath);
    if (entry) entry.restoring = version.source;
    const outcome = await applyViewRestore(dataDir(), { filePath, source: version.source, createdAt: version.createdAt, restoredFrom: version.by.from });
    if (entry && outcome === "written") readSource(entry);
  };

  // A view the agent's `view` tool writes runs here at once, before its chat card exists: the
  // card mounts with the tool's result, and the tool waits for this run's first render to say
  // whether the view works. The card then joins the run already going.
  let lastTheme: ViewTheme = { dark: true, accent: "#3b82f6", platform: "desktop" };
  const outputs = join(dataDir(), "outputs", "views");
  const preOpen = (name: string) => {
    if (!isViewPath(name)) return;
    // `<slug>.view.tsx` (a view from before chats had folders), or `<conversation>/<slug>.view.tsx`.
    const filePath = join(outputs, name);
    if (entries.has(filePath) || !existsSync(filePath)) return;
    const entry = open(filePath, lastTheme, CARD_VIEWPORT);
    if (entry.refs === 0 && !entry.closeTimer) {
      entry.closeTimer = setTimeout(() => close(filePath), KEEP_ALIVE_MS);
      entry.closeTimer.unref?.();
    }
  };
  try {
    mkdirSync(outputs, { recursive: true });
    watch(outputs, { recursive: true }, (_event, name) => {
      if (name) preOpen(String(name));
    });
    const marker = viewHostMarkerPath(dataDir());
    mkdirSync(dirname(marker), { recursive: true, mode: 0o700 });
    writeFileSync(marker, JSON.stringify({ pid: process.pid, dataDir: dataDir(), at: Date.now() } satisfies ViewHostMarker));
    process.once("exit", () => rmSync(marker, { force: true }));
  } catch (error) {
    console.error(`[views] can't watch ${outputs}:`, error);
  }

  const withEntry = (filePath: string, fn: (entry: Entry) => void) => {
    const entry = entries.get(filePath);
    if (entry) fn(entry);
  };

  const attach = (entry: Entry, theme: ViewTheme, listener: (snapshot: ViewSnapshot) => void, keepAliveMs: number): (() => void) => {
    if (entry.closeTimer) clearTimeout(entry.closeTimer);
    entry.closeTimer = null;
    entry.refs += 1;
    entry.session.setTheme(theme);
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
      entry.closeTimer.unref?.();
    };
  };

  /** Makes `target` the view's newest version again, as a new version (so it can be undone too), on every device. */
  const restore = async (filePath: string, versionId: string): Promise<{ restored: boolean; shared: boolean; error?: string }> => {
    const target = history.find(filePath, versionId);
    if (!target) return { restored: false, shared: false, error: "That version isn't in this conversation any more." };
    const latest = history.latest(filePath);
    const conversationId = history.conversationOf(filePath);
    const args = restoreCardArgs(target, latest, conversationId ?? "", Date.now());
    const version = restoredVersion(args);
    history.addPending(version);
    history.setPreview(filePath, null);
    landed.add(version.id);
    if (localFileOf(filePath)) {
      await landRestore(version);
    } else {
      const prior = known.get(filePath);
      known.set(filePath, { filePath, slug: args.slug, title: args.title, source: args.source, createdAt: args.createdAt, by: version.by, ...(prior?.data !== undefined ? { data: prior.data } : {}) });
      const entry = entries.get(filePath);
      if (entry) readSource(entry);
    }
    if (!conversationId || !backend?.call) return { restored: true, shared: false };
    try {
      const { posted } = await backend.call("conversations.publishView", args);
      return { restored: true, shared: posted };
    } catch (error) {
      console.error("[views] couldn't publish a restore:", error);
      return { restored: true, shared: false, error: error instanceof Error ? error.message : String(error) };
    }
  };

  return {
    isViewPath,
    /** Opens (or shares) the view at `filePath` and calls `listener` with each snapshot; returns the release. */
    subscribe(filePath: string, theme: ViewTheme, listener: (snapshot: ViewSnapshot) => void): () => void {
      lastTheme = theme;
      return attach(open(filePath, theme), theme, listener, KEEP_ALIVE_MS);
    },
    /** The view's versions, oldest first (what the conversation carries, and restores made here). */
    history: (filePath: string): readonly ViewVersion[] => history.versions(filePath),
    /** The older version the view's surfaces show instead of the live one, or null. */
    previewing: (filePath: string): ViewVersion | null => history.preview(filePath),
    /** Shows an older version on every surface of the view (null goes back to the live one). */
    setPreview: (filePath: string, versionId: string | null) => history.setPreview(filePath, versionId),
    /** Calls `listener` with each file whose history or preview changed; returns the release. */
    onHistory: (listener: (filePath: string) => void): (() => void) => history.subscribe(listener),
    /** Runs an older version beside the live one (key `viewPreviewKey`, for dispatch and the rest); returns the release. */
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
    theme: (filePath: string, theme: ViewTheme) => withEntry(filePath, (e) => e.session.setTheme(theme)),
    restart: (filePath: string) => withEntry(filePath, (e) => void e.session.restart()),
    logs: (filePath: string) => entries.get(filePath)?.session.logs.slice() ?? [],
    /**
     * The views a conversation carries (its `view` tool calls and tasks' view cards): a view whose
     * file isn't on this computer runs the newest of them, and swaps when a newer one arrives; and
     * each file learns which synced view it is, `<conversationId>/<slug>`, so its storage follows it
     * across devices.
     */
    offerMessages(messages: readonly Message[], conversationId?: string | null) {
      history.offerMessages(messages, conversationId);
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
          const previous = known.get(view.filePath);
          if (previous && (previous.createdAt > view.createdAt || (previous.source === view.source && previous.data === view.data))) continue;
          known.set(view.filePath, view);
          const entry = entries.get(view.filePath);
          if (entry?.remote) readSource(entry);
          // A restore made on another device: the file here takes it (unless it was written since).
          const latest = history.latest(view.filePath);
          if (latest?.by.kind === "restore" && !landed.has(latest.id)) {
            landed.add(latest.id);
            void landRestore(latest).catch((error: unknown) => console.error("[views] couldn't restore the view's file:", error));
          }
        }
        if (!conversationId || bound.get(events) === conversationId) continue;
        bound.set(events, conversationId);
        for (const view of views.values()) {
          if (!viewOwnedBy(view, conversationId)) continue;
          // A view in a chat's own folder is named by its path; an older one learns its id from the chat.
          const viewId = viewIdFromPath(view.filePath) ?? syncedViewId(conversationId, view.slug ?? viewSlugFromPath(view.filePath));
          if (!viewId) continue;
          const entry = entries.get(view.filePath);
          identities.remember(view.filePath, viewId, entry?.lastSource ?? view.source);
          if (entry) bind(entry, viewId);
        }
      }
    },
    /**
     * The signed-in account (`account`, e.g. `account:<userId>`) and its backend, which views'
     * storage syncs and restores publish through; a null client while signed out. Each account
     * keeps its own copy of every view's storage: after a switch, open views move onto the new account's.
     */
    connectBackend(client: (ViewStorageBackend & Partial<ViewPublishBackend>) | null, account?: string | null) {
      backend = client;
      const remote = client ? remoteFor(client) : null;
      if (account === undefined) return sync.setRemote(remote);
      if (!sync.connect(client ? account : null, remote)) return;
      for (const entry of entries.values()) {
        if (!entry.viewId) continue;
        const filePath = entry.filePath;
        void entry.storage.move(sync.storage(entry.viewId, async () => readLegacy(filePath)));
      }
    },
    /** Which synced view the file is, and whether everything changed here reached the server. */
    syncState: (filePath: string): { viewId: string | null; account: string | null; connected: boolean; synced: boolean } | null => {
      const entry = entries.get(filePath);
      if (!entry) return null;
      const target = entry.storage.target as { synced?: boolean; account?: string | null };
      return { viewId: entry.viewId, account: target.account ?? null, connected: sync.connected, synced: target.synced ?? true };
    },
    /** What a view's capabilities did that its surfaces should say (a share copied); returns the release. */
    onNotice(listener: (notice: ViewNotice) => void): () => void {
      noticeListeners.add(listener);
      return () => noticeListeners.delete(listener);
    },
    /** Loads a source without a file (the gallery, previews of a view an agent is writing). */
    reload: (filePath: string) => withEntry(filePath, (e) => {
      e.lastSource = null;
      readSource(e);
    }),
  };
}

export type ViewsHost = ReturnType<typeof createViewsHost>;
