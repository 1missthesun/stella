// Screens and panels that most sessions never open, kept out of the boot UI: their module loads on
// first use (hover or open), so its source and compiled code are never resident until then. The
// host's module registry hands back an already-settled thenable for a local module (`status`,
// `value`, React's convention), so a screen whose module is in renders in the same commit. Hosts
// gate opening on `useLazyReady`, so a surface appears only once it can draw complete: no empty
// first frame, no fallback.

import { createElement, useEffect, useReducer, type ComponentType } from "react";

type Settled<T> = PromiseLike<T> & { status?: "pending" | "fulfilled" | "rejected"; value?: T; reason?: unknown };

export type LazyScreen<P> = ComponentType<P> & {
  /** Starts loading the module (on hover, or before opening); settles once the screen can render. */
  preload(): PromiseLike<unknown>;
  /** Its module is in (or failed, which the screen then throws to its error boundary). */
  ready(): boolean;
  /** Starts loading without retrying a failed load (render paths). */
  begin(): PromiseLike<unknown>;
  readonly lazyId: number;
};

let nextLazyId = 0;

const track = <T,>(promise: Settled<T>): Settled<T> => {
  if (promise.status === "fulfilled" || promise.status === "rejected") return promise;
  promise.status = "pending";
  promise.then(
    (value) => { promise.status = "fulfilled"; promise.value = value; },
    (reason) => { promise.status = "rejected"; promise.reason = reason; },
  );
  return promise;
};

/** A component whose module loads on first use; it draws nothing until then (gate with `useLazyReady`). */
export function lazyScreen<M, P extends object>(load: () => PromiseLike<M>, pick: (module: M) => ComponentType<P>): LazyScreen<P> {
  let loading: Settled<M> | null = null;
  const start = () => (loading ??= track(load() as Settled<M>));
  /** A failed load is tried again when the user next asks for the screen. */
  const preload = () => {
    if (loading?.status === "rejected") loading = null;
    return start();
  };

  function Lazy(props: P) {
    const promise = start();
    const [, settled] = useReducer((n: number) => n + 1, 0);
    useEffect(() => {
      if (promise.status !== "pending") return;
      let live = true;
      const done = () => { if (live) settled(); };
      promise.then(done, done);
      return () => { live = false; };
    }, [promise]);
    if (promise.status === "rejected") throw promise.reason;
    if (promise.status !== "fulfilled") return null;
    return createElement(pick(promise.value as M), props);
  }

  return Object.assign(Lazy, { preload, begin: start, ready: () => loading !== null && loading.status !== "pending", lazyId: ++nextLazyId });
}

/** Whether `screens` can draw complete; while `active`, starts their loads and re-renders once they settle. */
export function useLazyReady(active: boolean, ...screens: LazyScreen<any>[]): boolean {
  if (active) for (const screen of screens) screen.begin();
  const ready = !active || screens.every((screen) => screen.ready());
  const [, settled] = useReducer((n: number) => n + 1, 0);
  const which = screens.map((screen) => screen.lazyId).join(",");
  useEffect(() => {
    if (!active) return;
    let live = true;
    const done = () => { if (live) settled(); };
    // Opening again retries a load that failed last time.
    for (const screen of screens) screen.preload().then(done, done);
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, which]);
  return ready;
}
