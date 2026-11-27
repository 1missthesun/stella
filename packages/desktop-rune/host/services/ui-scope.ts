// What a UI generation registers on the host's long-lived objects (window and document listeners,
// IPC and store subscriptions, timers, animation frames, sockets). A browser drops all of it with
// the page; a hot swap keeps the realm, so each registration belongs to the generation whose code
// made it (the calling frame's sourceURL carries `?swap=<n>`, see ui-loader.ts), whenever it was
// made, and is undone when the next generation replaces that one. Anything a replaced generation
// still tries to register (a reconnect timer, a listener from a late promise) is refused. Without
// this, every replaced UI stays reachable from a native listener or timer.

type Disposer = () => void;

type Generation = {
  id: number;
  retired: boolean;
  disposers: Set<Disposer>;
  /** Timeouts it had due soon when it was replaced, run once it is (see RETIRED_TIMEOUT_GRACE_MS). */
  due: { at: number; run: () => void }[];
  listeners: ListenerRecord[];
  sweepAt: number;
  /** What its callbacks handed to host methods stand in for (see `handOver`), dropped when it is replaced. */
  handed: { standIns: WeakMap<Function, Function>; targets: WeakMap<Function, Function> } | null;
};

type ListenerRecord = { target: WeakRef<object>; listener: WeakRef<object>; type: string; capture: boolean; dispose: Disposer };

