import { useSyncExternalStore } from "react";
import type { ViewName } from "@stella/contracts/backend/api";

export const VIEW_FIXTURE_LOADING = "loading";

type ViewFixtureControl = {
  set: (view: ViewName, value: unknown) => void;
  clear: (view?: ViewName) => void;
};

declare global {
  var __stellaViewFixtures: ViewFixtureControl | undefined;
}

const fixtures = new Map<ViewName, unknown>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

if (import.meta.env.DEV) {
  globalThis.__stellaViewFixtures = {
    set: (view, value) => {
      fixtures.set(view, value);
      notify();
    },
    clear: (view) => {
      if (view) fixtures.delete(view);
      else fixtures.clear();
      notify();
    },
  };
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** A dev-only stand-in value for a backend view, set from devtools or a verify harness through `globalThis.__stellaViewFixtures`. */
export const useViewFixture = (view: ViewName): unknown =>
  useSyncExternalStore(subscribe, () => fixtures.get(view));
