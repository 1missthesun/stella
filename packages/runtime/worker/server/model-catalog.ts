import { Context, Effect, Layer } from "effect";
import { NOTIFICATION_NAMES } from "@stella/contracts/protocol";
import { getFileLogger } from "../../observability/file-logger.js";
import { forkDelayed, type WorkerTimerHandle } from "../effect-runtime.js";
import * as HostBus from "./host-bus.js";
import type { RuntimeRunner } from "./types.js";

export interface Interface {
  readonly ensureSubscription: () => Promise<
    (typeof import("../../kernel/model-runtime.js"))["modelRuntime"]
  >;
  readonly scheduleWarm: (getRunner: () => RuntimeRunner | null) => void;
  readonly dispose: () => void;
}

export class Service extends Context.Service<Service, Interface>()(
  "@stella/runtime/worker/ModelCatalog",
) {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const hostBus = yield* HostBus.Service;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    let modulePromise:
      | Promise<typeof import("../../kernel/model-runtime.js")>
      | undefined;
    let warmTimer: WorkerTimerHandle | null = null;

    const ensureSubscription = async () => {
      const loaded = await (modulePromise ??= import(
        "../../kernel/model-runtime.js"
      ));
      if (!disposed) {
        unsubscribe ??= loaded.modelRuntime.onCatalogChanged((snapshot) => {
          hostBus.notify(NOTIFICATION_NAMES.MODEL_CATALOG_UPDATED, snapshot);
        });
      }
      return loaded.modelRuntime;
    };

    const scheduleWarm = (getRunner: () => RuntimeRunner | null) => {
      if (!getRunner()) return;
      if (warmTimer) warmTimer.cancel();
      warmTimer = forkDelayed(50, () => {
        warmTimer = null;
        const warmStartedAt = Date.now();
        void getRunner()
          ?.warmModelCatalog()
          .then(() => {
            getFileLogger()?.process("startup.catalog-warmed", {
              ms: Date.now() - warmStartedAt,
            });
          })
          .catch(() => undefined);
      });
    };

    const dispose = () => {
      disposed = true;
      unsubscribe?.();
      unsubscribe = undefined;
      if (warmTimer) {
        warmTimer.cancel();
        warmTimer = null;
      }
    };

    yield* Effect.addFinalizer(() => Effect.sync(dispose));

    return { ensureSubscription, scheduleWarm, dispose };
  }),
);
