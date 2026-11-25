// Entry of the TS UI host. Spawned by the compiled Rune engine; stdout is the bridge, so all
// logging goes to stderr. Watches ui/app/ and hot-swaps it into the running engine.

console.log = console.error;
console.info = console.error;

import { watch, statSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { command, commitCtx, listen, now, stats, type EngineEvent } from "./bridge";
import { batched, handlers, render } from "./reconciler";
import { createStore, makeUseStore } from "./store";

const t_boot = now();
const ROOT = join(import.meta.dir, "..");
const APP_DIR = join(ROOT, "ui");
const HOT = join(ROOT, ".hot");
rmSync(HOT, { recursive: true, force: true });
mkdirSync(HOT, { recursive: true });

let swapN = 0;
async function loadApp(): Promise<any> {
  const n = ++swapN;
  const res = await Bun.build({
    entrypoints: [join(APP_DIR, "App.tsx")],
    external: ["react", "react/jsx-runtime", "react/jsx-dev-runtime"],
    target: "bun",
    format: "esm",
    tsconfig: join(ROOT, "tsconfig.build.json"),
  } as any);
  if (!res.success) throw new Error(res.logs.map((l) => String(l)).join("\n"));
  const file = join(HOT, `app-${n}.js`);
  await Bun.write(file, await res.outputs[0].text());
  const mod = await import(file);
  // Keep the folder small: older builds are already evaluated.
  for (const f of readdirSync(HOT)) if (f !== `app-${n}.js`) rmSync(join(HOT, f), { force: true });
  return mod;
}

let app = await loadApp();
const store = createStore(app.initialState());
const g = globalThis as any;
g.stella = { store, useStore: makeUseStore(store), command, now };

const t_loaded = now();
render(createElement(app.App), { t0: t_boot });
console.error(`[ui] boot ${(t_loaded - t_boot).toFixed(1)} ms load+bundle, first commit ${(now() - t_loaded).toFixed(1)} ms, ${stats.ops} ops / ${stats.bytes} bytes`);

// ---------------------------------------------------------------- hot swap
let pending: ReturnType<typeof setTimeout> | null = null;
let changed = "";
let t_seen = 0;
watch(APP_DIR, { recursive: true }, (_ev, file) => {
  if (!file || !/\.(tsx?|json)$/.test(file)) return;
  if (!pending) t_seen = now();
  changed = file;
  if (pending) clearTimeout(pending);
  pending = setTimeout(swap, 4); // coalesce the editor's write events
});

async function swap() {
  pending = null;
  const t0 = t_seen;
  let mtime = 0;
  try { mtime = statSync(join(APP_DIR, changed)).mtimeMs; } catch {}
  try {
    const next = await loadApp();
    const t_built = now();
    app = next;
    store.set((s) => ({ error: null, swaps: s.swaps + 1 }));
    render(createElement(app.App), { t0, kind: 1 });
    const t_committed = now();
    store.set({ lastSwapMs: Math.round(t_committed - t0) });
    console.error(`[ui] hot swap #${swapN} ${changed}: save→seen ${(t0 - mtime).toFixed(1)} ms, bundle+import ${(t_built - t0).toFixed(1)} ms, render+send ${(t_committed - t_built).toFixed(1)} ms`);
  } catch (err) {
    // A broken edit never takes the UI down: the old app keeps running, the error shows.
    console.error("[ui] hot swap failed, keeping the running UI:", err);
    store.set({ error: String((err as Error).message ?? err).slice(0, 400) });
  }
}

// ---------------------------------------------------------------- engine events
const waiters = new Map<string, (v: unknown) => void>();
listen((e: EngineEvent) => {
  if (e.t === "rec") { waiters.get("rec")?.(e.result); waiters.delete("rec"); return; }
  const h = handlers.get(e.key);
  batched(() => {
    commitCtx.ack = e.seq;
    commitCtx.t0 = e.at;
    if (e.t === "press") h?.onPress?.();
    else if (e.t === "input") h?.onInput?.(e.value ?? "");
    else if (e.t === "submit") h?.onSubmit?.(e.value ?? "");
    else if (e.t === "key") app.onKey?.(e.key, store);
  });
});


// ---------------------------------------------------------------- bench control (opt-in)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function rec<T>(label: string, run: () => Promise<T>) {
  return new Promise(async (resolve) => {
    command({ cmd: "recStart", label });
    await run();
    waiters.set("rec", resolve);
    command({ cmd: "recStop" });
  });
}

