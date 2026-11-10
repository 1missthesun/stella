import { useCallback, useEffect, useState } from "react";
import { ANONYMOUS_COUNTS_ENABLED } from "@stella/contracts/telemetry/anonymous-counts";
import { useT } from "@/shared/i18n";
import { SettingsToggleCard } from "./settings-toggle-card";

/** "Send anonymous usage counts": local to this computer, on by default. */
export function AnonymousCountsSettingsCard() {
  const t = useT();
  const [available, setAvailable] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ANONYMOUS_COUNTS_ENABLED) return;
    let cancelled = false;
    void window.electronAPI?.system
      ?.getAnonymousCounts?.()
      .then((state) => {
        if (cancelled) return;
        setAvailable(state.available);
        setEnabled(state.enabled);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const onChange = useCallback(
    (next: boolean) => {
      const previous = enabled;
      setEnabled(next);
      setSaving(true);
      setError(null);
      void (async () => {
        try {
          const state = await window.electronAPI?.system?.setAnonymousCountsEnabled?.(next);
          if (state) setEnabled(state.enabled);
        } catch {
          setEnabled(previous);
          setError(t("settings.anonymousCounts.error"));
        } finally {
          setSaving(false);
        }
      })();
    },
    [enabled, t],
  );

  if (!ANONYMOUS_COUNTS_ENABLED || !available) return null;
  return (
    <SettingsToggleCard
      titleKey="settings.anonymousCounts.title"
      description={t("settings.anonymousCounts.description")}
      error={error}
      checked={enabled}
      disabled={saving}
      onChange={onChange}
    />
  );
}
