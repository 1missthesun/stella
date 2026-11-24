import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as ManagedRuntime from "effect/ManagedRuntime";

import { causeToThrowable } from "./errors.js";
import * as HomeService from "./home-service.js";

let homeRuntimeSingleton: ManagedRuntime.ManagedRuntime<
  HomeService.Service,
  never
> | null = null;

const homeRuntime = (): ManagedRuntime.ManagedRuntime<
  HomeService.Service,
  never
> => (homeRuntimeSingleton ??= ManagedRuntime.make(HomeService.layer));

export const runHome = async <A>(
  effect: Effect.Effect<A, unknown, HomeService.Service>,
): Promise<A> => {
  const exit = await homeRuntime().runPromiseExit(effect);
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  throw causeToThrowable(exit.cause);
};

export const withHome = <A>(
  use: (home: HomeService.Interface) => Effect.Effect<A, unknown>,
): Promise<A> =>
  runHome(
    Effect.gen(function* () {
      const home = yield* HomeService.Service;
      return yield* use(home);
    }),
  );
