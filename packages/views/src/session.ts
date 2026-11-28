// The host side of one open view, the same on every platform: it compiles the source, starts the
// program on the platform's VM (the Rune engine, psychoscript-mobile, or WebAssembly), answers its
// calls through the platform's capabilities, and hands renderers the latest tree. A new source
// (an agent's edit) swaps in place: the old run hands over its hook state and the new one starts
// from it, so the view keeps what the user did.
import { compileView, describeError, withPosition, type CompiledView } from "./compile";
import {
  VIEW_LIMITS,
  VIEW_PROTOCOL,
  type ViewCallMethod,
  type ViewChild,
  type ViewInput,
  type ViewMessage,
  type ViewPost,
  type ViewTheme,
  type ViewHookState,
} from "./protocol";

export type ViewExit = { kind: "finished" | "failed" | "stopped"; message?: string };

/** One live run on the platform's VM. */
export interface ViewRun {
  deliver(messages: ViewMessage[]): void;
  stop(): void;
}

/** Runs programs. `start` rejects with the message of a program that doesn't compile. */
export interface ViewVm {
  start(
    program: string,
    input: ViewInput,
    events: { posts(posts: ViewPost[]): void; exit(exit: ViewExit): void; warning?(message: string): void },
    limits: { sliceMs: number; heapBytes: number },
  ): Promise<ViewRun>;
}

/** The view's saved key-value storage. */
export interface ViewStorage {
  load(): Promise<Record<string, unknown>>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
  /** Changes made elsewhere (another device, another window), when the platform syncs them. */
  subscribe?(listener: (key: string, value: unknown) => void): () => void;
  /** What went wrong keeping a change (a server refused it), when the platform syncs storage. */
  onProblem?(listener: (message: string) => void): () => void;
}

export type ViewCallContext = { viewId: string; title: string };

/**
 * Calls that act as the user (a chat turn): each needs a press, submit or key the user made in the
 * view within the last few seconds, takes that gesture, and is rate-limited per view, so a view
 * can't make them as it opens or in a loop.
 */
const GESTURE_METHODS: ReadonlySet<ViewCallMethod> = new Set<ViewCallMethod>(["send"]);
const GESTURE_EVENTS: ReadonlySet<string> = new Set(["onPress", "onDoublePress", "onLongPress", "onSubmit", "onRowPress"]);
const GESTURE_MS = 10_000;
const GESTURE_CALLS_PER_MINUTE = 6;

/** The event name of each handler id in a tree (`h: { onPress: 3 }` gives 3 → "onPress"). */
const handlerNames = (tree: ViewChild | null): Map<number, string> => {
  const names = new Map<number, string>();
  const stack: ViewChild[] = tree ? [tree] : [];
  while (stack.length) {
    const node = stack.pop()!;
    if (typeof node === "string") continue;
    if (node.h) for (const [name, id] of Object.entries(node.h)) names.set(id, name);
    if (node.c) stack.push(...node.c);
  }
  return names;
};
export type ViewCapability = (args: unknown[], context: ViewCallContext) => Promise<unknown>;
export type ViewCapabilities = Partial<Record<ViewCallMethod, ViewCapability>>;

/** What broke, with where in the view's own source when it is known. */
export type ViewProblem = { phase: string; message: string; line?: number; column?: number };

const problemOf = (phase: string, message: string, stack: string | undefined, view: CompiledView): ViewProblem => {
  const { message: text, position } = describeError(message, stack, view);
  return { phase, message: text, ...(position ? { line: position.line, column: position.column } : {}) };
};
export type ViewLog = { level: string; text: string; at: number };

export type ViewSnapshot = {
  status: "loading" | "running" | "failed" | "stopped";
  tree: ViewChild | null;
  rev: number;
  /** The latest program error; the last good tree stays on screen with it. */
  problem: ViewProblem | null;
  keys: readonly string[];
  /** Milliseconds from `load` to the first tree of the current source. */
  firstRenderMs: number | null;
  /** Milliseconds from the latest source change to its first tree. */
  swapMs: number | null;
};

export type ViewSessionOptions = {
  id: string;
  title: string;
  vm: ViewVm;
  storage: ViewStorage;
  capabilities: ViewCapabilities;
  theme: ViewTheme;
  viewport?: { width: number; height: number };
  data?: unknown;
  /** The platform's frame clock: calls `fn` once on the next display frame. */
  requestFrame: (fn: (time: number) => void) => void;
  now: () => number;
  onLog?: (log: ViewLog) => void;
};

