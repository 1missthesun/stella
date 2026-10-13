import { useEffect, useState } from "react";
import { backendClient } from "@/platform/backend/backend-client";
import { useBackendValue } from "@/platform/backend/use-backend-view";
import { useCloudConversationSession } from "@/global/auth/hooks/use-cloud-conversation-session";

const RETRY_MS = 30_000;
const wakeListeners = new Set<() => void>();

/** Ask the bridge to retry a pending account off now. */
export const wakeTelemetryAccountSync = (): void => {
  for (const listener of wakeListeners) listener();
};

function AccountTelemetryBridge() {
  const account = useBackendValue("preferences.get", {});
  const accountEnabled = account?.telemetryEnabled;
  const [wake, setWake] = useState(0);

  useEffect(() => {
    const listener = () => setWake((n) => n + 1);
    wakeListeners.add(listener);
    return () => {
      wakeListeners.delete(listener);
    };
  }, []);

  // The account preference is mirrored onto this device, except while an
  // off made here hasn't reached the account yet: then the account is
  // written to false (retried until it lands) and this device stays off.
  // The account's echo of false settles the pending off.
  useEffect(() => {
    if (typeof accountEnabled !== "boolean") return;
    const system = window.electronAPI?.system;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const apply = async () => {
      try {
        const state = await system?.setTelemetryEnabled?.(accountEnabled, {
          mirrorAccount: true,
        });
        if (cancelled || !state?.accountOffPending) return;
        await backendClient.call("preferences.set", {
          telemetryEnabled: false,
        });
      } catch {
        if (!cancelled) timer = setTimeout(() => void apply(), RETRY_MS);
      }
    };
    void apply();
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [accountEnabled, wake]);

  return null;
}

/** Keeps this device's telemetry switch consistent with the account's. */
export function TelemetryPreferenceBridge() {
  const mode = useCloudConversationSession();
  if (!mode.isCloudConversationReady) return null;
  const key = `${mode.accountScope}:${mode.identityRevision}:${mode.ownerSubject ?? "missing"}`;
  return <AccountTelemetryBridge key={key} />;
}
