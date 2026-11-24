import { useCallback, useEffect, useState } from "react";
import type { SavedValuesSyncAction, SavedValuesSyncStatus } from "@stella/contracts/saved-values";
import { getElectronApi } from "@/platform/electron/electron";

/** This computer's sync of saved values, kept current as it changes. */
export const useSavedValuesSync = () => {
  const [status, setStatus] = useState<SavedValuesSyncStatus | null>(null);

  useEffect(() => {
    const bridge = getElectronApi()?.userAsk;
    if (!bridge?.secureValuesSyncGet) return;
    let live = true;
    void bridge.secureValuesSyncGet().then(
      (next) => {
        if (live) setStatus(next);
      },
      () => undefined,
    );
    const off = bridge.onSecureValuesSyncChanged?.((next) => setStatus(next));
    return () => {
      live = false;
      off?.();
    };
  }, []);

  const act = useCallback(async (action: SavedValuesSyncAction) => {
    const bridge = getElectronApi()?.userAsk;
    if (!bridge?.secureValuesSyncAction) return { ok: false };
    try {
      return await bridge.secureValuesSyncAction(action);
    } catch {
      return { ok: false };
    }
  }, []);

  const setEnabled = useCallback(async (enabled: boolean) => {
    const bridge = getElectronApi()?.userAsk;
    if (!bridge?.secureValuesSyncSet) return;
    setStatus(await bridge.secureValuesSyncSet({ enabled }));
  }, []);

  return { status, act, setEnabled };
};