const bench: Record<string, (q: URLSearchParams) => Promise<unknown>> = {
  async scroll(q) {
    const cycles = Number(q.get("cycles") ?? 6);
    const glide = Number(q.get("glide") ?? 0.5);
    return rec("scroll", async () => {
      for (let i = 0; i < cycles; i++) {
        command({ cmd: "scrollTo", key: "chat-scroll", y: 0, spring: glide });
        await sleep(glide * 1000 + 150);
        command({ cmd: "scrollTo", key: "chat-scroll", y: "end", spring: glide });
        await sleep(glide * 1000 + 150);
      }
    });
  },
  async wheel(q) {
    const dur = Number(q.get("dur") ?? 5);
    return rec("wheel", async () => {
      command({ cmd: "scrollRun", key: "chat-scroll", speed: Number(q.get("speed") ?? 4000), dur });
      await sleep(dur * 1000 + 100);
    });
  },
  async sidebar(q) {
    const n = Number(q.get("n") ?? 8);
    return rec("sidebar", async () => {
      for (let i = 0; i < n; i++) {
        batched(() => { commitCtx.t0 = now(); store.set((s) => ({ sidebarOpen: !s.sidebarOpen })); });
        await sleep(450);
      }
    });
  },
  async theme(q) {
    const n = Number(q.get("n") ?? 4);
    return rec("theme", async () => {
      for (let i = 0; i < n; i++) {
        batched(() => store.set((s) => ({ dark: !s.dark })));
        await sleep(700);
      }
    });
  },
  async resize(q) {
    const dur = Number(q.get("dur") ?? 2);
    return rec("resize", async () => {
      command({ cmd: "resizeAnim", w: Number(q.get("w") ?? 1280), h: Number(q.get("h") ?? 820), w2: 860, h2: 620, dur });
      await sleep(dur * 1000 + 200);
    });
  },
  async recstart(q) { command({ cmd: "recStart", label: q.get("label") ?? "external" }); return true; },
  async recstop() { return new Promise((resolve) => { waiters.set("rec", resolve); command({ cmd: "recStop" }); }); },
  async idle(q) {
    const ms = Number(q.get("ms") ?? 3000);
    return rec("idle", () => sleep(ms));
  },
  async set(q) {
    const patch: any = {};
    for (const [k, v] of q) patch[k] = v === "true" ? true : v === "false" ? false : v;
    batched(() => store.set(patch));
    return store.get().dark;
  },
  async scrollto(q) {
    command({ cmd: "scrollTo", key: "chat-scroll", y: Number(q.get("y") ?? 0), spring: Number(q.get("spring") ?? 0) });
    return true;
  },
  async stats() { return { ...stats, swaps: swapN, rss_mb: process.memoryUsage().rss / 1048576, heap_mb: process.memoryUsage().heapUsed / 1048576 }; },
  async quit() { setTimeout(() => command({ cmd: "quit" }), 50); return true; },
};

const port = Number(process.env.STELLA_RUNE_CTL_PORT ?? 0);
if (port) {
  Bun.serve({
    port,
    hostname: "127.0.0.1",
    idleTimeout: 255,
    async fetch(req) {
      const u = new URL(req.url);
      const fn = bench[u.pathname.slice(1)];
      if (!fn) return new Response("unknown", { status: 404 });
      return Response.json(await fn(u.searchParams));
    },
  });
  console.error(`[ui] bench control on 127.0.0.1:${port}`);
}
