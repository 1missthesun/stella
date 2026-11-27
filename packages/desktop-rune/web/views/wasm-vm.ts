// Stella Views' VM on the web: each run is a PsychoScript live run in a worker of its own
// (view-worker.ts). The WebAssembly is fetched and compiled once, on first use, and every worker
// instantiates that module; one worker is kept warm, so a view's first run and an agent's edit (a new
// run that takes over the old one's state) start without waiting for a worker.
import type { ViewExit, ViewRun, ViewVm } from "@stella/views/session";
import type { ViewInput, ViewMessage, ViewPost } from "@stella/views/protocol";
import wasmPath from "./vendor/psychoscript-web/psychoscript_web_bg.wasm";
import type { FromViewWorker, ToViewWorker } from "./worker-protocol";

/** The built worker's file name beside this chunk (web/build.ts builds it and defines this). */
declare const __STELLA_VIEW_WORKER__: string;

/** A warm worker nobody takes for this long is let go. */
const SPARE_IDLE_MS = 60_000;

let compiled: Promise<WebAssembly.Module> | null = null;

function wasmModule(): Promise<WebAssembly.Module> {
  if (compiled) return compiled;
  const url = new URL(wasmPath, import.meta.url);
  compiled = WebAssembly.compileStreaming(fetch(url))
    // A server that doesn't send `application/wasm` refuses streaming: compile the bytes instead.
    .catch(async () => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Couldn't load the views runtime (${response.status})`);
      return WebAssembly.compile(await response.arrayBuffer());
    })
    .catch((error: unknown) => {
      compiled = null;
      throw error;
    });
  return compiled;
}

type Spawned = { worker: Worker; ready: Promise<void> };

function spawn(): Spawned {
  const worker = new Worker(new URL(`./${__STELLA_VIEW_WORKER__}`, import.meta.url), { type: "module", name: "stella-view" });
  const ready = wasmModule().then(
    (module) =>
      new Promise<void>((resolve, reject) => {
        worker.onmessage = (event: MessageEvent<FromViewWorker>) => {
          if (event.data.t === "ready") resolve();
          else if (event.data.t === "initFailed") reject(new Error(event.data.message));
        };
        worker.onerror = (event) => reject(new Error(event.message || "The views worker didn't start"));
        worker.postMessage({ t: "init", module } satisfies ToViewWorker);
      }),
  );
  ready.catch(() => worker.terminate());
  return { worker, ready };
}

let spare: Spawned | null = null;
let spareTimer: ReturnType<typeof setTimeout> | null = null;

function keepSpare() {
  if (spareTimer) clearTimeout(spareTimer);
  spareTimer = null;
  if (!spare) {
    const next = spawn();
    spare = next;
    next.ready.catch(() => {
      if (spare === next) spare = null;
    });
  }
  spareTimer = setTimeout(() => {
    spareTimer = null;
    spare?.worker.terminate();
    spare = null;
  }, SPARE_IDLE_MS);
}

async function takeWorker(): Promise<Worker> {
  const taken = spare ?? spawn();
  spare = null;
  keepSpare();
  await taken.ready;
  return taken.worker;
}

/** Starts fetching and compiling the WebAssembly, and warms a worker (a view is about to show). */
export function preloadViews() {
  if (!spare) keepSpare();
}

type Events = Parameters<ViewVm["start"]>[2];

