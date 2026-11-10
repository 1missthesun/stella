import { useSyncExternalStore, type Dispatch, type SetStateAction } from "react";
import { VIEW_STATE_KEY_PREFIX } from "@stella/contracts/ui-state";
import { uiState } from "@/platform/ui-state";

/**
 * Where the user is: what a reload, a remount, a restart or a crash must put
 * back. Values are JSON, live under `view.` keys in the durable UI state, and
 * are read synchronously on the first render.
 */
const WRITE_DELAY_MS = 200;

type Listener = () => void;

const parsed = new Map<string, unknown>();
const listeners = new Map<string, Set<Listener>>();
const unwritten = new Map<string, unknown>();
let writeTimer: ReturnType<typeof setTimeout> | null = null;

const storageKey = (key: string) => `${VIEW_STATE_KEY_PREFIX}${key}`;

const load = (key: string): unknown => {
  if (parsed.has(key)) return parsed.get(key);
  let value: unknown;
  const raw = uiState.getItem(storageKey(key));
  if (raw !== null) {
    try {
      value = JSON.parse(raw);
    } catch {
      value = undefined;
    }
  }
  parsed.set(key, value);
  return value;
};

export const flushViewState = () => {
  if (writeTimer !== null) {
    clearTimeout(writeTimer);
    writeTimer = null;
  }
  for (const [key, value] of unwritten) {
    if (value === undefined) uiState.removeItem(storageKey(key));
    else uiState.setItem(storageKey(key), JSON.stringify(value));
  }
  unwritten.clear();
  uiState.flush();
};

const store = (key: string, value: unknown) => {
  parsed.set(key, value);
  unwritten.set(key, value);
  writeTimer ??= setTimeout(flushViewState, WRITE_DELAY_MS);
  for (const listener of listeners.get(key) ?? []) listener();
};

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushViewState, { capture: true });
}

export type ViewAtom<T> = {
  get: () => T;
  set: Dispatch<SetStateAction<T>>;
  subscribe: (listener: Listener) => () => void;
  use: () => T;
};

const atoms = new Map<string, ViewAtom<unknown>>();

/**
 * A value that survives reloads and restarts. `accepts` rejects a stored
 * value written by an older shape of the same key.
 */
export const viewAtom = <T,>(
  key: string,
  initial: T,
  accepts: (value: unknown) => boolean = (value) =>
    typeof value === typeof initial &&
    (value === null) === (initial === null) &&
    Array.isArray(value) === Array.isArray(initial),
): ViewAtom<T> => {
  const known = atoms.get(key);
  if (known) return known as ViewAtom<T>;
  const get = (): T => {
    const value = load(key);
    return value !== undefined && accepts(value) ? (value as T) : initial;
  };
  const subscribe = (listener: Listener) => {
    let set = listeners.get(key);
    if (!set) listeners.set(key, (set = new Set()));
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  };
  const atom: ViewAtom<T> = {
    get,
    set: (action) => {
      const current = get();
      const next =
        typeof action === "function"
          ? (action as (previous: T) => T)(current)
          : action;
      if (Object.is(next, current)) return;
      store(key, Object.is(next, initial) ? undefined : next);
    },
    subscribe,
    use: () => useSyncExternalStore(subscribe, get, () => initial),
  };
  atoms.set(key, atom as ViewAtom<unknown>);
  return atom;
};

/** `useState` whose value survives reloads and restarts. */
export const useViewState = <T,>(
  key: string,
  initial: T,
  accepts?: (value: unknown) => boolean,
): [T, Dispatch<SetStateAction<T>>] => {
  const atom = viewAtom(key, initial, accepts);
  return [atom.use(), atom.set];
};

export const readViewState = (key: string): unknown => load(key);

export const writeViewState = (key: string, value: unknown) => {
  store(key, value);
};

/** Forget where the user was: a view that cannot be shown must not be restored again. */
export const discardViewState = () => {
  unwritten.clear();
  parsed.clear();
  for (const key of uiState.keys()) {
    if (key.startsWith(VIEW_STATE_KEY_PREFIX)) uiState.removeItem(key);
  }
};
