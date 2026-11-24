let effectModule: Promise<typeof import("../../worker/effect-lazy.js")> | null = null;
const loadEffect = () => (effectModule ??= import("../../worker/effect-lazy.js"));

export const sleepMs = async (ms: number): Promise<void> => {
  const { Effect } = await loadEffect();
  await Effect.runPromise(Effect.sleep(ms));
};

export const forkTimeoutFiber = (
  timeoutMs: number,
  onTimeout: () => void,
): (() => void) => {
  let canceled = false;
  let cancelFiber: (() => void) | null = null;
  void loadEffect().then(({ Effect, Fiber }) => {
    if (canceled) return;
    const fiber = Effect.runFork(
      Effect.sleep(timeoutMs).pipe(
        Effect.andThen(
          Effect.sync(() => {
            if (!canceled) onTimeout();
          }),
        ),
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