export function createWasmVm(): ViewVm & { pause(run: ViewRun): Promise<boolean>; resume(run: ViewRun): Promise<boolean> } {
  const workers = new WeakMap<ViewRun, Worker>();
  const toggle = (run: ViewRun, t: "pause" | "resume") => {
    const worker = workers.get(run);
    if (!worker) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const onMessage = (event: MessageEvent<FromViewWorker>) => {
        if (event.data.t !== "paused") return;
        worker.removeEventListener("message", onMessage);
        resolve(event.data.paused);
      };
      worker.addEventListener("message", onMessage);
      worker.postMessage({ t } satisfies ToViewWorker);
    });
  };
  return {
    async start(program: string, input: ViewInput, events: Events, limits: { sliceMs: number; heapBytes: number }): Promise<ViewRun> {
      const worker = await takeWorker();
      let done = false;
      const finish = (exit: ViewExit) => {
        if (done) return;
        done = true;
        worker.terminate();
        events.exit(exit);
      };
      const run: ViewRun = {
        deliver: (messages: ViewMessage[]) => {
          if (!done) worker.postMessage({ t: "deliver", messages } satisfies ToViewWorker);
        },
        stop: () => {
          if (done) return;
          done = true;
          worker.terminate();
        },
      };
      workers.set(run, worker);
      return new Promise<ViewRun>((resolve, reject) => {
        let started = false;
        worker.onmessage = (event: MessageEvent<FromViewWorker>) => {
          const message = event.data;
          switch (message.t) {
            case "started":
              started = true;
              resolve(run);
              return;
            case "startFailed":
              done = true;
              worker.terminate();
              reject(new Error(message.message));
              return;
            case "posts":
              if (!done) events.posts(message.posts as ViewPost[]);
              return;
            case "warning":
              events.warning?.(message.message);
              return;
            case "exit":
              finish({ kind: message.kind, ...(message.message ? { message: message.message } : {}) });
              return;
          }
        };
        worker.onerror = (event) => {
          const message = `The view's worker stopped: ${event.message || "unknown error"}`;
          if (!started) {
            done = true;
            worker.terminate();
            reject(new Error(message));
          } else finish({ kind: "failed", message });
        };
        worker.postMessage({ t: "start", program, input: JSON.stringify(input), sliceMs: limits.sliceMs, heapBytes: limits.heapBytes } satisfies ToViewWorker);
      });
    },
    pause: (run) => toggle(run, "pause"),
    resume: (run) => toggle(run, "resume"),
  };
}

/**
 * `stella.engine.views` on the web: the desktop engine's command set (engine/src/views.rs) over the
 * same workers, its runs' posts, warnings and exits sent as `views` engine events.
 */
type EngineViewsEvent =
  | { t: "views"; id: string; gen: number; kind: "posts" | "warning" | "exit"; posts?: unknown[]; message?: string; exit?: ViewExit["kind"] }
  | { t: "views"; id: ""; kind: "frame"; at: number };

export function createEngineViews(emit: (event: EngineViewsEvent) => void) {
  const vm = createWasmVm();
  const runs = new Map<string, { run: ViewRun; gen: number }>();
  let generation = 0;
  return {
    async start(o: { id: string; program: string; input: unknown; sliceMs?: number; heapBytes?: number }): Promise<{ gen: number }> {
      const gen = ++generation;
      const run = await vm.start(
        o.program,
        o.input as ViewInput,
        {
          posts: (posts) => emit({ t: "views", id: o.id, gen, kind: "posts", posts }),
          warning: (message) => emit({ t: "views", id: o.id, gen, kind: "warning", message }),
          exit: (exit) => {
            if (runs.get(o.id)?.gen === gen) runs.delete(o.id);
            emit({ t: "views", id: o.id, gen, kind: "exit", exit: exit.kind, ...(exit.message ? { message: exit.message } : {}) });
          },
        },
        { sliceMs: o.sliceMs ?? 100, heapBytes: o.heapBytes ?? 64 * 1024 * 1024 },
      );
      runs.get(o.id)?.run.stop();
      runs.set(o.id, { run, gen });
      return { gen };
    },
    deliver(id: string, messages: unknown[]) {
      runs.get(id)?.run.deliver(messages as ViewMessage[]);
    },
    stop(id: string) {
      const entry = runs.get(id);
      runs.delete(id);
      entry?.run.stop();
    },
    pause: async (id: string) => {
      const entry = runs.get(id);
      return entry ? vm.pause(entry.run) : false;
    },
    resume: async (id: string) => {
      const entry = runs.get(id);
      return entry ? vm.resume(entry.run) : false;
    },
    /** The page's next display frame, as the desktop engine's `views.frame`. */
    frame() {
      requestAnimationFrame((time) => emit({ t: "views", id: "", kind: "frame", at: performance.timeOrigin + time }));
    },
  };
}