const generations = new Map<number, Generation>();
const GENERATION_FRAME = /\?swap=(\d+)/;
/** A file of many modules (the UI's boot file, ui-registry.ts): which generation a line's code belongs to. */
const FILE_FRAME = /([^\s(]+\?swapfile):(\d+):\d+/;
const fileLines = new Map<string, (line: number) => number | undefined>();
/** Host files the UI reaches a registration through (DOM stand-ins, its electronAPI and renderer IPC, this file); the frame past them decides. */
const TRANSPARENT_FRAME = /[/\\]host[/\\](dom[/\\]|services[/\\](ui-scope|renderer-api)\.|electron[/\\]ipc\.)|[/\\]contracts[/\\]desktop[/\\]electron-api\.|\(native|at native|\[native code\]/;
const holder: { stack?: string } = {};
/**
 * A replaced generation's timeouts due within this run right after it is retired instead of
 * when due (a save or a socket teardown its unmount scheduled), so nothing waits on them;
 * later ones are dropped, as a closed page's are.
 */
const RETIRED_TIMEOUT_GRACE_MS = 5000;

/** The live or replaced generation whose code called `fn`, or null when host code did. */
function callerGeneration(fn: Function): Generation | null {
  if (generations.size === 0) return null;
  const limit = Error.stackTraceLimit;
  const prepare = (Error as { prepareStackTrace?: unknown }).prepareStackTrace;
  Error.stackTraceLimit = 8;
  (Error as { prepareStackTrace?: unknown }).prepareStackTrace = undefined;
  try {
    Error.captureStackTrace(holder, fn);
  } finally {
    Error.stackTraceLimit = limit;
    (Error as { prepareStackTrace?: unknown }).prepareStackTrace = prepare;
  }
  const stack = holder.stack ?? "";
  holder.stack = undefined;
  let start = stack.indexOf("\n");
  while (start >= 0) {
    const end = stack.indexOf("\n", start + 1);
    const line = stack.slice(start + 1, end < 0 ? undefined : end);
    const owner = GENERATION_FRAME.exec(line);
    if (owner) return generations.get(Number(owner[1])) ?? null;
    const inFile = fileLines.size > 0 ? FILE_FRAME.exec(line) : null;
    if (inFile) {
      const id = fileLines.get(inFile[1]!)?.(Number(inFile[2]));
      return id === undefined ? null : generations.get(id) ?? null;
    }
    if (!TRANSPARENT_FRAME.test(line)) return null;
    start = end;
  }
  return null;
}

const own = (generation: Generation, dispose: Disposer): Disposer => {
  generation.disposers.add(dispose);
  return () => generation.disposers.delete(dispose);
};

const captureOf = (options?: boolean | EventListenerOptions) => (typeof options === "boolean" ? options : !!options?.capture);

/** Forgets records whose listener is gone (a fired `once`, a removed closure), so a live generation's records stay bounded. */
function sweepListeners(generation: Generation) {
  generation.listeners = generation.listeners.filter((record) => {
    if (record.listener.deref() && record.target.deref()) return true;
    generation.disposers.delete(record.dispose);
    return false;
  });
  generation.sweepAt = Math.max(256, generation.listeners.length * 2);
}

let installed = false;

function install() {
  if (installed) return;
  installed = true;

  const proto = EventTarget.prototype;
  const addEventListener = proto.addEventListener;
  const removeEventListener = proto.removeEventListener;
  const add = function (this: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
    const generation = listener ? callerGeneration(add) : null;
    if (generation?.retired) return;
    addEventListener.call(this, type, listener, options);
    if (!generation || !listener) return;
    const capture = captureOf(options);
    if (generation.listeners.some((r) => r.listener.deref() === listener && r.target.deref() === this && r.type === type && r.capture === capture)) return;
    const target = new WeakRef(this);
    const listenerRef = new WeakRef(listener as object);
    const dispose = () => {
      const t = target.deref();
      const l = listenerRef.deref();
      if (t && l) removeEventListener.call(t, type, l as EventListenerOrEventListenerObject, { capture });
    };
    generation.disposers.add(dispose);
    generation.listeners.push({ target, listener: listenerRef, type, capture, dispose });
    if (generation.listeners.length > generation.sweepAt) sweepListeners(generation);
  };
  proto.addEventListener = add;

  const g = globalThis as unknown as EventTarget;
  const globalAdd = g.addEventListener;
  const globalRemove = g.removeEventListener;
  if (globalAdd !== proto.addEventListener) {
    const addGlobal = function (type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
      const generation = listener ? callerGeneration(addGlobal) : null;
      if (generation?.retired) return;
      globalAdd.call(g, type, listener, options);
      if (generation && listener) own(generation, () => globalRemove.call(g, type, listener, options));
    };
    g.addEventListener = addGlobal;
  }

  const timers = globalThis as unknown as Record<string, (...args: any[]) => any>;
  const setTimeoutNative = timers.setTimeout!;
  const setIntervalNative = timers.setInterval!;
  const clearTimeoutNative = timers.clearTimeout!;
  const clearIntervalNative = timers.clearInterval!;
  // On the timer object itself, not in a WeakMap: a WeakMap value reaches the UI's callback, and
  // JSC kept the replaced generations of a timer's key alive through it.
  const FORGET = Symbol("ui-scope.forget");
  const timerKey = (timer: unknown) => (typeof timer === "object" && timer !== null ? (timer as { [FORGET]?: Disposer }) : null);

  const scopedSetTimeout = function (this: unknown, callback: unknown, ...rest: unknown[]) {
    const generation = typeof callback === "function" ? callerGeneration(scopedSetTimeout) : null;
    if (!generation) return setTimeoutNative.call(this, callback, ...rest);
    if (generation.retired) return setTimeoutNative.call(this, () => {}, 0);
    let forget: Disposer = () => {};
    const due = performance.now() + (Number(rest[0]) || 0);
    const timer = setTimeoutNative.call(this, function (this: unknown, ...args: unknown[]) {
      forget();
      return (callback as Function).apply(this, args);
    }, ...rest);
    forget = own(generation, () => {
      clearTimeoutNative(timer);
      if (due - performance.now() <= RETIRED_TIMEOUT_GRACE_MS) generation.due.push({ at: due, run: () => (callback as Function)(...rest.slice(1)) });
    });
    const key = timerKey(timer);
    if (key) key[FORGET] = forget;
    return timer;
  };
  const scopedSetInterval = function (this: unknown, callback: unknown, ...rest: unknown[]) {
    const generation = typeof callback === "function" ? callerGeneration(scopedSetInterval) : null;
    if (!generation) return setIntervalNative.call(this, callback, ...rest);
    if (generation.retired) return setTimeoutNative.call(this, () => {}, 0);
    const timer = setIntervalNative.call(this, callback, ...rest);
    const key = timerKey(timer);
    const forget = own(generation, () => clearIntervalNative(timer));
    if (key) key[FORGET] = forget;
    return timer;
  };
  const clearScoped = (clear: (timer: unknown) => void) => function (this: unknown, timer: unknown) {
    const key = timerKey(timer);
    if (key) {
      key[FORGET]?.();
      key[FORGET] = undefined;
    }
    return clear.call(this, timer);
  };
  timers.setTimeout = Object.assign(scopedSetTimeout, setTimeoutNative);
  timers.setInterval = Object.assign(scopedSetInterval, setIntervalNative);
  timers.clearTimeout = clearScoped(clearTimeoutNative);
  timers.clearInterval = clearScoped(clearIntervalNative);
}

/** Also scopes `proto[method]`, which must return its own unsubscribe (IPC `on`, store `subscribe`). */
export function scopeDisposerMethod(proto: object, method: string) {
  const target = proto as Record<string, (...args: unknown[]) => unknown>;
  const original = target[method]!;
  const scoped = function (this: unknown, ...args: unknown[]) {
    const generation = callerGeneration(scoped);
    const off = original.apply(this, args);
    if (!generation || typeof off !== "function") return off;
    if (generation.retired) {
      (off as Disposer)();
      return off;
    }
    const forget = own(generation, off as Disposer);
    return function (this: unknown, ...offArgs: unknown[]) {
      forget();
      return (off as Function).apply(this, offArgs);
    };
  };
  target[method] = scoped;
}

/**
 * Scopes a one-shot callback scheduler such as requestAnimationFrame: a replaced generation's
 * pending callbacks are cancelled and it can't schedule new ones.
 */
export function scopeCallbackScheduler(host: Record<string, any>, schedule: string, cancel: string) {
  const original = host[schedule] as (callback: (...args: any[]) => unknown, ...rest: unknown[]) => unknown;
  const cancelOriginal = host[cancel] as (handle: unknown) => void;
  const forgets = new Map<unknown, Disposer>();
  const scoped = function (this: unknown, callback: (...args: any[]) => unknown, ...rest: unknown[]) {
    const generation = typeof callback === "function" ? callerGeneration(scoped) : null;
    if (!generation) return original.call(this, callback, ...rest);
    if (generation.retired) return 0;
    let handle: unknown;
    const forget = own(generation, () => {
      forgets.delete(handle);
      cancelOriginal.call(host, handle);
    });
    handle = original.call(this, function (this: unknown, ...args: unknown[]) {
      forget();
      forgets.delete(handle);
      return callback.apply(this, args);
    }, ...rest);
    forgets.set(handle, forget);
    return handle;
  };
  host[schedule] = scoped;
  host[cancel] = function (this: unknown, handle: unknown) {
    forgets.get(handle)?.();
    forgets.delete(handle);
    return cancelOriginal.call(this, handle);
  };
}

/** What a host call hands the UI that it must give back: an unsubscribe or release function, or a `Symbol.dispose` resource. */
function disposerOf(value: unknown): Disposer | null {
  if (typeof value === "function") return value as Disposer;
  const dispose = value !== null && typeof value === "object" ? (value as { [Symbol.dispose]?: unknown })[Symbol.dispose] : undefined;
  return typeof dispose === "function" ? () => dispose.call(value) : null;
}

/** `value` now belongs to `generation`: given back when it is replaced, or at once if it already was. */
function adopt(generation: Generation, value: unknown): unknown {
  const dispose = disposerOf(value);
  if (!dispose) return value;
  if (generation.retired) {
    try { dispose(); } catch {}
    return value;
  }
  const forget = own(generation, dispose);
  if (typeof value !== "function") return value;
  return function (this: unknown, ...args: unknown[]) {
    forget();
    return (value as Function).apply(this, args);
  };
}

/**
 * A host promise the UI awaits, handed over through a link the generation cuts when it is
 * replaced: a page that never settles (a media page that doesn't start) then holds nothing of
 * the replaced UI, and what it settles with later is given back (a lease is released).
 */
function relay(generation: Generation, source: PromiseLike<unknown>): Promise<unknown> {
  let link: { resolve(value: unknown): void; reject(error: unknown): void } | null = null;
  const settled = new Promise((resolve, reject) => { link = { resolve, reject }; });
  const cut = own(generation, () => { link = null; });
  source.then(
    (value) => {
      cut();
      const to = link;
      link = null;
      const adopted = adopt(generation, value);
      to?.resolve(adopted);
    },
    (error) => {
      cut();
      const to = link;
      link = null;
      to?.reject(error);
    },
  );
  return settled;
}

const retiredCallback = () => undefined;

/**
 * The callback `fn` as a host method may keep it (a sink, a subscriber, a page's event handler):
 * a stand-in that calls it until `generation` is replaced and does nothing after, so a host that
 * keeps it past then (a call that never settles) holds none of the replaced UI. The same `fn`
 * gets the same stand-in, so a later removal by identity still matches.
 */
function handOver(generation: Generation, fn: Function): Function {
  const handed = generation.handed;
  if (!handed) return retiredCallback;
  let standIn = handed.standIns.get(fn);
  if (standIn) return standIn;
  standIn = function (this: unknown, ...args: unknown[]) {
    return generation.handed?.targets.get(standIn!)?.apply(this, args);
  };
  handed.standIns.set(fn, standIn);
  handed.targets.set(standIn, fn);
  return standIn;
}

const scopedCalls = new WeakSet<Function>();

function scopeCall(original: Function): Function {
  if (scopedCalls.has(original)) return original;
  const scoped = function (this: unknown, ...args: unknown[]) {
    const generation = callerGeneration(scoped);
    if (generation) args = args.map((arg) => (typeof arg === "function" ? handOver(generation, arg) : arg));
    const result = original.apply(this, args);
    if (!generation) return result;
    if (result !== null && (typeof result === "object" || typeof result === "function") && typeof (result as PromiseLike<unknown>).then === "function") {
      return relay(generation, result as PromiseLike<unknown>);
    }
    return adopt(generation, result);
  };
  Object.defineProperty(scoped, "name", { value: original.name });
  scopedCalls.add(scoped);
  return scoped;
}

/**
 * Hands `surface` (an object the host gives the UI: `globalThis.stella`, its `host`, the chat
 * feed) to hot-swapped generations. Every method on it, on its nested objects and on the classes
 * of its class instances (the media pages) gives the calling generation what it returns: an
 * unsubscribe or release function or a `Symbol.dispose` resource is given back when that
 * generation is replaced, and a promise reaches it only while it is live. Host callers are
 * untouched. `skip` names methods that only read (called on every render).
 */
export function scopeUiFacing<T extends object>(surface: T, skip: readonly string[] = []): T {
  const visit = (target: object, seen: WeakSet<object>) => {
    if (seen.has(target)) return;
    seen.add(target);
    for (const key of Object.getOwnPropertyNames(target)) {
      if (key === "constructor" || skip.includes(key)) continue;
      const descriptor = Object.getOwnPropertyDescriptor(target, key);
      if (!descriptor || !("value" in descriptor)) continue;
      const value = descriptor.value as unknown;
      if (typeof value === "function") {
        if (descriptor.writable || descriptor.configurable) Object.defineProperty(target, key, { ...descriptor, value: scopeCall(value) });
      } else if (value !== null && typeof value === "object" && Object.prototype.toString.call(value) === "[object Object]") {
        const proto = Object.getPrototypeOf(value);
        if (proto === Object.prototype || proto === null) visit(value, seen);
        else for (let p = proto; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) visit(p, seen);
      }
    }
  };
  visit(surface, new WeakSet());
  return surface;
}

/**
 * Ties a resource the caller's generation opened (a WebSocket) to that generation: closed when it
 * is replaced, refused once it is.
 */
export function ownByCaller(fn: Function, close: Disposer): "live" | "host" | "retired" {
  const generation = callerGeneration(fn);
  if (!generation) return "host";
  if (generation.retired) return "retired";
  own(generation, close);
  return "live";
}

export type UiScope = { dispose(): void };

/** Code in `url` (a sourceURL ending in `?swapfile`) belongs to the generation `owner` gives for its line; `null` forgets the file. */
export function mapFileLines(url: string, owner: ((line: number) => number | undefined) | null) {
  if (owner) fileLines.set(url, owner);
  else fileLines.delete(url);
}

/** Opens generation `id` (the `?swap=<id>` in its code's sourceURL) and runs `evaluate`; the scope undoes everything it registers. */
export function evaluateInScope<T>(id: number, evaluate: () => T): { value: T; scope: UiScope } {
  install();
  const generation: Generation = { id, retired: false, disposers: new Set(), due: [], listeners: [], sweepAt: 256, handed: { standIns: new WeakMap(), targets: new WeakMap() } };
  generations.set(id, generation);
  const scope: UiScope = {
    dispose() {
      generation.retired = true;
      generation.handed = null;
      const disposers = [...generation.disposers];
      generation.disposers.clear();
      generation.listeners = [];
      for (const dispose of disposers) {
        try { dispose(); } catch {}
      }
      const due = generation.due.splice(0).sort((a, b) => a.at - b.at);
      for (const timeout of due) {
        try { timeout.run(); } catch (error) { console.error("[ui] a replaced UI's timeout failed:", error); }
      }
    },
  };
  try {
    return { value: evaluate(), scope };
  } catch (error) {
    scope.dispose();
    throw error;
  }
}
