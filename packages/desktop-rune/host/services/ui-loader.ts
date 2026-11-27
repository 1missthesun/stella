// Loads the UI for boot and every hot swap without the host growing: the bundler runs in a child
// (ui-build-child.ts) that exists only while builds come in (started on demand, stopped when idle,
// recycled as it grows; another, at low priority, writes the boot file once edits go quiet and is
// stopped when a build starts, so a swap never waits for it). The UI runs as separate modules
// (ui-registry.ts): a swap evaluates only what changed and keeps the rest, and the app's tree
// refreshes in place. A builder that predates modules (an older draft's) sends one bundle, which is
// evaluated as a CommonJS factory no module registry keeps and mounts afresh. Either way what code
// registers is scoped (ui-scope.ts), so replaced code is garbage once React lets go of it, and
// once loads settle the compiled code of replaced UIs is released.

import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import type { Subprocess } from "bun";
import type { ReactNode } from "react";
import type { UiBuildReply, UiBuildRequest } from "./ui-build-child";
import { evaluateInScope, type UiScope } from "./ui-scope";
import { uiCacheKey, validUiCache } from "./ui-cache";
import { holdBuild } from "./source-stamps";
import { bootMark } from "./boot-trace";
import { uiBuildMode } from "./ui-mode";
import { createUiRegistry, type SwapResult, type UiRegistry } from "./ui-registry";
import { DEPS_KEY, HELPERS_KEY, MODULES_LINES, type ModulesBootFile, type ModulesBuild, type ModulesLines } from "./ui-modules-format";

const CHILD = path.join(import.meta.dir, "ui-build-child.ts");
/** Quiet time after a build before the boot bundle is written. */
const CACHE_SETTLE_MS = 1500;

export type UiModule = Record<string, any>;

export type UiLoaderOptions = {
  entry: string;
  tsconfig: string;
  external: string[];
  /** Builds a child serves before it is replaced. */
  recycleAfter?: number;
  /** Child RSS (MB) past which it is replaced after its current build. */
  recycleAboveMb?: number;
  /** Quiet time after a load before JSC's compiled code of replaced UIs is dropped. */
  settleMs?: number;
  /** Quiet time after a build before the bundler process is stopped. */
  idleStopMs?: number;
  /** Boot from the bytecode boot bundle while it matches the sources, and keep it current (ui-cache.ts). */
  bootCache?: boolean;
  /** The bundler process's script: a draft's own, so its `@/` and `ui/replace` resolve in the draft. */
  builder?: string;
  /** Where the bundle's externals (`react`) resolve from: the entry by default. A draft's UI takes the host's React. */
  requireFrom?: string;
  /** The first generation's id; another loader's ids start past this one's (the draft preview's). */
  firstGeneration?: number;
  /** Free identifiers the bundle sees in place of the host's globals (`window`, `stella`), read at each load. */
  globals?: () => Record<string, unknown>;
  /** Run the UI as one bundle, remounted by every swap (`STELLA_RUNE_UI_MODULES=0`). */
  bundle?: boolean;
};

/** How the last load replaced the UI: mounted afresh (`fresh`), refreshed in place, or remounted over kept modules. */
export type UiLoadKind = "fresh" | SwapResult["kind"];

type Child = { proc: Subprocess; ready: Promise<void>; builds: number; pending: Map<number, (reply: UiBuildReply) => void> };

