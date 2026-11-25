import { useEffect, useRef, useSyncExternalStore } from "react";
import type { KeyEvent } from "../../host/rune-jsx/props";

/** Returns `false` to let the next binding (or nothing) take the chord. */
type Run = (e: KeyEvent) => boolean | void;
type Binding = { keys: readonly string[]; run: { current: Run } };

let bindings: Binding[] = [];
let keys: string[] = [];
const listeners = new Set<() => void>();

const changed = () => {
  keys = [...new Set(bindings.flatMap((b) => b.keys))];
  for (const listener of listeners) listener();
};

const onKey = (e: KeyEvent) => {
  for (let i = bindings.length - 1; i >= 0; i--) {
    const binding = bindings[i]!;
    if (binding.keys.includes(e.chord) && binding.run.current(e) !== false) return;
  }
};

/** Window-level chords for the full window (desktop-ui's `document` keydown listeners); the latest registered binding goes first. */
export function useWindowKeys(chords: readonly string[], run: Run, enabled = true): void {
  const ref = useRef(run);
  ref.current = run;
  const signature = chords.join("\n");
  useEffect(() => {
    if (!enabled) return;
    const binding: Binding = { keys: signature.split("\n"), run: ref };
    bindings = [...bindings, binding];
    changed();
    return () => {
      bindings = bindings.filter((b) => b !== binding);
      changed();
    };
  }, [signature, enabled]);
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** `keys` + `onKey` for the full window's `<window>`. */
export function useWindowKeyProps(): { keys: string[]; onKey: (e: KeyEvent) => void } {
  const current = useSyncExternalStore(subscribe, () => keys);
  return { keys: current, onKey };
}
