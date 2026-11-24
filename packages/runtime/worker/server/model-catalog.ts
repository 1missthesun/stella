import { Context, Effect, Layer } from "effect";
import type {
  RuntimeModelCatalogRow,
  RuntimeModelCatalogSnapshot,
} from "@stella/contracts/model-catalog";
import { NOTIFICATION_NAMES } from "@stella/contracts/protocol";
import type { ModelRuntimeSnapshot } from "../../kernel/model-runtime.js";
import { getFileLogger } from "@stella/node-shared/observability/file-logger.js";
import { forkDelayed, type WorkerTimerHandle } from "../effect-runtime.js";
import * as HostBus from "./host-bus.js";
import type { RuntimeRunner } from "./types.js";

/**
 * The catalog as the host receives it: the picker's fields only, as one
 * compact row per model grouped by provider (`modelsByProvider`; see
 * `RuntimeModelCatalogRow`). A composed model also carries transport details
 * (compat, prices, thinking maps) that would double what every boot pushes to
 * each window. Windows read it with `expandRuntimeModelCatalogModels`, which
 * also reads the older `models` array: an Update swaps the windows before it
 * restarts the runtime, so a new window briefly talks to the old runtime.
 */
export const toCatalogWire = ({
  models,
  ...rest
}: ModelRuntimeSnapshot): RuntimeModelCatalogSnapshot => {
  // Provider ids come from users' models.json too, so a Map, not `obj[id]`
  // (an id like "constructor" would hit Object.prototype). Stella's own
  // models are left out: the renderer lists them from the backend and drops
  // them from this catalog anyway.
  const byProvider = new Map<string, RuntimeModelCatalogRow[]>();
  for (const model of models) {
    if (model.api === "stella" || model.provider === "stella") continue;
    const flags =
      (model.reasoning ? 1 : 0) | (model.input.includes("image") ? 2 : 0);
    let list = byProvider.get(model.provider);
    if (!list) byProvider.set(model.provider, (list = []));
    list.push([
      model.id,
      model.name && model.name !== model.id ? model.name : 0,
      model.contextWindow,
      model.maxTokens,
      flags,
    ]);
  }
  return {
    ...rest,
    modelsByProvider: Object.fromEntries(byProvider),
  };
};

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
