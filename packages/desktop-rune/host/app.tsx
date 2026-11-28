// The TS UI host (started by host/main.tsx): builds the app entry (STELLA_RUNE_APP, default
// ui/App.tsx), renders it and hot-swaps it on edits.

import { bootMark } from "./services/boot-trace";
import { watch, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createElement } from "react";
import * as bridge from "./bridge";
import { command, commitCtx, engine, listen, now, onEngineEvent, stats } from "./bridge";
import { batched, pressedByKeys, render, replayLayouts, windowPortal } from "./reconciler";
import { createStore, makeUseStore } from "./store";
import { applyUiEnv } from "./services/ui-env";
import { createUiLoader } from "./services/ui-loader";
import { appUiSpec } from "./services/app-ui-spec";
import { scopeUiFacing } from "./services/ui-scope";
import { installRendererErrorRouting } from "./services/renderer-errors";
import { holdDeliveries, releaseDeliveries } from "./electron/ipc";
import type { RuneServices } from "./services/boot";
import type { ControlContext } from "./services/control";

const SWAP_QUIET_MS = 80;
const SWAP_HOLD_MAX_MS = Number(process.env.STELLA_RUNE_SWAP_HOLD_MS ?? 1000);
/** The engine transitions only what a swap changed (engine/src/swapfx.rs); `STELLA_RUNE_SWAP_FX=0` lands swaps at once. */
const SWAP_FX = process.env.STELLA_RUNE_SWAP_FX !== "0";

