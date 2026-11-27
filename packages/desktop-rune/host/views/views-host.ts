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
import { latestConversationViews, type ConversationView, type ViewToolEvent } from "@stella/views/conversation";
import { isViewPath, viewDataPath as dataPathFor, viewKey as hash, viewSourceHash, viewStatusPath, viewTitle as titleFor, type ViewStatusFile } from "@stella/views/files";
import {
  MovableViewStorage,
  ViewStorageSync,
  backendViewStorageRemote,
  normalizeViewStorageRecord,
  syncedViewId,
  viewSlugFromPath,
  type ViewStorageBackend,
  type ViewStorageDisk,
} from "@stella/views/storage-sync";
import type { engine as BridgeEngine, onEngineEvent as BridgeOn } from "../bridge";
import { mainContext } from "../services/main-context";
import { VIEW_ASK_LIMITS } from "@stella/contracts/backend/views";

type Engine = typeof BridgeEngine;
type On = typeof BridgeOn;

const KEEP_ALIVE_MS = 60_000;
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

/** Synced views' storage on this computer: one file per view, named by its synced id. */
const syncedDisk = (): ViewStorageDisk => {
  const fileFor = (viewId: string) => join(dataDir(), "views", "synced", `${viewId.split("/").pop()!.replace(/[^\w.-]+/gu, "_").slice(0, 60)}-${hash(viewId)}.json`);
  return {
    read: async (viewId) => normalizeViewStorageRecord(readJsonFile(fileFor(viewId))),
    write: async (viewId, record) => writeJsonFile(fileFor(viewId), record),
  };
};

/**
 * Which synced view each file is, learned from the conversations that made them (the `view` tool's
 * calls) and kept on disk, so a view opened from its file (the panel after a restart, a file moved
 * elsewhere) still finds its storage: by path, and by source, which a moved file keeps.
 */
function identityIndex() {
  const file = join(dataDir(), "views", "identity.json");
  const LIMIT = 2000;
  type Index = { byPath: Record<string, string>; bySource: Record<string, string> };
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

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:|0\.0\.0\.0)/iu;

/** Caps on `stella.ask`: the backend's (`views.ask`, which the web and phones call), and a per-view rate. */
const ASK = { ...VIEW_ASK_LIMITS, perViewPerMinute: 10 } as const;
const ASK_SYSTEM = "You answer a request from a small app the user is using inside Stella. Reply with only what the app asked for: no preamble, no follow-up questions.";
/** IP location is city-level at best. */
const IP_ACCURACY_M = 25_000;
const LOCATION_TTL_MS = 5 * 60_000;

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
      const reply = await Promise.race([
        runner.runOneShotCompletion({
          agentType: "general",
          systemPrompt: system ? `${ASK_SYSTEM}\n\n${system}` : ASK_SYSTEM,
          userText: text,
          maxOutputTokens: ASK.maxOutputTokens,
          reasoningEffort: "low",
        }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`Stella's model didn't answer within ${ASK.timeoutMs / 1000} s`)), ASK.timeoutMs).unref?.()),
      ]);
      return reply.text.trim();
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
      if (target.protocol !== "https:" && target.protocol !== "http:") throw new Error(`fetch can reach only http(s) URLs, not ${target.protocol}`);
      if (PRIVATE_HOST.test(target.hostname) && process.env.STELLA_VIEWS_LOCAL_NETWORK !== "1") throw new Error(`fetch can't reach ${target.hostname}: views reach only the public internet`);
      const options = (init ?? {}) as { method?: string; headers?: Record<string, string>; body?: string };
      const response = await fetch(target, {
        method: options.method ?? "GET",
        ...(options.headers ? { headers: options.headers } : {}),
        ...(typeof options.body === "string" ? { body: options.body } : {}),
        redirect: "follow",
        signal: AbortSignal.timeout(30_000),
      });
      const body = await response.text();
      if (body.length > 8 * 1024 * 1024) throw new Error("The response is bigger than 8 MB");
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      return { status: response.status, statusText: response.statusText, headers, url: response.url, body };
    },
    "clipboard.writeText": async ([text]) => {
      await engine.clipboard.writeText(string(text));
    },
    "clipboard.readText": async () => engine.clipboard.readText(),
    openUrl: async ([url]) => {
      const target = new URL(string(url));
      if (!/^(https?|mailto|tel):$/u.test(target.protocol)) throw new Error(`openUrl opens web, mail and phone links, not ${target.protocol}`);
      await engine.shell.openExternal(target.toString());
    },
    notify: async ([title, options], context) => {
      const body = (options as { body?: string } | undefined)?.body;
      await engine.notify({ id: `view-${context.viewId}-${Date.now()}`, title: string(title) || context.title, ...(body ? { body } : {}) });
    },
    haptic: async () => undefined,
    send: async ([text]) => {
      const chat = (globalThis as { stella?: { chat?: { send(text: string): Promise<void> } } }).stella?.chat;
      if (!chat) throw new Error("send needs Stella's chat, which isn't running here");
      const message = string(text).trim();
      if (message) await chat.send(message);
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
};

