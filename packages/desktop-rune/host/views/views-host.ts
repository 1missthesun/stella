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
import type { engine as BridgeEngine, onEngineEvent as BridgeOn } from "../bridge";

type Engine = typeof BridgeEngine;
type On = typeof BridgeOn;

const KEEP_ALIVE_MS = 60_000;
const FRAME_MS = 1000 / 60;

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

function fileStorage(filePath: string): ViewStorage {
  const dir = join(dataDir(), "views", `${basename(filePath).replace(/[^\w.-]+/gu, "_").slice(0, 60)}-${hash(filePath)}`);
  const file = join(dir, "storage.json");
  let values: Record<string, unknown> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const read = (): Record<string, unknown> => {
    if (values) return values;
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
      values = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      values = {};
    }
    return values;
  };
  const write = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      mkdirSync(dir, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(read()));
      renameSync(tmp, file);
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

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|\[?::1\]?$|\[?f[cd][0-9a-f]{2}:|0\.0\.0\.0)/iu;

function capabilities(engine: Engine): ViewCapabilities {
  const string = (v: unknown) => (typeof v === "string" ? v : String(v ?? ""));
  return {
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

export function createViewsHost(engine: Engine, on: On) {
  const entries = new Map<string, Entry>();
  /** The newest version of each view the open conversations carry, by file path. */
  const known = new Map<string, ConversationView>();
  const scanned = new WeakMap<readonly ViewToolEvent[], Map<string, ConversationView>>();
  const vm = engineVm(engine, on);
  const caps = capabilities(engine);
  const now = () => performance.now();
  let frameQueue: Array<(time: number) => void> = [];
  let frameTimer: ReturnType<typeof setTimeout> | null = null;
  const requestFrame = (fn: (time: number) => void) => {
    frameQueue.push(fn);
    if (frameTimer) return;
    const at = now();
    const next = Math.ceil(at / FRAME_MS) * FRAME_MS;
    frameTimer = setTimeout(() => {
      frameTimer = null;
      const run = frameQueue;
      frameQueue = [];
      const time = now();
      for (const f of run) f(time);
    }, Math.max(1, next - at));
  };

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
    const session = new ViewSession({
      id: hash(filePath),
      title: titleFor(filePath),
      vm,
      storage: fileStorage(filePath),
      capabilities: caps,
      theme,
      data,
      requestFrame,
      now,
      onLog: (log) => {
        if (process.env.STELLA_VIEWS_LOG === "1" || log.level === "error") console.error(`[view ${basename(filePath)}] ${log.level}: ${log.text}`);
      },
    });
    const entry: Entry = { session, filePath, watchers: [], refs: 0, closeTimer: null, lastSource: null, lastData: data === null ? null : JSON.stringify(data), sourceHash: "", remote };
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
     * The views a conversation carries (its `view` tool calls and view cards): a view whose file
     * isn't on this computer runs the newest of them, and swaps when a newer one arrives.
     */
    offerMessages(messages: readonly { toolEvents?: readonly ViewToolEvent[] }[]) {
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
      }
    },
    /** Loads a source without a file (the gallery, previews of a view an agent is writing). */
    reload: (filePath: string) => withEntry(filePath, (e) => {
      e.lastSource = null;
      readSource(e);
    }),
  };
}

export type ViewsHost = ReturnType<typeof createViewsHost>;
