import { Deferred, Effect, Layer, ManagedRuntime } from "effect";

const latchRuntime = ManagedRuntime.make(Layer.empty);

export type ReadinessLatch = {
  open: () => void;
  isOpen: () => boolean;
  reset: () => void;
  awaitOpen: (timeoutMs?: number) => Promise<"open" | "timeout">;
};

export const createReadinessLatch = (): ReadinessLatch => {
  let gate = Deferred.makeUnsafe<void>();
  let opened = false;

  return {
    open: () => {
      if (opened) return;
      opened = true;
      Deferred.doneUnsafe(gate, Effect.void);
    },
    isOpen: () => opened,
    reset: () => {
      if (!opened) return;
      opened = false;
      gate = Deferred.makeUnsafe<void>();
    },
    awaitOpen: (timeoutMs) => {
      if (opened) return Promise.resolve("open");
      const openWait = latchRuntime
        .runPromise(Deferred.await(gate))
        .then(() => "open" as const);
      if (!Number.isFinite(timeoutMs) || (timeoutMs ?? 0) <= 0) {
        return openWait;
      }
      return new Promise((resolve) => {
        let settled = false;
        // Effect-ratchet pin (1 setTimeout): the wait bound for plain-TS
        // callers is a deliberately unref'd raw timer — a latch that never
        // opens must not keep the process alive for timeoutMs, which an
        // Effect sleep fiber (a ref'd timer under the hood) would.
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          resolve("timeout");
        }, timeoutMs);
        timer.unref?.();
        void openWait.then((outcome) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(outcome);
        });
      });
    },
  };
};
