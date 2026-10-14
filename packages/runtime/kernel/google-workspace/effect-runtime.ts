/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Cause, Effect, Exit, Layer, ManagedRuntime } from "effect";

export const googleWorkspaceRuntime = ManagedRuntime.make(Layer.empty);

export const runGoogleWorkspaceEffect = async <A>(
  effect: Effect.Effect<A, unknown>,
): Promise<A> => {
  const exit = await googleWorkspaceRuntime.runPromiseExit(effect);
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  throw Cause.squash(exit.cause);
};

export const tryGoogleWorkspaceOp = <A>(
  op: () => Promise<A>,
): Effect.Effect<A, unknown> =>
  Effect.tryPromise({
    try: op,
    catch: (error) => error,
  });

export const tryGoogleWorkspaceSync = <A>(
  op: () => A,
): Effect.Effect<A, unknown> =>
  Effect.try({
    try: op,
    catch: (error) => error,
  });
