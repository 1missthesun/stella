import { useCallback, useEffect, useRef, useState } from "react";
import { backendClient } from "@/platform/backend/backend-client";
import { useBackendValue } from "@/platform/backend/use-backend-view";
import { useCloudConversationSession } from "@/global/auth/hooks/use-cloud-conversation-session";
import { wakeTelemetryAccountSync } from "@/features/cloud/TelemetryPreferenceBridge";
import { useT } from "@/shared/i18n";
import { SettingsToggleCard } from "./settings-toggle-card";

export function TelemetrySettingsCard() {
  const t = useT();
  const { isCloudConversationReady } = useCloudConversationSession();
  const account = useBackendValue(
    "preferences.get",
    isCloudConversationReady ? {} : "skip",
  );
  const [enabled, setEnabled] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reconciledAccount = useRef<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const local =
          await window.electronAPI?.system?.getTelemetryEnabled?.();
        if (!cancelled && local) setEnabled(local.enabled);
      } catch {
        // The account value below still applies when signed in.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const accountEnabled = account?.telemetryEnabled;
    if (
      typeof accountEnabled !== "boolean" ||
      reconciledAccount.current === accountEnabled
    ) {
      return;
    }
    reconciledAccount.current = accountEnabled;
    void window.electronAPI?.system
      ?.setTelemetryEnabled?.(accountEnabled, { mirrorAccount: true })
      .then((state) => setEnabled(state.enabled))
      .catch(() => undefined);
  }, [account?.telemetryEnabled]);

  const onChange = useCallback(
    (next: boolean) => {
      const previous = enabled;
      setEnabled(next);
      setSaving(true);
      setError(null);
      const setLocal = async (value: boolean, accountOffPending = false) => {
        await window.electronAPI?.system?.setTelemetryEnabled?.(value, {
          accountOffPending,
        });
      };
      const setAccount = async (value: boolean) => {
        if (!isCloudConversationReady) return;
        await backendClient.call("preferences.set", {
          telemetryEnabled: value,
        });
        reconciledAccount.current = value;
      };
      void (async () => {
        try {
          if (next) {
            await setAccount(true);
            try {
              await setLocal(true);
            } catch (localError) {
              await setAccount(false).catch(() => undefined);
              throw localError;
            }
            return;
          }
          await setLocal(false, true);
          if (!isCloudConversationReady) return;
          try {
            await setAccount(false);
          } catch {
            setError(t("settings.telemetry.accountError"));
            wakeTelemetryAccountSync();
            return;
          }
          await setLocal(false).catch(() => undefined);
        } catch {
          setEnabled(previous);
          setError(t("settings.telemetry.error"));
        } finally {
          setSaving(false);
        }
      })();
    },
    [enabled, isCloudConversationReady, t],
  );

  return (
    <SettingsToggleCard
      title={t("settings.telemetry.title")}
      description={t("settings.telemetry.description")}
      error={error}
      checked={enabled}
      disabled={!loaded || saving}
      onChange={onChange}
    />
  );
}
