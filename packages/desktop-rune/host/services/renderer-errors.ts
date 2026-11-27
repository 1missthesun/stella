// The UI and Electron main share one process on Rune. An error thrown by UI code (a React
// update in a WebSocket handler, say) must stay a renderer console error, as in Chromium, and
// never reach main's uncaughtException handler, which treats it as a main crash and opens a
// dialog. Listeners main adds for uncaught errors are wrapped so they skip errors whose
// throwing frame is in the UI bundle (its sourceURL carries `?swap=<n>`, see ui-loader.ts).

const EVENTS = new Set(["uncaughtException", "unhandledRejection"]);
const ADD = ["on", "addListener", "prependListener", "once", "prependOnceListener"] as const;
const REMOVE = ["off", "removeListener"] as const;

type Listener = (...args: any[]) => unknown;

export function thrownInUi(error: unknown): boolean {
  const stack = typeof (error as { stack?: unknown })?.stack === "string" ? (error as { stack: string }).stack : "";
  const frame = stack.split("\n").find((line) => /^\s+at .*[/\\]/.test(line));
  return frame !== undefined && /\?swap=\d+/.test(frame);
}

export function installRendererErrorRouting() {
  const proc = process as unknown as Record<string, (...args: any[]) => unknown>;
  const original = Object.fromEntries([...ADD, ...REMOVE].map((m) => [m, proc[m]!])) as Record<string, (...args: any[]) => unknown>;
  const wrappers = new WeakMap<Listener, Listener>();

  for (const method of ADD) {
    proc[method] = function (this: unknown, name: string, listener: Listener) {
      if (!EVENTS.has(name) || typeof listener !== "function") return original[method]!.call(this, name, listener);
      const wrapped = wrappers.get(listener) ?? function (this: unknown, error: unknown, ...rest: unknown[]) {
        if (thrownInUi(error)) return;
        return listener.call(this, error, ...rest);
      };
      wrappers.set(listener, wrapped);
      return original[method]!.call(this, name, wrapped);
    };
  }
  for (const method of REMOVE) {
    proc[method] = function (this: unknown, name: string, listener: Listener) {
      return original[method]!.call(this, name, (EVENTS.has(name) && wrappers.get(listener)) || listener);
    };
  }

  const unhandledElsewhere = (event: string, error: unknown) => {
    if (process.listenerCount(event) > 1) return;
    console.error(error);
    process.exit(1);
  };
  original.on!.call(process, "uncaughtException", (error: unknown) => {
    if (!thrownInUi(error)) return unhandledElsewhere("uncaughtException", error);
    console.error("[renderer] Uncaught", error);
    dispatchWindowEvent("error", { error, message: (error as Error)?.message ?? String(error) });
  });
  original.on!.call(process, "unhandledRejection", (reason: unknown) => {
    if (!thrownInUi(reason)) return unhandledElsewhere("unhandledRejection", reason);
    console.error("[renderer] Uncaught (in promise)", reason);
    dispatchWindowEvent("unhandledrejection", { reason });
  });
}

function dispatchWindowEvent(type: string, fields: Record<string, unknown>) {
  const target = globalThis as unknown as { dispatchEvent?: (event: Event) => boolean };
  if (typeof target.dispatchEvent !== "function") return;
  try {
    const event = type === "error" && typeof ErrorEvent === "function"
      ? new ErrorEvent("error", fields as ErrorEventInit)
      : Object.assign(new Event(type), fields);
    target.dispatchEvent(event);
  } catch {}
}
