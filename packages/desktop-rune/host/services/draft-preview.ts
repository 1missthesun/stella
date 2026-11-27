// Rune's `openDraftPreview` (master: services/app-source/draft-preview.ts) and the
// `stella-preview://<draft>` pages of the in-app browser. Electron serves the draft's desktop-ui
// to a WebContentsView; on Rune the interface is `ui/`, drawn by the engine, so the draft's `ui/`
// is built and rendered here, in a root of its own (reconciler.ts createScopedRoot) whose window
// is off screen and isolated (its element ids are its own). The draft's code gets its own
// globals: a `window` and `document` whose events stay its own, in-memory storage seeded from the
// app's (the isolated partition Electron gives a preview), an electronAPI of its own renderer (a
// WebContents that stands in for the app's, so its IPC is trusted as the app's), and a `stella`
// whose engine commands name its window and whose host shows only that window.
//
// Every page of the on-demand Chromium serves `stella-preview:` (web-contents.ts serveInBrowser),
// so the preview is a web address like any other: `browser.tabs.new(url)` opens it, `goto(url)`
// navigates an open tab to it, and the tab reports it as its URL. The page shows the window's
// frames under an accessible layer of its elements and hands its pointer and keys to the window:
// the agent's screenshots, snapshots, clicks and typing work as on Electron. One preview per
// draft serves every page showing it; it closes once no page has shown it for a while and no
// preview tab holds it, or when the draft is gone. Reloading a page rebuilds the draft, edits
// rebuild it as they land, and a build or render error is shown in the page with the last good
// frame.

import { existsSync, rmSync, watch, type FSWatcher } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createElement, type ComponentType } from "react";
import { command, engine, engineApi, now, onEngineEvent, request, type ElementInfo } from "../bridge";
import { createScopedRoot, pressedByKeys, type ScopedRoot } from "../reconciler";
import { createStore, makeUseStore, type AppState, type Store } from "../store";
import { MemoryStorage } from "../dom/storage";
import { WebContentsView, type WindowSnapshot } from "../electron/browser-window";
import { serveInBrowser, WebContents } from "../electron/web-contents";
import { createUiLoader } from "./ui-loader";
import { scopeUiFacing } from "./ui-scope";
import { rendererApiFor } from "./renderer-api";
import type { UiHost } from "./ui-host";
import { previewPage } from "./draft-preview-page";
import { DRAFT_REF_PREFIX, isDraftName, listWorktrees } from "../../../desktop/electron/services/app-source/git";
import { prepareDraftDependencies } from "../../../desktop/electron/services/app-source/draft-deps";
import { getSourceUrl } from "../../../desktop/electron/windows/window-load";
import { mainContext } from "./main-context";

export type DraftPreview = {
  view: WebContentsView;
  url: string;
  dispose: () => void;
};

const RUNE_DIR = path.join(import.meta.dir, "../..");
/** Where the draft bundle's `react` comes from: the host's, so its elements reach this reconciler. */
const HOST_ENTRY = path.join(RUNE_DIR, "ui/App.tsx");
/** A preview's generations start past every earlier preview's and the app's (ui-scope.ts keys them by id). */
const GENERATIONS_PER_PREVIEW = 1_000_000;
const OFF_SCREEN: [number, number] = [-20_000, 0];
const DEFAULT_SIZE = { width: 1280, height: 720 };
/** Frame captures while the preview is in use, and while it sits still. */
const ACTIVE_FRAME_MS = 150;
const IDLE_FRAME_MS = 1000;
const ACTIVE_FOR_MS = 3000;
/** The tab stopped asking for frames (closed, or its page gone): captures stop. */
const POLL_GONE_MS = 4000;
/** How long a capture waits for a build in progress (dependencies, bundle, render) and the page. */
const FIRST_FRAME_MS = 20_000;
/** A capture this soon after a build first waits (up to SETTLE_MAX_MS) for its entrances to end. */
const SETTLE_AFTER_MS = 3000;
const SETTLE_MAX_MS = 2000;
const READS = ["get", "useStore", "now", "snapshot", "pressedByKeys"];
const API_PATH = "/__preview/";
const SCHEME = "stella-preview";
/** The page's API answers only its own page: a header no other page can send without asking first (CORS). */
const API_HEADER = "x-stella-preview";
/** A preview no tab holds closes once no page has asked for frames this long (a page asks at least every 10 s). */
const IDLE_CLOSE_MS = 30_000;
const IDLE_CHECK_MS = 5_000;
/** How long a page of a draft that doesn't exist waits before asking again. */
const MISSING_POLL_MS = 10_000;