const LOG_LIMIT = 200;

export class ViewSession {
  readonly id: string;
  private options: ViewSessionOptions;
  private run: ViewRun | null = null;
  private runToken = 0;
  private view: CompiledView | null = null;
  private source: string | null = null;
  private fileName = "view.tsx";
  private snapshot: ViewSnapshot = { status: "loading", tree: null, rev: 0, problem: null, keys: [], firstRenderMs: null, swapMs: null };
  private listeners = new Set<(snapshot: ViewSnapshot) => void>();
  private storageCache: Record<string, unknown> | null = null;
  private viewport: { width: number; height: number };
  private theme: ViewTheme;
  private data: unknown;
  private frameWanted = false;
  private lastFrame: number | null = null;
  private stateWaiter: ((hooks: ViewHookState | null) => void) | null = null;
  private loadStartedAt = 0;
  private disposed = false;
  private unsubscribeStorage: (() => void) | null = null;
  private unsubscribeStorageProblems: (() => void) | null = null;
  /** Storage changes heard while no run was there to take them (one is starting), newest per key. */
  private storageWhileStarting = new Map<string, unknown>();
  /** The run started from the last one's state, and should start fresh instead if that state breaks it. */
  private freshIfStateBreaks = false;
  /** When the user last pressed, submitted or keyed in the view, until a gesture-gated call takes it. */
  private gestureAt: number | null = null;
  private gestureCalls: number[] = [];
  private names: { tree: ViewChild | null; map: Map<number, string> } | null = null;
  readonly logs: ViewLog[] = [];

  constructor(options: ViewSessionOptions) {
    this.id = options.id;
    this.options = options;
    this.viewport = options.viewport ?? { width: 0, height: 0 };
    this.theme = options.theme;
    this.data = options.data ?? null;
    this.unsubscribeStorage =
      options.storage.subscribe?.((key, value) => {
        if (this.storageCache) {
          if (value === undefined || value === null) delete this.storageCache[key];
          else this.storageCache[key] = value;
        }
        if (this.run) this.run.deliver([{ t: "storage", key, value }]);
        else this.storageWhileStarting.set(key, value);
      }) ?? null;
    this.unsubscribeStorageProblems =
      options.storage.onProblem?.((message) => {
        this.log("error", `storage: ${message}`);
        this.publish({ problem: { phase: "storage", message } });
      }) ?? null;
  }

  get current(): ViewSnapshot {
    return this.snapshot;
  }

