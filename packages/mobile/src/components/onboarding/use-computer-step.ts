import { useEffect, useState } from "react";
import { listExecutionDevices } from "../../lib/execution-placement";
import { getPreferredPhoneAccess } from "../../lib/phone-access";

export function useComputerStepNeeded(signedIn: boolean): boolean | null {
  const [needed, setNeeded] = useState<boolean | null>(null);

  useEffect(() => {
    if (!signedIn) {
      setNeeded(true);
      return;
    }
    let cancelled = false;
    setNeeded(null);
    void (async () => {
      try {
        const stored = await getPreferredPhoneAccess();
        if (cancelled) return;
        if (stored) {
          setNeeded(false);
          return;
        }
        const devices = await listExecutionDevices();
        if (cancelled) return;
        setNeeded(devices.length === 0);
      } catch {
        if (!cancelled) setNeeded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  return needed;
}
