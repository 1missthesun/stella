// Registrations a UI generation makes on the host's long-lived objects while its modules evaluate
// (window and document listeners, IPC listeners, intervals). A browser drops them with the page; a
// hot swap keeps the realm, so they are undone when the next generation replaces this one, or
// every generation stays reachable from them.

type Disposer = () => void;

let active: Disposer[] | null = null;
let installed = false;

const record = (dispose: Disposer) => {
  active?.push(dispose);
};

function install() {
  if (installed) return;
  installed = true;

  const proto = EventTarget.prototype;
  const addEventListener = proto.addEventListener;
  proto.addEventListener = function (this: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
    addEventListener.call(this, type, listener, options);
    if (active && listener) record(() => this.removeEventListener(type, listener, options));
  };

  const g = globalThis as unknown as EventTarget;
  const globalAdd = g.addEventListener;
  const globalRemove = g.removeEventListener;
  if (globalAdd !== proto.addEventListener) {
    g.addEventListener = function (type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
      globalAdd.call(g, type, listener, options);
      if (active && listener) record(() => globalRemove.call(g, type, listener, options));
    };
  }

  const setIntervalNative = globalThis.setInterval;
  globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
    const timer = setIntervalNative(...args);
    if (active) record(() => clearInterval(timer));
    return timer;
  }) as typeof setInterval;
}

/** Also scopes `proto[method]`, which must return its own unsubscribe (IPC `on`, store `subscribe`). */
export function scopeDisposerMethod(proto: object, method: string) {
  const target = proto as Record<string, (...args: unknown[]) => unknown>;
  const original = target[method]!;
  target[method] = function (this: unknown, ...args: unknown[]) {
    const off = original.apply(this, args);
    if (active && typeof off === "function") record(off as Disposer);
    return off;
  };
}

export type UiScope = { dispose(): void };

/** Runs `evaluate` recording what it registers; the returned scope undoes it. */
export function evaluateInScope<T>(evaluate: () => T): { value: T; scope: UiScope } {
  install();
  const disposers: Disposer[] = [];
  const outer = active;
  active = disposers;
  const scope: UiScope = {
    dispose() {
      for (const dispose of disposers.splice(0)) {
        try { dispose(); } catch {}
      }
    },
  };
  try {
    return { value: evaluate(), scope };
  } catch (error) {
    scope.dispose();
    throw error;
  } finally {
    active = outer;
  }
}