  subscribe(listener: (snapshot: ViewSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private publish(next: Partial<ViewSnapshot>) {
    this.snapshot = { ...this.snapshot, ...next };
    for (const listener of this.listeners) listener(this.snapshot);
  }

  /**
   * Loads a source, or swaps a running view to a new one, keeping its state. With
   * `freshIfStateBreaks` (an earlier version the user restored, whose hooks may not fit what the
   * newer one left), a swap that fails before its first tree starts the source again from scratch.
   */
  async load(source: string, fileName = this.fileName, options: { freshIfStateBreaks?: boolean } = {}): Promise<void> {
    if (this.disposed) return;
    if (source === this.source && fileName === this.fileName && this.run) return;
    this.loadStartedAt = this.options.now();
    this.source = source;
    this.fileName = fileName;
    const compiled = compileView(source, fileName);
    if (!compiled.ok) {
      const { line, column } = compiled.error;
      this.publish({
        status: this.snapshot.tree ? this.snapshot.status : "failed",
        problem: { phase: "compile", message: line ? withPosition(compiled.error.message, line, column) : compiled.error.message, ...(line ? { line } : {}), ...(column ? { column } : {}) },
      });
      return;
    }
    const restore = this.run ? await this.saveState() : undefined;
    if (this.disposed || this.source !== source) return;
    this.view = compiled.view;
    this.freshIfStateBreaks = Boolean(options.freshIfStateBreaks && restore);
    await this.start(compiled.view, restore ?? undefined);
  }

  private async saveState(): Promise<ViewHookState | null> {
    if (!this.run) return null;
    const hooks = new Promise<ViewHookState | null>((resolve) => {
      this.stateWaiter = resolve;
      setTimeout(() => {
        if (this.stateWaiter === resolve) {
          this.stateWaiter = null;
          resolve(null);
        }
      }, 100);
    });
    this.run.deliver([{ t: "save" }]);
    return hooks;
  }

  private async start(view: CompiledView, restore?: ViewHookState) {
    const token = ++this.runToken;
    const previous = this.run;
    this.run = null;
    previous?.stop();
    this.frameWanted = false;
    this.lastFrame = null;
    if (!this.storageCache) this.storageCache = await this.options.storage.load().catch(() => ({}));
    const input: ViewInput = {
      protocol: VIEW_PROTOCOL,
      viewport: this.viewport,
      theme: this.theme,
      storage: this.storageCache,
      data: this.data,
      ...(restore ? { restore } : {}),
    };
    let firstTree = true;
    try {
      const run = await this.options.vm.start(
        view.program,
        input,
        {
          posts: (posts) => {
            if (token !== this.runToken) return;
            for (const post of posts) {
              this.onPost(post, view, firstTree);
              if (post.t === "render") firstTree = false;
            }
          },
          exit: (exit) => {
            if (token !== this.runToken) return;
            this.run = null;
            if (exit.kind === "failed" && firstTree && this.retryFresh()) return;
            if (exit.kind === "failed") this.publish({ status: "failed", problem: problemOf("run", exit.message ?? "The view stopped", undefined, view) });
            else if (exit.kind === "finished") this.publish({ status: "stopped" });
          },
          warning: (message) => this.log("warn", message),
        },
        { sliceMs: VIEW_LIMITS.sliceBudgetMs, heapBytes: VIEW_LIMITS.maxHeapBytes },
      );
      if (token !== this.runToken) {
        run.stop();
        return;
      }
      this.run = run;
      // The run started from the storage as it was when it began; what changed since comes after.
      if (this.storageWhileStarting.size > 0) {
        run.deliver([...this.storageWhileStarting].map(([key, value]) => ({ t: "storage", key, value }) as const));
        this.storageWhileStarting.clear();
      }
    } catch (caught) {
      if (token !== this.runToken) return;
      const message = caught instanceof Error ? caught.message : String(caught);
      this.publish({ status: this.snapshot.tree ? this.snapshot.status : "failed", problem: problemOf("compile", message, undefined, view) });
    }
  }

  /** Starts the source again without the carried state, once, when a swap asked for that. */
  private retryFresh(): boolean {
    if (!this.freshIfStateBreaks) return false;
    this.freshIfStateBreaks = false;
    void this.restart();
    return true;
  }

  private onPost(post: ViewPost, view: CompiledView, firstTree: boolean) {
    switch (post.t) {
      case "render": {
        if (firstTree) this.freshIfStateBreaks = false;
        const elapsed = this.options.now() - this.loadStartedAt;
        const next: Partial<ViewSnapshot> = { status: "running", tree: post.tree, rev: this.snapshot.rev + 1 };
        if (firstTree) {
          next.problem = null;
          if (this.snapshot.firstRenderMs === null) next.firstRenderMs = elapsed;
          else next.swapMs = elapsed;
        }
        const keys = (post as { keys?: string[] }).keys;
        if (keys) next.keys = keys;
        this.publish(next);
        return;
      }
      case "call":
        void this.answer(post.id, post.m, post.a);
        return;
      case "frame":
        this.wantFrame();
        return;
      case "log":
        this.log(post.level, post.text);
        return;
      case "error":
        if (firstTree && this.retryFresh()) {
          this.log("warn", `${post.phase}: ${post.message} (with the state it carried over; starting it fresh)`);
          return;
        }
        const problem = problemOf(post.phase, post.message, post.stack, view);
        // Before its first tree the view has nothing to show: it failed, rather than still loading.
        this.publish(this.snapshot.tree || this.snapshot.status !== "loading" ? { problem } : { status: "failed", problem });
        this.log("error", `${post.phase}: ${problem.message}`);
        return;
      case "state": {
        const waiter = this.stateWaiter;
        this.stateWaiter = null;
        waiter?.(post.hooks);
        return;
      }
      default:
        return;
    }
  }

  private log(level: string, text: string) {
    const entry = { level, text, at: this.options.now() };
    this.logs.push(entry);
    if (this.logs.length > LOG_LIMIT) this.logs.splice(0, this.logs.length - LOG_LIMIT);
    this.options.onLog?.(entry);
  }

  private wantFrame() {
    if (this.frameWanted) return;
    this.frameWanted = true;
    this.options.requestFrame((time) => {
      this.frameWanted = false;
      const dt = this.lastFrame === null ? 0 : time - this.lastFrame;
      this.lastFrame = time;
      this.deliver({ t: "frame", time, dt });
    });
  }

  private async answer(id: number, method: ViewCallMethod, args: unknown[]) {
    const context = { viewId: this.id, title: this.options.title };
    try {
      let value: unknown;
      const storage = this.options.storage;
      if (method === "storage.set") {
        const [key, v] = args as [string, unknown];
        if (this.storageCache) this.storageCache[key] = v;
        value = await storage.set(key, v);
      } else if (method === "storage.remove") {
        if (this.storageCache) delete this.storageCache[args[0] as string];
        value = await storage.remove(args[0] as string);
      } else if (method === "storage.clear") {
        this.storageCache = {};
        value = await storage.clear();
      } else {
        const capability = this.options.capabilities[method];
        if (!capability) throw new Error(`${method} isn't available here`);
        if (GESTURE_METHODS.has(method)) this.takeGesture(method);
        value = await capability(args, context);
      }
      this.deliver({ t: "reply", id, ok: true, v: value === undefined ? null : value });
    } catch (caught) {
      this.deliver({ t: "reply", id, ok: false, e: caught instanceof Error ? caught.message : String(caught) });
    }
  }

  private deliver(message: ViewMessage) {
    this.run?.deliver([message]);
  }

  private grantGesture() {
    this.gestureAt = this.options.now();
  }

  private takeGesture(method: ViewCallMethod) {
    const at = this.options.now();
    if (this.gestureAt === null || at - this.gestureAt > GESTURE_MS) throw new Error(`${method} works only right after the user presses something in the view`);
    this.gestureCalls = this.gestureCalls.filter((t) => at - t < 60_000);
    if (this.gestureCalls.length >= GESTURE_CALLS_PER_MINUTE) throw new Error(`${method} is limited to ${GESTURE_CALLS_PER_MINUTE} calls a minute per view`);
    this.gestureAt = null;
    this.gestureCalls.push(at);
  }

  private handlerName(handler: number): string | undefined {
    const tree = this.snapshot.tree;
    if (this.names?.tree !== tree) this.names = { tree, map: handlerNames(tree) };
    return this.names.map.get(handler);
  }

  /** A problem the host found (the file went away, it can't be read). */
  report(phase: string, message: string) {
    this.publish({ status: this.snapshot.tree ? this.snapshot.status : "failed", problem: { phase, message } });
  }

  /** A handler id from the tree fired (a press, a change). */
  dispatch(handler: number, value?: unknown) {
    const name = this.handlerName(handler);
    if (name && GESTURE_EVENTS.has(name)) this.grantGesture();
    this.deliver(value === undefined ? { t: "event", h: handler } : { t: "event", h: handler, v: value });
  }

  key(chord: string, key = chord) {
    this.grantGesture();
    this.deliver({ t: "key", chord, key });
  }

  setViewport(width: number, height: number) {
    const w = Math.round(width);
    const h = Math.round(height);
    if (w === this.viewport.width && h === this.viewport.height) return;
    this.viewport = { width: w, height: h };
    this.deliver({ t: "viewport", width: w, height: h });
  }

  setTheme(theme: ViewTheme) {
    if (theme.dark === this.theme.dark && theme.accent === this.theme.accent && theme.platform === this.theme.platform) return;
    this.theme = theme;
    this.deliver({ t: "theme", theme });
  }

  setData(data: unknown) {
    this.data = data;
    this.deliver({ t: "data", data });
  }

  /** Starts the current source again from scratch (after a crash, or "Restart"). */
  async restart(): Promise<void> {
    if (!this.view) return;
    this.freshIfStateBreaks = false;
    this.loadStartedAt = this.options.now();
    await this.start(this.view);
  }

  dispose() {
    this.disposed = true;
    this.runToken++;
    this.run?.stop();
    this.run = null;
    this.unsubscribeStorage?.();
    this.unsubscribeStorageProblems?.();
    this.listeners.clear();
  }
}
