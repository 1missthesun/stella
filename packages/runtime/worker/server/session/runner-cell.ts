import type { RuntimeRunner } from "../types.js";

export interface Interface {
  readonly get: () => RuntimeRunner | null;
  readonly set: (runner: RuntimeRunner | null) => void;
}

export const make = (): Interface => {
  let runner: RuntimeRunner | null = null;
  return {
    get: () => runner,
    set: (next) => {
      runner = next;
    },
  };
};
