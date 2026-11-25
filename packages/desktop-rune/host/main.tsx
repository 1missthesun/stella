// Entry of the TS UI host. Spawned by the compiled Rune engine, which owns the bridge fds
// (host/ELEMENTS.md); all logging goes to stderr. Builds the app entry (STELLA_RUNE_APP, default
// ui/App.tsx), renders it and hot-swaps it on edits.

import "./services/stdio";
import { watch, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createElement } from "react";
import * as bridge from "./bridge";
import { command, commitCtx, engine, listen, now, onEngineEvent, stats } from "./bridge";
import { batched, render, windowPortal } from "./reconciler";
import { createStore, makeUseStore } from "./store";
import { applyUiEnv } from "./services/ui-env";
import { createUiLoader } from "./services/ui-loader";
import type { RuneServices } from "./services/boot";
import type { ControlContext } from "./services/control";

const t_boot = now();
const ROOT = join(import.meta.dir, "..");
const APP_ENTRY = resolve(ROOT, process.env.STELLA_RUNE_APP ?? "ui/App.tsx");
const APP_DIR = dirname(APP_ENTRY);
const SERVICES = process.env.STELLA_RUNE_SERVICES === "1";

applyUiEnv();
const ui = createUiLoader({
  entry: APP_ENTRY,
  tsconfig: join(ROOT, "tsconfig.build.json"),
  external: ["react", "react/jsx-runtime", "react/jsx-dev-runtime"],
});
ui.warm();

let swapN = 0;
async function loadApp(): Promise<any> {
  const mod = await ui.load();
  swapN++;
  return mod;
}

const quit = (code: number) => {
  command({ cmd: "quit" });
  setTimeout(() => process.exit(code), 1000).unref();
};

process.on("unhandledRejection", (err) => console.error("[ui] unhandled rejection:", err));
void listen();

let services: RuneServices | null = null;
if (SERVICES) {
  const { bootRuneServices } = await import("./services/boot");
  services = await bootRuneServices({ bridge, exit: quit });
}

let app = await loadApp();
const store = createStore(app.initialState?.() ?? {});
const g = globalThis as any;
g.stella = { store, useStore: makeUseStore(store), command, now, engine, on: onEngineEvent, windowPortal };
if (services) g.stella.host = (await import("./services/ui-host")).createUiHost();

/** An app exporting `Root` renders its own `<window>`s; `App` is wrapped in the main window. */
const root = () => app.Root ? createElement(app.Root) : createElement("window", { id: "main" }, createElement(app.App));
const t_loaded = now();
render(root(), { t0: t_boot });
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
  let mtime = 0;
  try { mtime = statSync(join(APP_DIR, changed)).mtimeMs; } catch {}
  await applySwap(changed, t_seen, mtime);
}

async function applySwap(label: string, t0: number, mtime = t0): Promise<boolean> {
  try {
    const next = await loadApp();
    const t_built = now();
    app = next;
    store.set((s) => ({ error: null, swaps: s.swaps + 1 }));
    render(root(), { t0, kind: 1 });
    const t_committed = now();
    store.set({ lastSwapMs: Math.round(t_committed - t0) });
    console.error(`[ui] hot swap #${swapN} ${label}: save→seen ${(t0 - mtime).toFixed(1)} ms, bundle+load ${(t_built - t0).toFixed(1)} ms, render+send ${(t_committed - t_built).toFixed(1)} ms`);
    return true;
  } catch (err) {
    // A broken edit never takes the UI down: the old app keeps running, the error shows.
    console.error("[ui] hot swap failed, keeping the running UI:", err);
    store.set({ error: String((err as Error).message ?? err).slice(0, 400) });
    return false;
  }
}