let opened = 0;

type Frame = { seq: number; png: Uint8Array<ArrayBuffer> | null; hash: bigint | number; width: number; height: number; elements: PageElement[] };
export type PageElement = { key: string; role: string; label: string | null; text: string | null; rect: [number, number, number, number]; focused: boolean; focusable: boolean };

const errorText = (error: unknown) => (error instanceof Error ? error.stack ?? error.message : String(error)).slice(0, 4000);

/** The elements worth a node in the page's accessible layer: named, readable or focusable, on screen. */
const pageElements = (list: ElementInfo[]): PageElement[] =>
  list
    .filter((e) => !e.inert && e.opacity > 0.01 && e.rect[2] >= 1 && e.rect[3] >= 1 && (e.label || e.text || e.focusable || (e.role && e.role !== "text" && e.role !== "group")))
    .map((e) => ({ key: e.key ?? e.path, role: e.role, label: e.label, text: e.text, rect: e.rect, focused: e.focused, focusable: e.focusable }));

class Preview {
  readonly engineId: string;
  /** The draft's renderer: its IPC identity, never shown. */
  private readonly renderer: WebContents;
  private readonly loader: ReturnType<typeof createUiLoader>;
  private readonly root: ScopedRoot;
  private readonly snapshot: WindowSnapshot;
  private readonly globals: Record<string, unknown>;
  private readonly watchers: FSWatcher[] = [];
  private readonly shotPath: string;
  private readonly store: Store = createStore({} as AppState);
  private seeded = false;
  private error: string | null = null;
  private rendered = false;
  private disposed = false;
  private building: Promise<void> | null = null;
  private buildAgain = false;
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private size = { ...DEFAULT_SIZE };
  private resizeTimer: ReturnType<typeof setTimeout> | null = null;
  private frame: Frame = { seq: 0, png: null, hash: 0, width: DEFAULT_SIZE.width, height: DEFAULT_SIZE.height, elements: [] };
  private frameWaiters: Array<() => void> = [];
  private ackWaiters: Array<{ seq: number; resolve: () => void }> = [];
  private capturing: Promise<void> | null = null;
  private loopTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPoll = 0;
  private lastActive = 0;
  private pageLoads = 0;
  private renderedAt = 0;
  /** Preview tabs holding it open; with none, it closes once no page asks for frames. */
  private holds = 0;
  private readonly createdAt = Date.now();
  private readonly idleTimer: ReturnType<typeof setInterval>;

