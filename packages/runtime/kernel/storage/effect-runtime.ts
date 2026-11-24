let effectModule: Promise<typeof import("../../worker/effect-lazy.js")> | null = null;
const loadEffect = () => (effectModule ??= import("../../worker/effect-lazy.js"));

export const forkFixedRateFiber = (
  intervalMs: number,
  tick: () => void,
): (() => void) => {
  let canceled = false;
  let cancelFiber: (() => void) | null = null;
  void loadEffect().then(({ Effect, Fiber, Schedule }) => {
    if (canceled) return;
    const fiber = Effect.runFork(
      Effect.sleep(intervalMs).pipe(
        Effect.andThen(
          Effect.sync(() => {
            if (!canceled) tick();
          }),
        ),
        Effect.repeat(Schedule.spaced(intervalMs)),
      ),
    );
    cancelFiber = () => {
      void Effect.runFork(Fiber.interrupt(fiber));
    };
  });
  return () => {
    if (canceled) return;
    canceled = true;
    cancelFiber?.();
  };
};
