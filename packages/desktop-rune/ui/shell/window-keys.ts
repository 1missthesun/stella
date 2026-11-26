import { useEffect, useRef, useSyncExternalStore } from "react";
import type { KeyEvent } from "../../host/rune-jsx/props";

/** Returns `false` to let the next binding (or nothing) take the chord. */
type Run = (e: KeyEvent) => boolean | void;
type Binding = { keys: readonly string[]; run: { current: Run }; scope: string };

const FULL = "full";
let bindings: Binding[] = [];
let keysByScope = new Map<string, string[]>();
const listeners = new Set<() => void>();

const changed = () => {
  const next = new Map<string, string[]>();
  for (const binding of bindings) next.set(binding.scope, [...new Set([...(next.get(binding.scope) ?? []), ...binding.keys])]);
  keysByScope = next;
  for (const listener of listeners) listener();
};

const dispatch = (scope: string, e: KeyEvent) => {
  for (let i = bindings.length - 1; i >= 0; i--) {
    const binding = bindings[i]!;
    if (binding.scope === scope && binding.keys.includes(e.chord) && binding.run.current(e) !== false) return;
  }
};

const onKey = (e: KeyEvent) => dispatch(FULL, e);
const noKeys: string[] = [];

/**
 * Window-level chords (desktop-ui's `document` keydown listeners); the latest registered binding
 * goes first. `scope` is the host window id for a window other than the full one.
 */
export function useWindowKeys(chords: readonly string[], run: Run, enabled = true, scope = FULL): void {
  const ref = useRef(run);
  ref.current = run;
  const signature = chords.join("\n");
  useEffect(() => {
    if (!enabled) return;
    const binding: Binding = { keys: signature.split("\n"), run: ref, scope };
    bindings = [...bindings, binding];
    changed();
    return () => {
      bindings = bindings.filter((b) => b !== binding);
      changed();
    };
  }, [signature, enabled, scope]);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** `keys` + `onKey` for the full window's `<window>`. */
export function useWindowKeyProps(): { keys: string[]; onKey: (e: KeyEvent) => void } {
  const current = useSyncExternalStore(subscribe, () => keysByScope.get(FULL) ?? noKeys);
  return { keys: current, onKey };
}

const scopedHandlers = new Map<string, (e: KeyEvent) => void>();
const handlerFor = (scope: string) => {
  let handler = scopedHandlers.get(scope);
  if (!handler) {
    handler = (e: KeyEvent) => dispatch(scope, e);
    scopedHandlers.set(scope, handler);
  }
  return handler;
};

/** `keys` + `onKey` for another app window's `<window>`, by its host window id. */
export function useScopedWindowKeyProps(): (scope: string) => { keys: string[]; onKey: (e: KeyEvent) => void } {
  const byScope = useSyncExternalStore(subscribe, () => keysByScope);
  return (scope) => ({ keys: byScope.get(scope) ?? noKeys, onKey: handlerFor(scope) });
}
