// Loads the UI bundle for boot and every hot swap without the host growing: the bundler runs in a
// recycled child (ui-build-child.ts), each build is evaluated as a CommonJS factory that no module
// registry keeps (its global registrations scoped, ui-scope.ts), so a replaced UI is garbage once
// React lets go of it, and once swaps settle the compiled code of replaced UIs is released.

import { createRequire } from "node:module";
import path from "node:path";
import type { Subprocess } from "bun";
import type { UiBuildReply, UiBuildRequest } from "./ui-build-child";
import { evaluateInScope, type UiScope } from "./ui-scope";

const CHILD = path.join(import.meta.dir, "ui-build-child.ts");

export type UiModule = Record<string, any>;

export type UiLoaderOptions = {
  entry: string;
  tsconfig: string;
  external: string[];
  /** Builds a child serves before it is replaced. */
  recycleAfter?: number;
  /** Child RSS (MB) past which it is replaced after its current build. */
  recycleAboveMb?: number;
  /** Quiet time after a swap before JSC's compiled code of replaced UIs is dropped. */
  settleMs?: number;
};

type Child = { proc: Subprocess; ready: Promise<void>; builds: number; pending: Map<number, (reply: UiBuildReply) => void> };

export function createUiLoader(options: UiLoaderOptions) {
  const recycleAfter = options.recycleAfter ?? 25;
  const recycleAboveMb = options.recycleAboveMb ?? 400;
  const hostRequire = createRequire(options.entry);
  let nextId = 0;
  let child: Child | null = null;
  let disposed = false;

  const spawnChild = (): Child => {
    let resolveReady!: () => void;
    const c: Child = { proc: null!, ready: new Promise((r) => (resolveReady = r)), builds: 0, pending: new Map() };
    c.proc = Bun.spawn([process.execPath, CHILD], {
      cwd: path.dirname(options.entry),
      env: process.env,
      stdio: ["ignore", "ignore", "inherit"],
      ipc(reply: UiBuildReply) {
        if (reply.id === 0) return resolveReady();
        c.pending.get(reply.id)?.(reply);
        c.pending.delete(reply.id);
      },
      onExit(_proc, code) {
        for (const settle of c.pending.values()) settle({ id: -1, ok: false, error: `UI builder exited (${code})`, rssMb: 0 });
        c.pending.clear();
        if (child === c) child = null;
      },
    });
    return c;
  };

  const retire = (c: Child) => {
    if (child === c) child = disposed ? null : spawnChild();
    c.proc.kill();
  };

  const build = async (): Promise<string> => {
    const c = (child ??= spawnChild());
    await c.ready;
    const id = ++nextId;
    const reply = await new Promise<UiBuildReply>((resolve) => {
      c.pending.set(id, resolve);
      c.proc.send({ id, entry: options.entry, tsconfig: options.tsconfig, external: options.external } satisfies UiBuildRequest);
    });
    c.builds++;
    if (c.builds >= recycleAfter || reply.rssMb > recycleAboveMb) retire(c);
    if (!reply.ok) throw new Error(reply.error);
    return reply.code;
  };

  const evaluate = (code: string, generation: number): UiModule => {
    const filename = options.entry;
    const module = { exports: {} as UiModule };
    const factory = (0, eval)(`${code}\n//# sourceURL=${filename}?swap=${generation}`) as (...args: unknown[]) => void;
    factory.call(module.exports, module.exports, hostRequire, module, filename, path.dirname(filename));
    return module.exports;
  };

  let generation = 0;
  let liveScope: UiScope | null = null;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  const settle = () => {
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      Bun.shrink();
    }, options.settleMs ?? 2000);
    settleTimer.unref();
  };
  process.once("exit", () => child?.proc.kill());

  return {
    /** Spawns the bundler ahead of the first load. */
    warm() {
      child ??= spawnChild();
    },
    async load(): Promise<UiModule> {
      const code = await build();
      const { value, scope } = evaluateInScope(() => evaluate(code, ++generation));
      if (liveScope) {
        liveScope.dispose();
        settle();
      }
      liveScope = scope;
      return value;
    },
    dispose() {
      disposed = true;
      if (child) retire(child);
    },
  };
}
