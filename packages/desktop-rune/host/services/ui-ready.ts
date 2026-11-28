// `import()` of a UI module the UI already holds, and `React.lazy` over it, without a render that
// waits. Every UI module is in the build (the one bundle, or the registry's modules after a hot
// swap), so a dynamic import is done the moment it is asked for: vite-compat.ts rewrites the
// bundle's into `readyImport`, and ui-registry.ts answers the modules'. A promise would still
// answer a microtask later, and
// `React.lazy` suspends on any thenable that hasn't answered by the time it returns. A suspended
// boundary then holds its content back for React's fallback throttle (300 ms): a viewer, dialog
// or settings tab opened for the first time showed nothing for that long.
//
// A `Ready` is a thenable whose outcome is known now or on demand. Its callbacks run in a
// microtask, as a promise's do, unless something reads its `status` first, which runs them at
// once: React's `use` reads it during render, and React's `lazy` as installed here
// (`installReadyLazy`) reads it to hand React the module in the same call. Chains
// (`import("./x").then((m) => ({ default: m.X }))`) stay `Ready`, so a lazy component over one
// renders on its first render too.

import type * as ReactNS from "react";

type Outcome = { ok: true; value: unknown } | { ok: false; reason: unknown };
type Status = "pending" | "fulfilled" | "rejected";
type Thenable = PromiseLike<unknown> & { status?: Status; value?: unknown; reason?: unknown };
type OnFulfilled = ((value: unknown) => unknown) | null | undefined;
type OnRejected = ((reason: unknown) => unknown) | null | undefined;

const isThenable = (value: unknown): value is Thenable =>
  value !== null && (typeof value === "object" || typeof value === "function") && typeof (value as { then?: unknown }).then === "function";

/** What a settled thenable (a `Ready`, or a promise React's `use` has marked) came to, or null while it hasn't. */
const outcomeOf = (thenable: Thenable): Outcome | null => {
  const status = thenable.status;
  if (status === "fulfilled") return { ok: true, value: thenable.value };
  if (status === "rejected") return { ok: false, reason: thenable.reason };
  return null;
};

export class Ready<T = unknown> implements PromiseLike<T> {
  #compute: (() => unknown) | null;
  #outcome: Outcome | null = null;
  /** A thenable `compute` returned that hasn't settled yet: this one follows it. */
  #waiting: Promise<unknown> | null = null;

  constructor(compute: () => unknown) {
    this.#compute = compute;
    queueMicrotask(() => this.#settle());
  }

  static resolve<V>(value: V): Ready<Awaited<V>> {
    return new Ready(() => value);
  }

  static reject<V = never>(reason: unknown): Ready<V> {
    return new Ready(() => {
      throw reason;
    });
  }

  #settle(): void {
    const compute = this.#compute;
    if (!compute) return;
    this.#compute = null;
    let value: unknown;
    try {
      value = compute();
    } catch (reason) {
      this.#outcome = { ok: false, reason };
      return;
    }
    if (!isThenable(value)) {
      this.#outcome = { ok: true, value };
      return;
    }
    const known = outcomeOf(value);
    if (known) {
      this.#outcome = known;
      return;
    }
    this.#waiting = Promise.resolve(value).then(
      (settled) => {
        this.#outcome = { ok: true, value: settled };
        this.#waiting = null;
        return settled;
      },
      (reason) => {
        this.#outcome = { ok: false, reason };
        this.#waiting = null;
        throw reason;
      },
    );
    // Its outcome reaches whoever chains on it; an unchained rejection is not this one's to report.
    this.#waiting.catch(() => {});
  }

  get status(): Status {
    this.#settle();
    return this.#outcome ? (this.#outcome.ok ? "fulfilled" : "rejected") : "pending";
  }

  get value(): T | undefined {
    this.#settle();
    return this.#outcome?.ok ? (this.#outcome.value as T) : undefined;
  }

  get reason(): unknown {
    this.#settle();
    return this.#outcome && !this.#outcome.ok ? this.#outcome.reason : undefined;
  }

  then<A = T, B = never>(onFulfilled?: ((value: T) => A | PromiseLike<A>) | null, onRejected?: ((reason: any) => B | PromiseLike<B>) | null): Ready<A | B> {
    return new Ready<A | B>(() => {
      this.#settle();
      if (this.#waiting) return (this.#waiting as Promise<T>).then(onFulfilled ?? undefined, onRejected ?? undefined);
      const outcome = this.#outcome!;
      if (outcome.ok) return onFulfilled ? onFulfilled(outcome.value as T) : outcome.value;
      if (onRejected) return onRejected(outcome.reason);
      throw outcome.reason;
    });
  }

  catch<B = never>(onRejected?: ((reason: any) => B | PromiseLike<B>) | null): Ready<T | B> {
    return this.then(undefined, onRejected);
  }

  finally(onFinally?: (() => unknown) | null): Ready<T> {
    if (!onFinally) return this.then();
    return this.then(
      (value) => new Ready(() => onFinally()).then(() => value),
      (reason) =>
        new Ready(() => onFinally()).then(() => {
          throw reason;
        }),
    );
  }

  get [Symbol.toStringTag]() {
    return "Ready";
  }
}

/** `import()` of a module the UI bundle holds (vite-compat rewrites the UI's own): settled at once. */
export const readyImport = (load: () => unknown): Ready => new Ready(load);

const INSTALLED = Symbol.for("stella.readyLazy");

/**
 * Makes React's `lazy` take a module that is already there within the call: a factory whose
 * thenable has settled (a `Ready`, or a chain on one) hands React the module synchronously, so the
 * component renders on its first render instead of suspending. Any other thenable is React's own
 * lazy loading, unchanged. React's exports object is the one every `require("react")` in the
 * process gets, the UI bundle's included, so this runs once, before the UI loads.
 */
export function installReadyLazy(React: typeof ReactNS): void {
  const exports = React as typeof ReactNS & { [INSTALLED]?: true };
  if (exports[INSTALLED]) return;
  const lazy = React.lazy;
  const ready = ((factory: () => PromiseLike<{ default: unknown }>) =>
    lazy(() => {
      const thenable = factory() as Thenable;
      const outcome = isThenable(thenable) ? outcomeOf(thenable) : null;
      if (!outcome) return thenable as Promise<{ default: never }>;
      // React's lazy marks the payload resolved when `then` answers within the call.
      return {
        then(onFulfilled: OnFulfilled, onRejected: OnRejected) {
          if (outcome.ok) onFulfilled?.(outcome.value);
          else onRejected?.(outcome.reason);
        },
      } as unknown as Promise<{ default: never }>;
    })) as typeof ReactNS.lazy;
  Object.assign(exports, { lazy: ready, [INSTALLED]: true });
}
