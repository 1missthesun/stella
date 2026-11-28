// Dev-only (STELLA_JSPERF=1): how busy the JS thread is, logged once a second. Every piece of JS
// work starts at one of the natives' entry points (engine events, timers, fetch and socket events),
// so their summed run time is the thread's busy time.
import { ops, stats } from "../../desktop-rune/host/bridge";
import { liveInstances } from "../../desktop-rune/host/reconciler";

export function installJsPerf() {
  const g = globalThis as any;
  const busy: Record<string, number> = {};
  const count: Record<string, number> = {};
  const timers = new Map<string, number>();
  for (const name of ["__runeEvent", "__timerFire", "__fetchEvent", "__wsEvent"]) {
    const fn = g[name];
    if (typeof fn !== "function") continue;
    g[name] = function (this: unknown, ...args: unknown[]) {
      const t0 = __native.now();
      try {
        return fn.apply(this, args);
      } finally {
        const dt = __native.now() - t0;
        busy[name] = (busy[name] ?? 0) + dt;
        count[name] = (count[name] ?? 0) + 1;
        if (name === "__timerFire" && dt > 4) {
          const k = String(args[0]);
          timers.set(k, (timers.get(k) ?? 0) + dt);
        }
      }
    };
  }
  const big = new Map<string, number>();
  const props = ops.props.bind(ops);
  ops.props = (id: number, json: string) => {
    if (json.length > 8000) {
      const k = `${id}:${json.slice(0, 120)}`;
      big.set(k, (big.get(k) ?? 0) + json.length);
    }
    return props(id, json);
  };
  const rafBy = new Map<string, number>();
  const raf = g.requestAnimationFrame;
  g.requestAnimationFrame = (cb: (t: number) => void) => {
    const where = (new Error().stack ?? "").split("\n").slice(1, 4).map((l) => l.trim().replace(/@.*\//, "@")).join(" < ");
    rafBy.set(where, (rafBy.get(where) ?? 0) + 1);
    return raf(cb);
  };
  let last = { ...stats };
  setInterval(() => {
    const total = Object.values(busy).reduce((a, b) => a + b, 0);
    const parts = Object.keys(busy).map((k) => `${k.slice(2)}=${busy[k].toFixed(0)}ms/${count[k]}`).join(" ");
    console.info(`[jsperf] busy=${total.toFixed(0)}ms ${parts} renders=${stats.renders - last.renders} ops=${stats.ops - last.ops} bytes=${stats.bytes - last.bytes} events=${stats.events - last.events} timers=${g.__liveTimers?.() ?? "?"} nodes=${liveInstances()}`);
    last = { ...stats };
    for (const k of Object.keys(busy)) delete busy[k];
    for (const k of Object.keys(count)) delete count[k];
    timers.clear();
    for (const [k, n] of big) console.info(`[jsperf] big props ${n} bytes: ${k}`);
    big.clear();
    for (const [k, n] of rafBy) console.info(`[jsperf] raf ${n}x: ${k}`);
    rafBy.clear();
  }, 1000);
}
