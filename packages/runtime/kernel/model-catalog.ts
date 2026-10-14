import type { Api, Model } from "@earendil-works/pi-ai";
import { modelRuntime } from "./model-runtime.js";

export const getModels = (providerId: string): Model<Api>[] =>
  modelRuntime.getModels(providerId);

export const getModelProviders = (): string[] => modelRuntime.getProviderIds();

export const isRegisteredModelReference = (rawReference: string): boolean =>
  modelRuntime.isRegisteredReference(rawReference);
