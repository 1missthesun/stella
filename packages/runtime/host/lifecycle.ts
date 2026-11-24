import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { causeToThrowable } from "./lifecycle/errors.js";
import {
  startOrAttachWorkerEffect,
} from "./lifecycle/attach.js";
import type {
  LifecycleConnection,
  LifecycleStartOptions,
} from "./lifecycle/options.js";

export type { LifecycleConnection, LifecycleStartOptions };

const lifecycleRuntime = ManagedRuntime.make(Layer.empty);

const runLifecycle = async <A>(
  effect: Effect.Effect<A, unknown>,
): Promise<A> => {
  const exit = await lifecycleRuntime.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  throw causeToThrowable(exit.cause);
};

export const startOrAttachWorker = async (
  options: LifecycleStartOptions,
): Promise<LifecycleConnection> =>
  runLifecycle(Effect.scoped(startOrAttachWorkerEffect(options)));

export { resolveBunBinaryPath } from "./lifecycle/spawn.js";
