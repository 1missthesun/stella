// Loads the UI bundle for boot and every hot swap without the host growing: the bundler runs in a
// child (ui-build-child.ts) that exists only while builds come in (started on demand, stopped when
// idle, recycled as it grows; another, at low priority, writes the boot bundle once edits go quiet
// and is stopped when a build starts, so a swap never waits for it), each build is evaluated as a
// CommonJS factory that no module registry keeps (its global registrations scoped, ui-scope.ts),
// so a replaced UI is garbage once React lets go of it, and once loads settle the compiled code of
// replaced UIs is released.

import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import type { Subprocess } from "bun";
import type { UiBuildReply, UiBuildRequest } from "./ui-build-child";
import { evaluateInScope, type UiScope } from "./ui-scope";
import { uiCacheKey, validUiCache } from "./ui-cache";
import { bootMark } from "./boot-trace";
import { uiBuildMode } from "./ui-mode";

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
};

type Child = { proc: Subprocess; ready: Promise<void>; builds: number; pending: Map<number, (reply: UiBuildReply) => void> };

export function createUiLoader(options: UiLoaderOptions) {
  const recycleAfter = options.recycleAfter ?? 25;
  const recycleAboveMb = options.recycleAboveMb ?? 400;
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
        c.proc.send({ id, entry: options.entry, tsconfig: options.tsconfig, external: options.external, writeCache: inputs } satisfies UiBuildRequest);
      });
      if (cacheChild === c) cancelCache();
    }, CACHE_SETTLE_MS);
    cacheTimer.unref();
  };

  const build = async (): Promise<string> => {
    if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
    cancelCache();
    const c = (child ??= spawnChild());
    await c.ready;
    const id = ++nextId;
    const reply = await new Promise<UiBuildReply>((resolve) => {
      c.pending.set(id, resolve);
      c.proc.send({ id, entry: options.entry, tsconfig: options.tsconfig, external: options.external, cache: options.bootCache } satisfies UiBuildRequest);
    });
    c.builds++;
    if (c.builds >= recycleAfter || reply.rssMb > recycleAboveMb) retire(c);
    else stopWhenIdle();
    if (!reply.ok) throw new Error(reply.error);
    if (reply.inputs) scheduleCache(reply.inputs);
    return reply.code;
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
  let bootBundle: ReturnType<typeof validUiCache> | null = null;
  let liveScope: UiScope | null = null;
  const replaced: UiScope[] = [];
  const alive = new Set<number>();
  const collected = new FinalizationRegistry<number>((id) => alive.delete(id));
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
      if (generation > first || bootBundle) return;
      bootBundle = options.bootCache ? validUiCache().catch(() => null) : Promise.resolve(null);
      void bootBundle.then((found) => { if (!found && generation === first) child ??= spawnChild(); });
    },
    async load(): Promise<UiModule> {
      if (generation === first && !bootBundle) this.warm();
      const found = generation === first ? await bootBundle : null;
      const boot = found && found.key === uiCacheKey(options) ? found.file : null;
      let loaded: { value: UiModule; scope: UiScope } | null = null;
      let id = 0;
      if (boot) {
        id = ++generation;
        try {
          loaded = evaluateInScope(id, () => loadBootBundle(boot));
          bootMark("ui-boot-bundle");
        } catch (error) {
          console.error("[ui] boot bundle failed, building the UI:", error);
        }
      }
      if (!loaded) {
        const code = await build();
        bootMark("ui-built");
        id = ++generation;
        loaded = evaluateInScope(id, () => evaluate(code, id));
      }
      const { value, scope } = loaded;
      alive.add(id);
      collected.register(value.Root ?? value.App ?? value, id);
      if (liveScope) replaced.push(liveScope);
      liveScope = scope;
      settle();
      return value;
    },
    /** Undoes what replaced generations registered; call once the new generation's tree has replaced theirs (their unmount cleanups ran). */
    retireReplaced() {
      for (const scope of replaced.splice(0)) scope.dispose();
    },
    /** Undoes what every generation registered, the live one too: the UI is gone. */
    retireAll() {
      for (const scope of replaced.splice(0)) scope.dispose();
      liveScope?.dispose();
      liveScope = null;
    },
    /** Generations not yet garbage collected: one after a settled swap, more means a leak. */
    liveGenerations(): number[] {
      return [...alive];
    },
    dispose() {
      if (idleTimer) clearTimeout(idleTimer);
      cancelCache();
      if (child) retire(child);
    },
  };
}
