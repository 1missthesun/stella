import {
  buildEngineRoutingPatch,
  buildEngineTransitionReasoningPatch,
  type ModelPickerEngine,
} from "./engine-model-routing";

/** The same engine switch the model picker commits. */
export const switchEngine = async (engine: ModelPickerEngine): Promise<boolean> => {
  const system = window.electronAPI?.system;
  const preferences = await system?.getLocalModelPreferences?.();
  if (!system?.setLocalModelPreferences || !preferences) return false;
  if (preferences.agentRuntimeEngine === engine) return true;
  await system.setLocalModelPreferences({
    ...buildEngineRoutingPatch(preferences, engine),
    ...buildEngineTransitionReasoningPatch(preferences, engine),
  });
  window.dispatchEvent(new CustomEvent("stella:local-model-preferences-changed"));
  return true;
};
