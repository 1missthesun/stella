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
  listeners: ListenerRecord[];
  sweepAt: number;
};

type ListenerRecord = { target: WeakRef<object>; listener: WeakRef<object>; type: string; capture: boolean; dispose: Disposer };

const generations = new Map<number, Generation>();
const GENERATION_FRAME = /\?swap=(\d+)/;
/** Host files the UI reaches a registration through (DOM stand-ins, this file); the frame past them decides. */
const TRANSPARENT_FRAME = /[/\\]host[/\\](dom[/\\]|services[/\\]ui-scope\.)|\(native|at native|\[native code\]/;
const holder: { stack?: string } = {};
/** A replaced generation's timeouts due within this still run once (a save its unmount scheduled). */
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
  const timerDisposers = new WeakMap<object, Disposer>();
  const timerKey = (timer: unknown) => (typeof timer === "object" && timer !== null ? timer : null);

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
      if (due - performance.now() > RETIRED_TIMEOUT_GRACE_MS) clearTimeoutNative(timer);
    });
    const key = timerKey(timer);
    if (key) timerDisposers.set(key, forget);
    return timer;
  };
  const scopedSetInterval = function (this: unknown, callback: unknown, ...rest: unknown[]) {
    const generation = typeof callback === "function" ? callerGeneration(scopedSetInterval) : null;
    if (!generation) return setIntervalNative.call(this, callback, ...rest);
    if (generation.retired) return setTimeoutNative.call(this, () => {}, 0);
    const timer = setIntervalNative.call(this, callback, ...rest);
    const key = timerKey(timer);
    const forget = own(generation, () => clearIntervalNative(timer));
    if (key) timerDisposers.set(key, forget);
    return timer;
  };
  const clearScoped = (clear: (timer: unknown) => void) => function (this: unknown, timer: unknown) {
    const key = timerKey(timer);
    if (key) {
      timerDisposers.get(key)?.();
      timerDisposers.delete(key);
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

/** Opens generation `id` (the `?swap=<id>` in its code's sourceURL) and runs `evaluate`; the scope undoes everything it registers. */
export function evaluateInScope<T>(id: number, evaluate: () => T): { value: T; scope: UiScope } {
  install();
  const generation: Generation = { id, retired: false, disposers: new Set(), listeners: [], sweepAt: 256 };
  generations.set(id, generation);
  const scope: UiScope = {
    dispose() {
      generation.retired = true;
      const disposers = [...generation.disposers];
      generation.disposers.clear();
      generation.listeners = [];
      for (const dispose of disposers) {
        try { dispose(); } catch {}
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
