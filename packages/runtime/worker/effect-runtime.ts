let effectModule: Promise<typeof import("./effect-lazy.js")> | null = null;
const loadEffect = () => (effectModule ??= import("./effect-lazy.js"));

export const sleepMs = async (ms: number): Promise<void> => {
  const { Effect } = await loadEffect();
  await Effect.runPromise(Effect.sleep(ms));
};

export type WorkerTimerHandle = {
  readonly cancel: () => void;
};

export const forkDelayed = (
  delayMs: number,
  fire: () => void,
): WorkerTimerHandle => {
  if (delayMs <= 0) {
    let canceled = false;
    const handle = setImmediate(() => {
      if (!canceled) fire();
    });
    return {
      cancel: () => {
        if (canceled) return;
        canceled = true;
        clearImmediate(handle);
      },
    };
  }
  let canceled = false;
  let cancelFiber: (() => void) | null = null;
  void loadEffect().then(({ Effect, Fiber }) => {
    if (canceled) return;
    const fiber = Effect.runFork(
      Effect.sleep(delayMs).pipe(
        Effect.andThen(
          Effect.sync(() => {
            if (!canceled) fire();
          }),
        ),
      ),
    );
    cancelFiber = () => {
      void Effect.runFork(Fiber.interrupt(fiber));
    };
  });
  return {
    cancel: () => {
      if (canceled) return;
      canceled = true;
      cancelFiber?.();
    },
  };
};
