import type { AutomaticExecutionStatusWake } from "./execution-placement-core";

export type TurnStatusWake = AutomaticExecutionStatusWake & {
  nudge: () => void;
  setPaused: (paused: boolean) => void;
};

export const createTurnStatusWake = (): TurnStatusWake => {
  const listeners = new Set<() => void>();
  let paused = false;
  const nudge = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    paused: () => paused,
    nudge,
    setPaused: (next) => {
      if (paused === next) return;
      paused = next;
      if (!next) nudge();
    },
  };
};
