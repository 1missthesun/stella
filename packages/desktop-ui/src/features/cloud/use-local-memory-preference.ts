import { useCallback, useEffect, useState } from "react";
import { setLocalMemoryChoice } from "./cloud-memory-local-mirror";

export type LocalMemoryPreferenceView = {
  available: boolean;
  loading: boolean;
  saving: boolean;
  failed: boolean;
  memoryEnabled: boolean;
  setMemoryEnabled: (memoryEnabled: boolean) => Promise<boolean>;
};

/** Memory on this computer while signed out: the user's last choice, on until they make one. */
export function useLocalMemoryPreference(active: boolean): LocalMemoryPreferenceView {
  const system = window.electronAPI?.system;
  const available = Boolean(
    system?.getLocalModelPreferences && system.setLocalModelPreferences,
  );
  const [state, setState] = useState({
    loading: true,
    saving: false,
    failed: false,
    memoryEnabled: true,
  });

  useEffect(() => {
    if (!active || !available) return;
    let cancelled = false;
    void window.electronAPI?.system
      ?.getLocalModelPreferences?.()
      .then((preferences) => {
        if (cancelled) return;
        setState((current) => ({
          ...current,
          loading: false,
          failed: !preferences,
          memoryEnabled: preferences ? (preferences.memoryChoice ?? true) : current.memoryEnabled,
        }));
      })
      .catch(() => {
        if (!cancelled) setState((current) => ({ ...current, loading: false, failed: true }));
      });
    return () => {
      cancelled = true;
    };
  }, [active, available]);

  const setMemoryEnabled = useCallback(async (memoryEnabled: boolean) => {
    setState((current) => ({ ...current, saving: true, failed: false, memoryEnabled }));
    const saved = await setLocalMemoryChoice(memoryEnabled).catch(() => false);
    setState((current) => ({
      ...current,
      saving: false,
      failed: !saved,
      memoryEnabled: saved ? memoryEnabled : !memoryEnabled,
    }));
    return saved;
  }, []);

  return { available, ...state, setMemoryEnabled };
}
