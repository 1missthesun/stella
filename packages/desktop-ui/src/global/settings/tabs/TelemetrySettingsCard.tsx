import { useCallback, useEffect, useRef, useState } from "react";
import { backendClient } from "@/platform/backend/backend-client";
import { useBackendValue } from "@/platform/backend/use-backend-view";
import { useCloudConversationSession } from "@/global/auth/hooks/use-cloud-conversation-session";
import { useT } from "@/shared/i18n";
import { SettingsToggleCard } from "./settings-toggle-card";

/**
 * The one telemetry switch. The account preference is authoritative when
 * signed in (it also stops cloud-side reporting); the local preference is
 * what this device's producers check before recording anything, so both are
 * always written together and the account value is mirrored locally on load.
 * A failed save never leaves this device collecting: turning on writes the
 * account first, turning off stops this device first.
 */
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
        if (!cancelled && typeof local === "boolean") setEnabled(local);
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
    setEnabled(accountEnabled);
    void window.electronAPI?.system
      ?.setTelemetryEnabled?.(accountEnabled)
      .catch(() => undefined);
  }, [account?.telemetryEnabled]);

  const onChange = useCallback(
    (next: boolean) => {
      const previous = enabled;
      setEnabled(next);
      setSaving(true);
      setError(null);
      const setLocal = async (value: boolean) => {
        await window.electronAPI?.system?.setTelemetryEnabled?.(value);
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
            // On: the account first, so a failed save never leaves this
            // device collecting while the switch shows Off.
            await setAccount(true);
            try {
              await setLocal(true);
            } catch (localError) {
              await setAccount(false).catch(() => undefined);
              throw localError;
            }
            return;
          }
          // Off: this device stops first and stays stopped even when the
          // account can't be updated, and the switch says so.
          await setLocal(false);
          try {
            await setAccount(false);
          } catch {
            setError(t("settings.telemetry.accountError"));
          }
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
