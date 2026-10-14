import { useCallback, useEffect, useState } from "react";
import { useT } from "@/shared/i18n";
import { SettingsToggleCard } from "./settings-toggle-card";

export function CompanionSettingsCard() {
  const t = useT();
  const [visible, setVisible] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const api = window.electronAPI?.companion;
    if (!api) return;
    let cancelled = false;
    void api
      .getVisible()
      .then((result) => {
        if (cancelled) return;
        setVisible(result.visible);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    const unsubscribe = api.onVisibleChanged((result) => {
      if (!cancelled) setVisible(result.visible);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const onChange = useCallback(
    async (next: boolean) => {
      const api = window.electronAPI?.companion;
      if (!api) return;
      setBusy(true);
      setError(null);
      setVisible(next);
      try {
        const result = await api.setVisible(next);
        setVisible(result.visible);
      } catch {
        setError(t("settings.companion.error"));
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  if (!window.electronAPI?.companion) return null;

  return (
    <SettingsToggleCard
      titleKey="settings.companion.title"
      description={t("settings.companion.description")}
      error={error}
      checked={visible}
      disabled={!loaded || busy}
      onChange={(checked) => void onChange(checked)}
    />
  );
}
