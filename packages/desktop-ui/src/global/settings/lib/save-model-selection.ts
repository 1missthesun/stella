import { buildModelSelectionPatch } from "./engine-model-routing";
import { recordRecentModel } from "./recent-models";

export const saveModelSelection = async (
  value: string,
  target: Parameters<typeof buildModelSelectionPatch>[2],
): Promise<void> => {
  const system = window.electronAPI?.system;
  const preferences = await system?.getLocalModelPreferences?.();
  if (!system?.setLocalModelPreferences || !preferences) return;
  await system.setLocalModelPreferences(buildModelSelectionPatch(preferences, value, target));
  window.dispatchEvent(new CustomEvent("stella:local-model-preferences-changed"));
  if (value) recordRecentModel(value);
};
