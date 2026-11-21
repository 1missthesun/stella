// The model catalog and the sign-in providers bring pi-ai, its provider SDK
// glue and ajv into main. Nothing needs them to open the window, so they stay
// out of main's startup files: deferred startup warms them a moment after the
// app has painted, and the Settings and model-picker handlers load them through
// the same calls, so a click that beats the warm-up just loads them right then.
import { getMainLogger } from "../observability/main-logger.js";

export const loadModelCatalog = () =>
  import("@stella/runtime/kernel/model-catalog");

export const loadLlmOAuthProviders = () =>
  import("@stella/runtime/kernel/storage/llm-oauth-providers");

export const warmLlmProviderModules = async (): Promise<void> => {
  const startedAt = performance.now();
  try {
    await Promise.all([loadModelCatalog(), loadLlmOAuthProviders()]);
    getMainLogger()?.process("startup.llm-provider-modules-warmed", {
      ms: Math.round(performance.now() - startedAt),
      elapsedMs: Math.round(process.uptime() * 1000),
    });
  } catch (error) {
    // The handlers load them again on first use and report a failure there.
    console.debug(
      "[startup] Warming the model catalog and sign-in providers failed:",
      error instanceof Error ? error.message : String(error),
    );
  }
};