// ---------------------------------------------------------------- engine events
const waiters = new Map<string, (v: unknown) => void>();
let lastInput = now();
onEngineEvent("rec", (e) => { waiters.get("rec")?.(e.result); waiters.delete("rec"); });
onEngineEvent("ev", (e) => {
  if (e.input) lastInput = now();
  if (e.e === "key" && app.onKey) batched(() => { commitCtx.ack = e.seq; commitCtx.t0 = e.at; app.onKey(e.chord, store); });
});


// ---------------------------------------------------------------- services
let control: ControlContext | null = null;
if (services) {
  const { setUiSwapTarget } = await import("./services/renderer-source");
  setUiSwapTarget({
    async apply(paths) {
      const ok = await applySwap(paths.join(", ") || "app-source", now());
      return ok ? { mode: "swap", swaps: swapN } : { mode: "failed", error: store.get().error ?? "swap failed", reloaded: false };
    },
    async quietFor() { return now() - lastInput; },
  });
  const { startChatFeed } = await import("./services/chat-feed");
  startChatFeed(services.api, store).then(
    (feed) => { g.stella.chat = feed; console.error(`[host] chat feed on conversation ${feed.conversationId}`); },
    (err) => console.error("[host] chat feed failed:", err),
  );
  control = { api: services.api };
}

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
        command({ cmd: "scrollTo", target: "chat-scroll", y: 0, spring: glide });
        await sleep(glide * 1000 + 150);
        command({ cmd: "scrollTo", target: "chat-scroll", y: "end", spring: glide });
        await sleep(glide * 1000 + 150);
      }
    });
  },
  async wheel(q) {
    const dur = Number(q.get("dur") ?? 5);
    return rec("wheel", async () => {
      command({ cmd: "scrollRun", target: "chat-scroll", speed: Number(q.get("speed") ?? 4000), dur });
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
    command({ cmd: "scrollTo", target: "chat-scroll", y: Number(q.get("y") ?? 0), spring: Number(q.get("spring") ?? 0) });
    return true;
  },
  async stats() { return { ...stats, swaps: swapN, rss_mb: process.memoryUsage().rss / 1048576, heap_mb: process.memoryUsage().heapUsed / 1048576 }; },
  async swap(q) {
    const n = Number(q.get("n") ?? 1);
    const rss = () => { Bun.gc(true); return Math.round(process.memoryUsage().rss / 1048576 * 10) / 10; };
    const samples = [rss()];
    for (let i = 1; i <= n; i++) {
      await applySwap(`bench ${i}`, now());
      if (i % 10 === 0 || i === n) samples.push(rss());
    }
    await sleep(2600);
    return { swaps: swapN, rss_mb: samples, settled_rss_mb: rss() };
  },
  async quit() { setTimeout(() => command({ cmd: "quit" }), 50); return true; },
};

const port = Number(process.env.STELLA_RUNE_CTL_PORT ?? 0);
if (port) {
  Bun.serve({
    port,
    hostname: "127.0.0.1",
    idleTimeout: 255,
    async fetch(req) {
      if (control) {
        const { handleControl } = await import("./services/control");
        const handled = await handleControl(req, control);
        if (handled) return handled;
      }
      const u = new URL(req.url);
      if (u.pathname === "/control/input") {
        const body = await req.json() as { events: unknown[]; window?: string };
        return Response.json(await engine.control.input(body.events as any, body.window ?? u.searchParams.get("window") ?? undefined));
      }
      if (u.pathname === "/control/elements") {
        return Response.json(await engine.control.elements(u.searchParams.get("window") ?? undefined, u.searchParams.get("key") ?? undefined));
      }
      if (u.pathname === "/control/request") {
        const body = await req.json() as { cmd: string } & Record<string, unknown>;
        return Response.json(await engine.request(body.cmd, body).catch((e: Error) => ({ error: e.message })));
      }
      const fn = bench[u.pathname.slice(1)];
      if (!fn) return new Response("unknown", { status: 404 });
      return Response.json(await fn(u.searchParams));
    },
  });
  console.error(`[ui] bench control on 127.0.0.1:${port}`);
}
