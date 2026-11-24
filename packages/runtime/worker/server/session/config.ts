import type { WorkerInitializationState } from "../types.js";

export interface Interface {
  readonly deviceId: string;
  readonly get: () => WorkerInitializationState;
  readonly set: (next: WorkerInitializationState) => void;
  readonly patch: (patch: Partial<WorkerInitializationState>) => void;
}

export const make = (
  init: WorkerInitializationState,
  deviceId: string,
): Interface => {
  let state = init;
  return {
    deviceId,
    get: () => state,
    set: (next) => {
      state = next;
    },
    patch: (patch) => {
      state = { ...state, ...patch };
    },
  };
};
