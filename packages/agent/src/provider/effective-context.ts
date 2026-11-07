import type { Api, Model } from "@earendil-works/pi-ai";
import type { MutableModels, Provider } from "@earendil-works/pi-ai/models";
import { effectiveContextWindow } from "@stella/contracts/model-context";

const capped = <M>(model: M): M => {
  const entry = model as { id?: unknown; contextWindow?: unknown; provider?: unknown };
  if (typeof entry.id !== "string" || typeof entry.contextWindow !== "number") return model;
  const provider = typeof entry.provider === "string" ? entry.provider : undefined;
  const window = effectiveContextWindow(entry.id, entry.contextWindow, provider);
  return window === entry.contextWindow ? model : { ...model, contextWindow: window };
};

/**
 * Lists a provider's models at their effective window, which is what pi
 * compacts against and handovers fit to. Requests still carry the advertised
 * window: pi-ai caps each request's output at the window less its estimated
 * input, which near the compaction point would leave little room to answer.
 */
export const withEffectiveContext = (provider: Provider): Provider => {
  const advertised = (model: Model<Api>): Model<Api> => {
    const listed = (provider.getAllModels?.() ?? provider.getModels()).find(
      (entry) => entry.id === model.id && typeof (entry as { contextWindow?: unknown }).contextWindow === "number",
    ) as Model<Api> | undefined;
    return listed && listed.contextWindow > model.contextWindow ? { ...model, contextWindow: listed.contextWindow } : model;
  };
  return {
    ...provider,
    getModels: () => provider.getModels().map(capped),
    ...(provider.getAllModels ? { getAllModels: () => provider.getAllModels!().map(capped) } : {}),
    stream: (model, context, options) => provider.stream(advertised(model), context, options),
    streamSimple: (model, context, options) => provider.streamSimple(advertised(model), context, options),
  };
};

/** Every provider set on `models` from now on lists its models at their effective window. */
export const effectiveContextModels = <M extends MutableModels>(models: M): M => {
  const setProvider = models.setProvider.bind(models);
  models.setProvider = (provider) => setProvider(withEffectiveContext(provider));
  return models;
};