export async function runHost(options: { bundled?: boolean } = {}): Promise<void> {
  const t_boot = now();
  bootMark("host-imports-done");
  const ROOT = join(import.meta.dir, "..");
  const UI_SPEC = appUiSpec();
  const APP_ENTRY = UI_SPEC.entry;
  const APP_DIR = UI_SPEC.dir;
  const SERVICES = process.env.STELLA_RUNE_SERVICES === "1";

  installRendererErrorRouting();
  applyUiEnv();
  const ui = createUiLoader({
    entry: APP_ENTRY,
    tsconfig: UI_SPEC.tsconfig,
    external: UI_SPEC.external,
    bootCache: process.env.STELLA_RUNE_UI_CACHE !== "0",
    modules: "swap",
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
    bootMark("services-booted");
  } else {
    const { installDom } = await import("./dom");
    const dark = await engine.appearance.get().then((a) => a.dark, () => true);
    installDom({
      url: "stella-app://desktop/index.html?window=full",
      appearance: { dark },
      viewport: { width: Number(process.env.STELLA_RUNE_W ?? 1400), height: Number(process.env.STELLA_RUNE_H ?? 940), devicePixelRatio: 1 },
    });
  }

  // A bundler that died before building gets one fresh process before the launch fails.
  let app = await loadApp().catch((error: unknown) => {
    console.error("[ui] first load failed, building again:", error instanceof Error ? error.message : error);
    return loadApp();
  });
  bootMark("ui-loaded");
  const store = createStore(app.initialState?.() ?? {});
  const g = globalThis as any;
  // Everything the UI reaches through `stella` is owned by the generation that called it (ui-scope.ts).
  const READS = ["get", "useStore", "now", "snapshot", "pressedByKeys", "peers", "computerForConversation", "nearby", "confirming"];
  g.stella = scopeUiFacing({ store, useStore: makeUseStore(store), command, now, engine, on: onEngineEvent, windowPortal, pressedByKeys }, READS);
  if (services) g.stella.host = scopeUiFacing((await import("./services/ui-host")).createUiHost(), READS);
  g.stella.views = scopeUiFacing((await import("./views/views-host")).createViewsHost(engine, onEngineEvent), ["snapshot", "isViewPath", "logs", "syncState", "history", "previewing"]);

  /** An app exporting `Root` renders its own `<window>`s; `App` is wrapped in the main window. */
  const root = () => ui.wrap(app.Root ? createElement(app.Root) : createElement("window", { id: "main" }, createElement(app.App)));
  const t_loaded = now();
  render(root(), { t0: t_boot });
  bootMark("ui-rendered");
  if (!options.bundled) setTimeout(() => void import("./services/host-bundle").then((b) => b.buildHostBundle()), 10_000).unref();
  console.error(`[ui] boot ${(t_loaded - t_boot).toFixed(1)} ms load+bundle, first commit ${(now() - t_loaded).toFixed(1)} ms, ${stats.ops} ops / ${stats.bytes} bytes`);

  // ---------------------------------------------------------------- hot swap
  let pending: ReturnType<typeof setTimeout> | null = null;
  let changed = "";
  let t_seen = 0;
  const builtMtime = new Map<string, number>();
  watch(APP_DIR, { recursive: true }, (_ev, file) => {
    if (!file || !/\.(tsx?|json)$/.test(file)) return;
    if (/\.view\.(tsx|ts|jsx|js)$/i.test(file)) return; // a Stella View: views-host runs it, not the app
    let mtime = -1;
    try { mtime = statSync(join(APP_DIR, file)).mtimeMs; } catch {}
    if (!pending && builtMtime.get(file) === mtime) return;
    builtMtime.set(file, mtime);
    if (!pending) t_seen = now();
    changed = file;
    if (pending) clearTimeout(pending);
    pending = setTimeout(swap, 4); // coalesce the editor's write events
  });

  let watchSwap: Promise<boolean> | null = null;
  let watchSwapStartedAt = 0;
  let watchSwapOk = false;
  function swap() {
    if (pending) clearTimeout(pending);
    pending = null;
    let mtime = 0;
    try { mtime = statSync(join(APP_DIR, changed)).mtimeMs; } catch {}
    watchSwapStartedAt = Date.now();
    const running = applySwap(changed, t_seen, mtime);
    watchSwap = running;
    void running.then((ok) => { if (watchSwap === running) { watchSwapOk = ok; watchSwap = null; } });
    return running;
  }

  /** A file the watcher's last swap already built from, i.e. one written before that swap started. */
  const builtByWatcher = (file: string) => {
    const absolute = resolve(ROOT, "../..", file);
    if (!absolute.startsWith(APP_DIR + "/")) return false;
    try { return statSync(absolute).mtimeMs <= watchSwapStartedAt; } catch { return watchSwapStartedAt > 0; }
  };

  /** An app-source update has already moved the files, so a swap the watcher has seen covers it. */
  function swapForUpdate(paths: string[]): Promise<boolean> {
    if (pending) return swap();
    if (watchSwap) return watchSwap;
    if (watchSwapOk && paths.length > 0 && paths.every(builtByWatcher)) return Promise.resolve(true);
    return applySwap(paths.join(", ") || "app-source", now());
  }

  let swapTail: Promise<unknown> = Promise.resolve();
  let swapWaiting: Promise<boolean> | null = null;
  /** One swap at a time, in order; requests made while one waits join it (it builds the newest files). */
  function applySwap(label: string, t0: number, mtime = t0): Promise<boolean> {
    if (swapWaiting) return swapWaiting;
    const run = swapTail.then(() => {
      swapWaiting = null;
      return runSwap(label, t0, mtime);
    });
    swapWaiting = run;
    swapTail = run;
    return run;
  }

  /** The new tree is shown once its commits have gone quiet (its data has loaded), the user acts, or the deadline passes. */
  function settled(from: number): Promise<string> {
    return new Promise((done) => {
      const stopInput = onEngineEvent("ev", (e) => { if (e.input) finish("input"); });
      const timer = setInterval(() => {
        const t = now();
        if (t - from > SWAP_HOLD_MAX_MS) finish("deadline");
        else if (t - bridge.lastHeldAt() > SWAP_QUIET_MS) finish("quiet");
      }, 8);
      function finish(why: string) {
        clearInterval(timer);
        stopInput();
        done(why);
      }
    });
  }

  // Live updates wait while the engine takes the swap's before and after (it says when), so
  // a streaming reply or a notification is not mistaken for part of the change.
  let releaseAt: ReturnType<typeof setTimeout> | undefined;
  const release = () => {
    clearTimeout(releaseAt);
    releaseDeliveries();
  };
  onEngineEvent("swapfx", release);
  const holdForSwap = () => {
    holdDeliveries();
    clearTimeout(releaseAt);
    releaseAt = setTimeout(release, SWAP_HOLD_MAX_MS + 1500);
  };

  async function runSwap(label: string, t0: number, mtime: number): Promise<boolean> {
    try {
      // The transition's pipelines compile on an engine thread while this builds.
      if (SWAP_FX) command({ cmd: "swapfx.warm" });
      const next = await loadApp();
      const t_built = now();
      app = next;
      const { kind, swap } = ui.lastLoad();
      const how = swap && kind !== "fresh" ? `${kind}, ${swap.evaluated} module${swap.evaluated === 1 ? "" : "s"}${swap.reason ? `: ${swap.reason}` : ""}` : kind;
      if (kind === "refresh" && swap?.evaluated === 0) {
        console.error(`[ui] hot swap #${swapN} ${label}: no module changed (bundle+load ${(t_built - t0).toFixed(1)} ms)`);
        return true;
      }
      if (SWAP_FX) {
        holdForSwap();
        command({ cmd: "swapfx.begin" });
      }
      if (kind === "refresh") {
        // The tree stays mounted and only re-renders: nothing to load, so nothing to hold.
        store.set((s) => ({ error: null, swaps: s.swaps + 1 }));
        render(root(), { t0, kind: 1 });
        ui.retireReplaced();
        const t_rendered = now();
        store.set({ lastSwapMs: Math.round(t_rendered - t0) });
        console.error(`[ui] hot swap #${swapN} ${label} (${how}): save→seen ${(t0 - mtime).toFixed(1)} ms, bundle+load ${(t_built - t0).toFixed(1)} ms, render ${(t_rendered - t_built).toFixed(1)} ms`);
        return true;
      }
      if (SWAP_HOLD_MAX_MS > 0) bridge.holdFrames();
      replayLayouts(true);
      store.set((s) => ({ error: null, swaps: s.swaps + 1 }));
      render(root(), { t0, kind: 1 });
      command({ cmd: "view.restore" });
      ui.retireReplaced();
      const t_rendered = now();
      const held = await settled(t_rendered);
      bridge.releaseFrames();
      replayLayouts(false);
      const t_committed = now();
      store.set({ lastSwapMs: Math.round(t_committed - t0) });
      console.error(`[ui] hot swap #${swapN} ${label} (${how}): save→seen ${(t0 - mtime).toFixed(1)} ms, bundle+load ${(t_built - t0).toFixed(1)} ms, render ${(t_rendered - t_built).toFixed(1)} ms, held ${(t_committed - t_rendered).toFixed(1)} ms (${held})`);
      return true;
    } catch (err) {
      // A broken edit never takes the UI down: the old app keeps running, the error shows.
      bridge.releaseFrames();
      replayLayouts(false);
      if (SWAP_FX) {
        command({ cmd: "swapfx.cancel" });
        release();
      }
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
    const { WebContents } = await import("./electron/web-contents");
    const reloadWindow = WebContents.host.onReload;
    WebContents.host.onReload = (contents) => {
      reloadWindow?.(contents);
      if (contents.kind === "app") void applySwap("reload", now());
    };
    const { setUiSwapTarget } = await import("./services/renderer-source");
    setUiSwapTarget({
      async apply(paths) {
        const ok = await swapForUpdate(paths);
        return ok ? { mode: "swap", swaps: swapN } : { mode: "failed", error: store.get().error ?? "swap failed", reloaded: false };
      },
      async quietFor() { return now() - lastInput; },
    });
    const { startChatFeed } = await import("./services/chat-feed");
    startChatFeed(services.api, store).then(
      (feed) => { g.stella.chat = scopeUiFacing(feed, READS); console.error(`[host] chat feed on conversation ${feed.conversationId}`); },
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
    async stats() { return { ...stats, swaps: swapN, liveGenerations: ui.liveGenerations(), rss_mb: process.memoryUsage().rss / 1048576, heap_mb: process.memoryUsage().heapUsed / 1048576 }; },
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
    async quit() {
      if (services) { const { app } = await import("./electron/app"); setTimeout(() => app.quit(), 50); }
      else setTimeout(() => command({ cmd: "quit" }), 50);
      return true;
    },
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
        if (u.pathname === "/control/screenshot") {
          const q = (k: string) => u.searchParams.get(k) ?? undefined;
          return Response.json(await engine.control.screenshot(q("path") ?? "", q("window")).catch((e: Error) => ({ error: e.message })));
        }
        if (u.pathname === "/control/record") {
          const q = (k: string) => u.searchParams.get(k) ?? undefined;
          const n = (k: string) => (q(k) === undefined ? undefined : Number(q(k)));
          return Response.json(await engine.control.record(q("dir") ?? "", { fps: n("fps"), seconds: n("seconds"), window: q("window") }).catch((e: Error) => ({ error: e.message })));
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
}