  constructor(readonly name: string, readonly worktree: string, private readonly onClosed: () => void) {
    const n = ++opened;
    this.engineId = `preview:${name}`;
    const url = getSourceUrl("full");
    this.renderer = new WebContents({ partition: `stella-preview-${name}` });
    this.renderer.actsAsAppRenderer(url);
    // The draft reloading itself (Reload in its menus, ui.reload) rebuilds it.
    this.renderer.on("did-start-loading", () => void this.build());
    this.shotPath = path.join(os.tmpdir(), `stella-preview-${process.pid}-${n}.png`);
    this.root = createScopedRoot(this.engineId, { kind: "background", isolated: true, position: OFF_SCREEN }, this.engineId, (error) => this.fail(error));
    this.snapshot = {
      id: this.engineId,
      engineId: this.engineId,
      contentsId: this.renderer.id,
      kind: "app",
      mode: "full",
      url,
      title: `Preview: ${name}`,
      visible: true,
      focusable: false,
      alwaysOnTop: false,
      opacity: 1,
      ignoreMouseEvents: false,
      forwardMouseEvents: false,
      bounds: { x: OFF_SCREEN[0], y: OFF_SCREEN[1], ...this.size },
      resizable: false,
      frameless: true,
      transparent: false,
      skipTaskbar: true,
      windowKind: "background" as WindowSnapshot["windowKind"],
      fullscreen: false,
      reloadToken: 0,
      zoom: 1,
      parentId: null,
      openerId: null,
      frameName: null,
      modal: false,
      views: [],
      browser: false,
      drawsNothing: false,
    };
    this.globals = this.createGlobals();
    const ui = path.join(worktree, "packages/desktop-rune");
    this.loader = createUiLoader({
      entry: path.join(ui, "ui/App.tsx"),
      tsconfig: path.join(ui, "tsconfig.build.json"),
      external: ["react", "react/jsx-runtime", "react/jsx-dev-runtime"],
      builder: path.join(ui, "host/services/ui-build-child.ts"),
      requireFrom: HOST_ENTRY,
      firstGeneration: n * GENERATIONS_PER_PREVIEW,
      globals: () => this.globals,
    });
    this.loader.warm();
    this.idleTimer = setInterval(() => this.closeIfIdle(), IDLE_CHECK_MS);
    this.idleTimer.unref?.();
    for (const dir of [path.join(ui, "ui"), path.join(worktree, "packages/desktop-ui/src")]) {
      if (!existsSync(dir)) continue;
      try {
        this.watchers.push(watch(dir, { recursive: true }, (_event, file) => {
          if (file && /\.(tsx?|json|css)$/.test(String(file))) this.scheduleRebuild();
        }));
      } catch (error) {
        console.error(`[preview] not watching ${dir}:`, error);
      }
    }
  }

  // ------------------------------------------------------------------ the draft's globals

  private createGlobals(): Record<string, unknown> {
    const g = globalThis as any;
    const app = g.stella as Record<string, any>;
    const engineId = this.engineId;
    // The window's and the document's own events: the app's never reach the draft, and the draft's
    // (a "send message" event) never reach the app.
    const windowEvents = new EventTarget();
    const documentEvents = new EventTarget();
    const events = (target: EventTarget) => ({
      addEventListener: target.addEventListener.bind(target),
      removeEventListener: target.removeEventListener.bind(target),
      dispatchEvent: target.dispatchEvent.bind(target),
    });
    const localStorage = new MemoryStorage();
    try {
      const seed = g.localStorage as Storage;
      for (let i = 0; i < seed.length; i++) {
        const key = seed.key(i);
        if (key !== null) localStorage.setItem(key, seed.getItem(key) ?? "");
      }
    } catch {}
    const electronAPI = rendererApiFor(this.renderer);
    // The draft's writes stay in `own`; methods read from the real object stay bound to it.
    const shadow = (target: object, own: Record<PropertyKey, unknown>) => {
      const bound = new WeakMap<Function, Function>();
      const bind = (fn: Function) => {
        const known = bound.get(fn);
        if (known) return known;
        const made = fn.bind(target);
        bound.set(fn, made);
        return made;
      };
      return new Proxy(target, {
        get(t, key) {
          if (key in own) return own[key];
          const value = Reflect.get(t, key);
          return typeof value === "function" && !/^[A-Z]/.test(String(key)) ? bind(value) : value;
        },
        set(_t, key, value) { own[key] = value; return true; },
        has(t, key) { return key in own || key in t; },
        deleteProperty(_t, key) { delete own[key]; return true; },
      });
    };
    const scopedRequest = <T = void>(cmd: string, args: Record<string, unknown> = {}) =>
      request<T>(cmd, args.window == null ? { ...args, window: engineId } : args);
    const scopedCommand = (v: Record<string, unknown>) => command(v.window == null ? { ...v, window: engineId } : v);
    const appHost = app.host as UiHost | undefined;
    // Snapshots are read on every render: the same array each time.
    const shown = [this.snapshot];
    const noDialogs: never[] = [];
    const windows = { subscribe: (_listener: () => void) => () => {}, snapshot: () => shown };
    const host = appHost && scopeUiFacing({
      imagePreview: appHost.imagePreview,
      windows,
      apiFor: (id: string) => (id === engineId ? electronAPI : null),
      onFocusChange: (_id: string, _listener: (focused: boolean) => void) => () => {},
      isFocused: (_id: string) => false,
      open: (_opener: string, _url: string) => null,
      mounted: (_id: string) => {},
      unmounted: (_id: string) => {},
      dialogs: { subscribe: (_listener: () => void) => () => {}, pending: () => noDialogs, answer: () => {} },
      web: appHost.web,
      browser: appHost.browser,
    } as Partial<UiHost>, READS);
    const stella = {
      store: this.store,
      useStore: makeUseStore(this.store),
      command: scopedCommand,
      now,
      engine: engineApi(scopedRequest, scopedCommand),
      on: onEngineEvent,
      windowPortal: this.root.windowPortal,
      pressedByKeys,
      host,
      get chat() { return app.chat; },
    };
    scopeUiFacing(stella, READS);
    const sessionStorage = new MemoryStorage();
    const windowOwn: Record<PropertyKey, unknown> = { ...events(windowEvents), localStorage, sessionStorage, electronAPI, stella };
    const documentOwn: Record<PropertyKey, unknown> = { ...events(documentEvents) };
    const window = shadow(g, windowOwn);
    const document = shadow(g.document, documentOwn);
    for (const key of ["window", "self", "globalThis", "top", "parent", "frames"]) windowOwn[key] = window;
    windowOwn.document = document;
    documentOwn.defaultView = window;
    return { window, self: window, globalThis: window, document, localStorage, sessionStorage, electronAPI, stella, ...events(windowEvents) };
  }

