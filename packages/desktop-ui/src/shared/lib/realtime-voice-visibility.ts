import { useEffect, useState } from "react";
import {
  isRealtimeVoiceEnabled,
  type RealtimeVoicePreferences,
} from "@stella/contracts/local-preferences";
import { platformCapabilities } from "@/platform/capabilities";

const PREFERENCES_CHANGED_EVENT = "stella:local-model-preferences-changed";

let cachedEnabled = false;
let loaded = false;
let inFlight: Promise<boolean> | null = null;

const listeners = new Set<(enabled: boolean) => void>();

const publish = (enabled: boolean) => {
  const changed = cachedEnabled !== enabled || !loaded;
  cachedEnabled = enabled;
  loaded = true;
  if (!changed) return;
  for (const listener of listeners) listener(enabled);
};

const readFromDisk = (): Promise<boolean> => {
  if (inFlight) return inFlight;
  const request = Promise.resolve(
    window.electronAPI?.system?.getLocalModelPreferences?.(),
  )
    .then((preferences) => {
      const enabled = isRealtimeVoiceEnabled(preferences?.realtimeVoice);
      publish(enabled);
      return enabled;
    })
    .catch(() => {
      publish(false);
      return false;
    })
    .finally(() => {
      inFlight = null;
    });
  inFlight = request;
  return request;
};

if (typeof window !== "undefined" && platformCapabilities.realtimeVoice) {
  window.addEventListener(PREFERENCES_CHANGED_EVENT, () => {
    void readFromDisk();
  });
}

export const realtimeVoiceVisible = (): boolean =>
  platformCapabilities.realtimeVoice && cachedEnabled;

export const setRealtimeVoiceVisible = async (
  enabled: boolean,
): Promise<void> => {
  const current = await window.electronAPI?.system?.getLocalModelPreferences?.();
  const next: RealtimeVoicePreferences = {
    ...(current?.realtimeVoice ?? { provider: "stella" }),
    enabled,
  };
  await window.electronAPI?.system?.setLocalModelPreferences?.({
    realtimeVoice: next,
  });
  publish(enabled);
  window.dispatchEvent(new CustomEvent(PREFERENCES_CHANGED_EVENT));
};

export const useRealtimeVoiceVisible = (): boolean => {
  const [enabled, setEnabled] = useState(() => realtimeVoiceVisible());

  useEffect(() => {
    if (!platformCapabilities.realtimeVoice) return;
    const listener = (next: boolean) => setEnabled(next);
    listeners.add(listener);
    if (loaded) {
      setEnabled(cachedEnabled);
    } else {
      void readFromDisk();
    }
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return platformCapabilities.realtimeVoice && enabled;
};
