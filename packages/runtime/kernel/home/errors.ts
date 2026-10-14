import * as Cause from "effect/Cause";

/**
 * Tagged failures for the Stella-home subsystem. The plain-Promise facades
 * (stella-home.ts, device.ts, …) rethrow these
 * across the Effect boundary via `Cause.squash`, so every escaping `message`
 * is byte-identical to the string the pre-Effect implementation threw.
 * Do not reword them.
 */

export const causeToThrowable = (cause: Cause.Cause<unknown>): unknown =>
  Cause.squash(cause);