  // ------------------------------------------------------------------ building

  /** Builds the draft's `ui/` and renders it; a build asked for while one runs follows it. */
  build(): Promise<void> {
    if (this.building) {
      this.buildAgain = true;
      return this.building;
    }
    const run = (async () => {
      do {
        this.buildAgain = false;
        await this.buildOnce();
      } while (this.buildAgain && !this.disposed);
    })().finally(() => { this.building = null; });
    this.building = run;
    return run;
  }

  private scheduleRebuild() {
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    this.rebuildTimer = setTimeout(() => { this.rebuildTimer = null; void this.build(); }, 60);
  }

  /** Finished or removed: its pages say so, and it closes. */
  private closeIfGone() {
    if (existsSync(this.worktree)) return false;
    this.error = `The draft "${this.name}" is no longer in progress (it was finished or removed).`;
    console.error(`[preview] ${this.name}: the draft is gone`);
    this.close();
    return true;
  }

  private async buildOnce() {
    if (this.disposed || this.closeIfGone()) return;
    const t0 = now();
    try {
      const mod = await this.loader.load();
      if (this.disposed) return;
      const tree = mod.Root ? createElement(mod.Root as ComponentType) : mod.App ? createElement("window", { id: this.engineId }, createElement(mod.App as ComponentType)) : null;
      if (!tree) throw new Error("The draft's ui/App.tsx exports neither Root nor App.");
      if (!this.seeded) {
        this.seeded = true;
        this.store.set(mod.initialState?.() ?? {});
      }
      this.error = null;
      this.root.render(this.loader.wrap(tree));
      this.rendered = true;
      this.renderedAt = Date.now();
      this.loader.retireReplaced();
      const { kind, swap } = this.loader.lastLoad();
      console.error(`[preview] ${this.name}: built and rendered in ${(now() - t0).toFixed(0)} ms (${kind}${swap && kind !== "fresh" ? `, ${swap.evaluated} modules` : ""})`);
    } catch (error) {
      // The draft went away mid-build (finished while an edit's rebuild ran).
      if (this.closeIfGone()) return;
      this.fail(error);
    }
    this.active();
    void this.capture(true);
  }