export function createUiLoader(options: UiLoaderOptions) {
  const recycleAfter = options.recycleAfter ?? 25;
  const recycleAboveMb = options.recycleAboveMb ?? 400;
  const bundleMode = options.bundle ?? process.env.STELLA_RUNE_UI_MODULES === "0";
  const hostRequire = createRequire(options.requireFrom ?? options.entry);
  let nextId = 0;
  let child: Child | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const spawnChild = (onGone: (c: Child) => void = (c) => { if (child === c) child = null; }): Child => {
    let resolveReady!: () => void;
    const c: Child = { proc: null!, ready: new Promise((r) => (resolveReady = r)), builds: 0, pending: new Map() };
    c.proc = Bun.spawn([process.execPath, options.builder ?? CHILD], {
      cwd: path.dirname(options.entry),
      env: { ...process.env, NODE_ENV: uiBuildMode() },
      stdio: ["ignore", "ignore", "inherit"],
      ipc(reply: UiBuildReply) {
        if (reply.id === 0) return resolveReady();
        c.pending.get(reply.id)?.(reply);
        c.pending.delete(reply.id);
      },
      onExit(_proc, code) {
        for (const settle of c.pending.values()) settle({ id: -1, ok: false, error: `UI builder exited (${code})`, rssMb: 0 });
        c.pending.clear();
        onGone(c);
      },
    });
    return c;
  };

  const retire = (c: Child) => {
    if (child === c) child = null;
    c.proc.kill();
  };

  const stopWhenIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (child && child.pending.size === 0) retire(child);
    }, options.idleStopMs ?? 20_000);
    idleTimer.unref();
  };

  let cacheTimer: ReturnType<typeof setTimeout> | null = null;
  let cacheChild: Child | null = null;
  const cancelCache = () => {
    if (cacheTimer) { clearTimeout(cacheTimer); cacheTimer = null; }
    const c = cacheChild;
    cacheChild = null;
    c?.proc.kill();
  };
  const scheduleCache = (inputs: string[]) => {
    cancelCache();
    cacheTimer = setTimeout(async () => {
      cacheTimer = null;
      const c = (cacheChild = spawnChild((gone) => { if (cacheChild === gone) cacheChild = null; }));
      try { os.setPriority(c.proc.pid, os.constants.priority.PRIORITY_LOW); } catch {}
      await c.ready;
      if (cacheChild !== c) return;
      const id = ++nextId;
      await new Promise<UiBuildReply>((resolve) => {
        c.pending.set(id, resolve);
        c.proc.send({ id, entry: options.entry, tsconfig: options.tsconfig, external: options.external, writeCache: inputs, modules: bundleMode ? undefined : { have: {}, deps: null } } satisfies UiBuildRequest);
      });
      if (cacheChild === c) cancelCache();
    }, CACHE_SETTLE_MS);
    cacheTimer.unref();
  };

  const build = async (): Promise<{ code: string; modules?: ModulesBuild }> => {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    cancelCache();
    const c = (child ??= spawnChild());
    await c.ready;
    const id = ++nextId;
    const modules = bundleMode ? undefined : (registry?.have() ?? { have: {}, deps: null });
    const reply = await new Promise<UiBuildReply>((resolve) => {
      c.pending.set(id, resolve);
      c.proc.send({ id, entry: options.entry, tsconfig: options.tsconfig, external: options.external, cache: options.bootCache, modules } satisfies UiBuildRequest);
    });
    c.builds++;
    if (c.builds >= recycleAfter || reply.rssMb > recycleAboveMb) retire(c);
    else stopWhenIdle();
    if (!reply.ok) throw new Error(reply.error);
    if (reply.inputs) scheduleCache(reply.inputs);
    return { code: reply.code, modules: reply.modules };
  };

  const evaluate = (code: string, generation: number): UiModule => {
    const filename = options.entry;
    const module = { exports: {} as UiModule };
    const globals = options.globals?.();
    const names = Object.keys(globals ?? {}).filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
    // Shadowed on the bundle's first line, so its line numbers stay its own.
    const source = globals
      ? `(function (__globals) { var ${names.map((n) => `${n} = __globals.${n}`).join(", ")}; return (${code}\n); })\n//# sourceURL=${filename}?swap=${generation}`
      : `${code}\n//# sourceURL=${filename}?swap=${generation}`;
    const evaluated = (0, eval)(source);
    const factory = (globals ? evaluated(globals) : evaluated) as (...args: unknown[]) => void;
    factory.call(module.exports, module.exports, hostRequire, module, filename, path.dirname(filename));
    return module.exports;
  };

  /** The boot bundle's generation-1 code: `?swap=1` is in its sourceURL footer (ui-cache.ts). */
  const loadBootBundle = (file: string): UiModule => {
    try {
      return hostRequire(file) as UiModule;
    } finally {
      // Bun keeps a required module's exports alive after its cache entry goes.
      const cached = hostRequire.cache[file];
      if (cached) cached.exports = {};
      delete hostRequire.cache[file];
    }
  };

  const first = options.firstGeneration ?? 0;
  let generation = first;
  let loads = 0;
  let bootBundle: ReturnType<typeof validUiCache> | null = null;
  let liveScope: UiScope | null = null;
  const replaced: UiScope[] = [];
  const alive = new Set<number>();
  const collected = new FinalizationRegistry<number>((id) => alive.delete(id));
  let registry: UiRegistry | null = null;
  const replacedRegistries: UiRegistry[] = [];
  let lastKind: UiLoadKind = "fresh";
  let lastSwap: SwapResult | null = null;

  const newRegistry = (lazy?: (file: string) => ReturnType<NonNullable<Parameters<typeof createUiRegistry>[0]["lazy"]>>) =>
    createUiRegistry({ hostRequire, globals: options.globals, nextGeneration: () => ++generation, lazy });

  /** The boot file in module form: factories run as they are (bytecode); a lazy file is read on its first module's require. */
  const loadBootModules = async (file: string): Promise<UiRegistry> => {
    const dir = path.dirname(file);
    const lines = (await Bun.file(path.join(dir, MODULES_LINES)).json()) as ModulesLines;
    const boot = loadBootBundle(file) as unknown as ModulesBootFile;
    if (Object.keys(boot.lazy).length > 0) holdBuild(file);
    const opened = new Set<string>();
    const reg: UiRegistry = newRegistry((module) => {
      const name = boot.lazy[module];
      if (!name || opened.has(name)) return null;
      opened.add(name);
      const own = lines[name];
      if (own) reg.mapFile(own.url, own.starts);
      return { code: loadBootBundle(path.join(dir, name)) as unknown as Record<string, any>, names: boot.names };
    });
    const own = lines["boot.js"];
    if (own) reg.mapFile(own.url, own.starts);
    const { [DEPS_KEY]: depsCode, [HELPERS_KEY]: helpersCode, ...code } = boot.factories;
    lastSwap = reg.apply({ entry: boot.entry, graph: boot.graph, code: code as Record<string, any>, names: boot.names, exports: boot.exports, helpers: helpersCode ? { hashes: boot.helpers ?? {}, code: helpersCode as any } : undefined, deps: { ...boot.deps, code: depsCode as any } });
    return reg;
  };

  /** A module build into the live registry, or into a fresh one when the packages changed (the old one retires after the new tree mounts). */
  const applyModules = (modules: ModulesBuild): UiModule => {
    let previous: UiRegistry | null = null;
    if (registry && !registry.accepts(modules)) {
      replacedRegistries.push(registry);
      track(registry.entry());
      previous = registry;
      registry = null;
    }
    const fresh = !registry;
    if (!registry) {
      registry = newRegistry();
      // The build left out the helpers the old registry shares (it asked with its hashes).
      if (previous) registry.adoptHelpers(previous);
    }
    lastSwap = registry.apply(modules);
    lastKind = fresh ? "fresh" : lastSwap.kind === "boot" ? "fresh" : lastSwap.kind;
    return registry.entry();
  };

  const track = (value: UiModule) => {
    const id = ++generation;
    alive.add(id);
    let root: unknown;
    try { root = value.Root ?? value.App ?? value; } catch { root = value; }
    collected.register(root as object, id);
  };

  /** Moves the bundle-mode generation aside: the next load replaces it. */
  const replaceBundle = () => {
    if (liveScope) replaced.push(liveScope);
    liveScope = null;
  };
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  const settle = () => {
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      Bun.gc(true);
      Bun.shrink();
    }, options.settleMs ?? 2000);
    settleTimer.unref();
  };
  process.once("exit", () => { child?.proc.kill(); cacheChild?.proc.kill(); });

  return {
    /** Checks the boot bundle, and spawns the bundler ahead of the first load when it can't be used. */
    warm() {
      if (loads > 0 || bootBundle) return;
      bootBundle = options.bootCache ? validUiCache().catch(() => null) : Promise.resolve(null);
      void bootBundle.then((found) => { if (!found && loads <= 1 && !registry && !liveScope) child ??= spawnChild(); });
    },
    async load(): Promise<UiModule> {
      if (loads === 0 && !bootBundle) this.warm();
      const booting = loads++ === 0;
      const found = booting ? await bootBundle : null;
      const boot = found && found.key === uiCacheKey({ ...options, modules: !bundleMode }) ? found.file : null;
      if (boot && !bundleMode) {
        try {
          registry = await loadBootModules(boot);
          lastKind = "fresh";
          bootMark("ui-boot-bundle");
          settle();
          return registry.entry();
        } catch (error) {
          registry?.retireAll();
          registry = null;
          console.error("[ui] boot file failed, building the UI:", error);
        }
      }
      let loaded: { value: UiModule; scope: UiScope } | null = null;
      let id = 0;
      if (boot && bundleMode) {
        id = ++generation;
        try {
          loaded = evaluateInScope(id, () => loadBootBundle(boot));
          bootMark("ui-boot-bundle");
        } catch (error) {
          console.error("[ui] boot bundle failed, building the UI:", error);
        }
      }
      if (!loaded) {
        const { code, modules } = await build();
        bootMark("ui-built");
        if (modules) {
          const value = applyModules(modules);
          replaceBundle();
          settle();
          return value;
        }
        if (registry) {
          replacedRegistries.push(registry);
          track(registry.entry());
          registry = null;
        }
        id = ++generation;
        loaded = evaluateInScope(id, () => evaluate(code, id));
      }
      const { value, scope } = loaded;
      alive.add(id);
      collected.register(value.Root ?? value.App ?? value, id);
      replaceBundle();
      liveScope = scope;
      lastKind = "fresh";
      lastSwap = null;
      settle();
      return value;
    },
    /** How the last load replaced the UI, and what it evaluated. */
    lastLoad(): { kind: UiLoadKind; swap: SwapResult | null } {
      return { kind: lastKind, swap: lastSwap };
    },
    /** The app's tree as the loader's modules need it rendered (their refresh context); render every load's tree through it. */
    wrap(node: ReactNode): ReactNode {
      return registry ? registry.wrap(node) : node;
    },
    /** Undoes what replaced code registered; call once the new tree has replaced theirs (their unmount and effect cleanups ran). */
    retireReplaced() {
      for (const scope of replaced.splice(0)) scope.dispose();
      registry?.retireReplaced();
      for (const old of replacedRegistries.splice(0)) old.retireAll();
    },
    /** Undoes what everything registered, the live UI too: the UI is gone. */
    retireAll() {
      this.retireReplaced();
      liveScope?.dispose();
      liveScope = null;
      registry?.retireAll();
      registry = null;
    },
    /** The live UI and replaced code not yet garbage collected: one entry after a settled swap, more means a leak. */
    liveGenerations(): number[] {
      const live = registry ? [first + loads] : [];
      return [...live, ...alive, ...(registry?.leaked() ?? [])];
    },
    dispose() {
      if (idleTimer) clearTimeout(idleTimer);
      cancelCache();
      if (child) retire(child);
    },
  };
}
