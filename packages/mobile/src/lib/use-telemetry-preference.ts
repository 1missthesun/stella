import { useCallback, useEffect, useState } from "react";
import { getBackendClient, useBackendView } from "./backend";
import type { CloudConversationIdentity } from "./cloud-conversation-auth";

/** The account's telemetry switch: the backend preference is the authority. */
export function useTelemetryPreference(identity: CloudConversationIdentity | null) {
  const live = useBackendView("preferences.get", identity ? {} : "skip");
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const accountEnabled = live.value?.telemetryEnabled;

  useEffect(() => {
    if (typeof accountEnabled === "boolean") setEnabled(accountEnabled);
  }, [accountEnabled]);

  const setTelemetryEnabled = useCallback((next: boolean) => {
    setEnabled(next);
    setSaving(true);
    void getBackendClient()
      .call("preferences.set", { telemetryEnabled: next })
      .then((result) => setEnabled(result.telemetryEnabled))
      .catch(() => setEnabled((previous) => !previous))
      .finally(() => setSaving(false));
  }, []);

  return {
    enabled,
    saving,
    loading: live.value === undefined && live.error === undefined,
    setTelemetryEnabled,
  };
}