  private fail(error: unknown) {
    this.error = errorText(error);
    console.error(`[preview] ${this.name}:`, error);
    this.frame = { ...this.frame, seq: this.frame.seq + 1 };
    this.wake();
  }

  // ------------------------------------------------------------------ frames

  private active() {
    this.lastActive = Date.now();
    this.loop();
  }

  private loop() {
    if (this.loopTimer || this.disposed) return;
    const tick = async () => {
      this.loopTimer = null;
      if (this.disposed || Date.now() - this.lastPoll > POLL_GONE_MS) return;
      await this.capture(false);
      const busy = Date.now() - this.lastActive < ACTIVE_FOR_MS;
      this.loopTimer ??= setTimeout(() => void tick(), busy ? ACTIVE_FRAME_MS : IDLE_FRAME_MS);
    };
    this.loopTimer = setTimeout(() => void tick(), 0);
  }

  /** Captures the window's next frame; a frame like the last one is dropped unless `force`. */
  private capture(force: boolean): Promise<void> {
    if (!this.rendered || this.disposed) return Promise.resolve();
    if (this.capturing) return force ? this.capturing.then(() => this.capture(true)) : this.capturing;
    const run = (async () => {
      const shot = await engine.control.screenshot(this.shotPath, this.engineId).catch(() => null);
      if (!shot || this.disposed) return;
      const png = new Uint8Array(await Bun.file(shot.path).arrayBuffer());
      const hash = Bun.hash(png);
      if (!force && hash === this.frame.hash) return;
      const elements = pageElements(await engine.control.elements(this.engineId).catch(() => [] as ElementInfo[]));
      const scale = shot.scale || 1;
      this.frame = { seq: this.frame.seq + 1, png, hash, width: Math.round(shot.width / scale), height: Math.round(shot.height / scale), elements };
      if (!force) this.lastActive = Date.now();
      this.wake();
    })().catch((error) => console.error(`[preview] ${this.name}: capture failed:`, error)).finally(() => { this.capturing = null; });
    this.capturing = run;
    return run;
  }

  private wake() {
    for (const resolve of this.frameWaiters.splice(0)) resolve();
  }

