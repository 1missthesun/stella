import { Context, Effect, Layer } from "effect";
import type { RuntimeModelCatalogSnapshot } from "@stella/contracts/model-catalog";
import { NOTIFICATION_NAMES } from "@stella/contracts/protocol";
import type { ModelRuntimeSnapshot } from "../../kernel/model-runtime.js";
import { getFileLogger } from "../../observability/file-logger.js";
import { forkDelayed, type WorkerTimerHandle } from "../effect-runtime.js";
import * as HostBus from "./host-bus.js";
import type { RuntimeRunner } from "./types.js";

/**
 * The catalog as the host receives it: the picker's fields only. A composed
 * model also carries transport details (compat, prices, thinking maps) that
 * would double what every boot pushes to each window.
 */
export const toCatalogWire = ({
  models,
  ...rest
}: ModelRuntimeSnapshot): RuntimeModelCatalogSnapshot => ({
  ...rest,
  models: models.map((model) => ({
    id: model.id,
    name: model.name,
    provider: model.provider,
    api: model.api,
    baseUrl: model.baseUrl,
    reasoning: model.reasoning,
    input: model.input,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
  })),
});

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
          hostBus.notify(
            NOTIFICATION_NAMES.MODEL_CATALOG_UPDATED,
            toCatalogWire(snapshot),
          );
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