/** Whether a view's file is on this computer (a cloud view's path is a Drive path, not a local one). */
const isLocalViewFile = (filePath: string): boolean => isAbsolute(filePath) && existsSync(filePath);

/**
 * Keeps the view's status file current while it is open, so the agent tool that wrote the source
 * can tell whether it rendered (and how fast) or what broke, without a channel to this process.
 */
function statusWriter(entry: { filePath: string; sourceHash: string }) {
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
  const identities = identityIndex();
  /** Which conversation each message's views were last bound to, so a new message doesn't rebind the others. */
  const bound = new WeakMap<readonly ViewToolEvent[], string>();

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
    void entry.session.load(view.source, basename(entry.filePath));
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
    void entry.session.load(source, basename(entry.filePath));
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

  const open = (filePath: string, theme: ViewTheme): Entry => {
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
    rmSync(viewStatusPath(filePath), { force: true });
  };

  const withEntry = (filePath: string, fn: (entry: Entry) => void) => {
    const entry = entries.get(filePath);
    if (entry) fn(entry);
  };

  return {
    isViewPath,
    /** Opens (or shares) the view at `filePath` and calls `listener` with each snapshot; returns the release. */
    subscribe(filePath: string, theme: ViewTheme, listener: (snapshot: ViewSnapshot) => void): () => void {
      const entry = open(filePath, theme);
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
        entry.closeTimer = setTimeout(() => close(filePath), KEEP_ALIVE_MS);
        entry.closeTimer.unref?.();
      };
    },
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
      for (const message of messages) {
        const events = message.toolEvents;
        if (!events?.length) continue;
        let views = scanned.get(events);
        if (!views) {
          views = latestConversationViews(events);
          scanned.set(events, views);
        }
        for (const view of views.values()) {
          const previous = known.get(view.filePath);
          if (previous && (previous.createdAt > view.createdAt || (previous.source === view.source && previous.data === view.data))) continue;
          known.set(view.filePath, view);
          const entry = entries.get(view.filePath);
          if (entry?.remote) readSource(entry);
        }
        if (!conversationId || bound.get(events) === conversationId) continue;
        bound.set(events, conversationId);
        for (const view of views.values()) {
          const viewId = syncedViewId(conversationId, view.slug ?? viewSlugFromPath(view.filePath));
          if (!viewId) continue;
          const entry = entries.get(view.filePath);
          identities.remember(view.filePath, viewId, entry?.lastSource ?? view.source);
          if (entry) bind(entry, viewId);
        }
      }
    },
    /** The signed-in account's backend, which views' storage syncs through; null while signed out. */
    connectBackend(client: ViewStorageBackend | null) {
      sync.setRemote(client ? backendViewStorageRemote(client) : null);
    },
    /** Which synced view the file is, and whether everything changed here reached the server. */
    syncState: (filePath: string): { viewId: string | null; connected: boolean; synced: boolean } | null => {
      const entry = entries.get(filePath);
      if (!entry) return null;
      const target = entry.storage.target as { synced?: boolean };
      return { viewId: entry.viewId, connected: sync.connected, synced: target.synced ?? true };
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