  /** Brings the tab's frame up to date before the page is captured (an agent's screenshot). */
  async fresh() {
    // A screenshot right after opening, reloading or an edit shows the build that started, once
    // the page shows frames.
    const until = Date.now() + FIRST_FRAME_MS;
    while (!this.disposed && Date.now() < until && (this.building || this.rebuildTimer || (!this.rendered && !this.error) || !this.lastPoll)) await Bun.sleep(25);
    if (this.disposed || !this.rendered) return;
    if (Date.now() - this.renderedAt < SETTLE_AFTER_MS) await this.settled();
    await this.capture(true);
    if (Date.now() - this.lastPoll > POLL_GONE_MS) return;
    const seq = this.frame.seq;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(done, 2000);
      function done() { clearTimeout(timer); resolve(); }
      this.ackWaiters.push({ seq, resolve: done });
    });
  }

  /** Waits for a new build's entrances to finish: its elements' places and opacities hold still. */
  private async settled() {
    const until = Date.now() + SETTLE_MAX_MS;
    let last = "";
    while (!this.disposed && Date.now() < until) {
      const list = await engine.control.elements(this.engineId).catch(() => [] as ElementInfo[]);
      const now = JSON.stringify(list.map((e) => [e.key, e.rect, e.opacity]));
      if (now === last) return;
      last = now;
      await Bun.sleep(120);
    }
  }

  private acked(seen: number) {
    this.ackWaiters = this.ackWaiters.filter((w) => (w.seq <= seen ? (w.resolve(), false) : true));
  }

  private resize(width: number, height: number) {
    if (!(width >= 1 && height >= 1) || (width === this.size.width && height === this.size.height)) return;
    this.size = { width: Math.round(width), height: Math.round(height) };
    this.snapshot.bounds = { x: OFF_SCREEN[0], y: OFF_SCREEN[1], ...this.size };
    if (this.resizeTimer) clearTimeout(this.resizeTimer);
    this.resizeTimer = setTimeout(() => {
      this.resizeTimer = null;
      void engine.window.setBounds(this.engineId, this.snapshot.bounds).catch(() => {}).then(() => this.active());
    }, 80);
  }

  // ------------------------------------------------------------------ the tab's page

  async serve(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith(API_PATH)) {
      if (req.method !== "GET" || (url.pathname !== "/" && !url.pathname.endsWith(".html"))) return new Response(null, { status: 404 });
      // The page itself: its first load builds the draft, a reload builds it again. A capture
      // waits for the new page's first poll, not an earlier page's.
      if (this.pageLoads++ > 0 || !this.rendered) void this.build();
      this.lastPoll = 0;
      return new Response(previewPage(this.name), { headers: PAGE_HEADERS });
    }
    if (req.headers.get(API_HEADER) !== "1") return new Response(null, { status: 403 });
    const route = url.pathname.slice(API_PATH.length);
    if (route === "next") {
      // A page that outlived an earlier preview of this draft starts this one.
      if (!this.rendered && !this.building && !this.error) void this.build();
      const seen = Number(url.searchParams.get("seen") ?? 0);
      this.lastPoll = Date.now();
      this.acked(seen);
      this.resize(Number(url.searchParams.get("w")), Number(url.searchParams.get("h")));
      this.loop();
      if (this.frame.seq <= seen) {
        await new Promise<void>((resolve) => {
          const timer = setTimeout(done, 10_000);
          const self = this;
          function done() { clearTimeout(timer); self.frameWaiters = self.frameWaiters.filter((w) => w !== done); resolve(); }
          this.frameWaiters.push(done);
        });
      }
      const f = this.frame;
      return Response.json({ seq: f.seq, png: f.png ? f.seq : 0, width: f.width, height: f.height, elements: f.elements, error: this.error, building: this.building !== null }, { headers: { "cache-control": "no-store" } });
    }
    if (route.startsWith("frame/")) {
      const png = this.frame.png;
      return png ? new Response(png, { headers: { "content-type": "image/png", "cache-control": "no-store" } }) : new Response(null, { status: 404 });
    }
    if (route === "input" && req.method === "POST") {
      const events = (await req.json().catch(() => [])) as Record<string, unknown>[];
      if (Array.isArray(events) && events.length > 0 && this.rendered) {
        await engine.control.input(events.map((e) => ({ t: 0, ...e })), this.engineId).catch((error) => console.error(`[preview] ${this.name}: input failed:`, error));
        this.active();
      }
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 404 });
  }

  hold() {
    this.holds++;
  }

  release() {
    this.holds = Math.max(0, this.holds - 1);
    this.closeIfIdle();
  }

  private closeIfIdle() {
    if (this.disposed || this.holds > 0) return;
    const since = Math.max(this.lastPoll, this.createdAt);
    if (Date.now() - since >= IDLE_CLOSE_MS) this.close();
  }

  /** Closes it and takes it out of the registry; a page asking again opens a new one. */
  close() {
    if (this.disposed) return;
    this.dispose();
    this.onClosed();
  }

  private dispose() {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.idleTimer);
    for (const w of this.watchers.splice(0)) w.close();
    for (const t of [this.rebuildTimer, this.resizeTimer, this.loopTimer]) if (t) clearTimeout(t);
    this.wake();
    this.acked(Number.MAX_SAFE_INTEGER);
    try { this.root.unmount(); } catch (error) { console.error(`[preview] ${this.name}: unmount failed:`, error); }
    this.loader.retireAll();
    this.loader.dispose();
    this.renderer.destroy();
    rmSync(this.shotPath, { force: true });
    console.error(`[preview] ${this.name}: closed`);
  }
}

const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  // Shown only as a page of its own: no other page can frame it and drive it.
  "content-security-policy": "frame-ancestors 'none'",
  "x-frame-options": "DENY",
};

