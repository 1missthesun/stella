import { Context, Layer } from "effect";
import type { WorkerInitializationState } from "../types.js";

export interface Interface {
  readonly deviceId: string;
  readonly get: () => WorkerInitializationState;
  readonly set: (next: WorkerInitializationState) => void;
  readonly patch: (patch: Partial<WorkerInitializationState>) => void;
}

export class Service extends Context.Service<Service, Interface>()(
  "@stella/runtime/worker/SessionConfig",
) {}

export const layer = (init: WorkerInitializationState, deviceId: string) =>
  Layer.sync(Service, () => {
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
  });