// ------------------------------------------------------------------ one preview per draft

const previews = new Map<string, Promise<Preview>>();

const stellaAppDir = (): string | null => {
  const context = mainContext();
  return (context?.state.stellaAppDir as string | undefined) ?? (context?.config.stellaAppDir as string | undefined) ?? null;
};

/** The draft's preview, opened (its dependencies ready) on first use. */
const previewFor = (name: string, appDir: string): Promise<Preview> => {
  let opening = previews.get(name);
  if (opening) return opening;
  opening = (async () => {
    if (!isDraftName(name)) throw new Error(`"${name}" is not a valid draft name.`);
    const branch = `${DRAFT_REF_PREFIX}${name}`;
    const worktree = (await listWorktrees(appDir)).find((tree) => tree.branch === branch);
    if (!worktree) throw new Error(`No draft named "${name}" is in progress (no worktree on draft/${name}).`);
    const deps = await prepareDraftDependencies({ draftRoot: worktree.path, appRoot: appDir });
    console.error(`[preview] ${name}: dependencies ${deps.mode} in ${deps.ms} ms`);
    const preview: Preview = new Preview(name, worktree.path, () => { if (previews.get(name) === opening) previews.delete(name); });
    return preview;
  })();
  previews.set(name, opening);
  opening.catch(() => { if (previews.get(name) === opening) previews.delete(name); });
  return opening;
};

/** The preview a `stella-preview:` URL shows, already open. */
const openPreviewAt = async (url: string): Promise<Preview | null> => {
  let name: string;
  try { name = new URL(url).hostname; } catch { return null; }
  return (await previews.get(name)?.catch(() => null)) ?? null;
};

/** What a page asking for a draft that can't be previewed shows: the reason, and asks again now and then. */
const unavailable = async (req: Request, name: string, error: unknown): Promise<Response> => {
  const url = new URL(req.url);
  const message = errorText(error).split("\n")[0]!;
  if (!url.pathname.startsWith(API_PATH)) return new Response(previewPage(name), { headers: PAGE_HEADERS });
  if (req.headers.get(API_HEADER) !== "1") return new Response(null, { status: 403 });
  if (url.pathname.slice(API_PATH.length) !== "next") return new Response(null, { status: 404 });
  const seen = Number(url.searchParams.get("seen") ?? 0);
  if (seen > 0) await Bun.sleep(MISSING_POLL_MS);
  return Response.json({ seq: seen + 1, png: 0, width: DEFAULT_SIZE.width, height: DEFAULT_SIZE.height, elements: [], error: message, building: false }, { headers: { "cache-control": "no-store" } });
};

serveInBrowser(SCHEME, {
  async fetch(req) {
    let name = "";
    try { name = new URL(req.url).hostname; } catch {}
    const appDir = stellaAppDir();
    if (!appDir) return await unavailable(req, name, new Error("Stella previews are available only when Stella runs from source."));
    try {
      return await (await previewFor(name, appDir)).serve(req);
    } catch (error) {
      return await unavailable(req, name, error);
    }
  },
  async beforeCapture(contents) {
    await (await openPreviewAt(contents.getURL()))?.fresh();
  },
});

/** The address of a draft's preview. */
const previewUrl = (name: string) => `${SCHEME}://${name}/`;

export const openDraftPreview = async (options: {
  name: string;
  stellaAppDir: string;
  preloadPath: string;
  offscreen?: { deviceScaleFactor: number };
}): Promise<DraftPreview> => {
  const preview = await previewFor(options.name, options.stellaAppDir);
  preview.hold();
  // The tab is an ordinary browser page at the preview's address, in a partition of its own.
  const view = new WebContentsView({ webPreferences: { partition: `stella-preview-${options.name}`, offscreen: options.offscreen } });
  let released = false;
  return {
    view,
    url: previewUrl(options.name),
    dispose: () => {
      if (released) return;
      released = true;
      preview.release();
    },
  };
};
