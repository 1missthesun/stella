import { useCallback, useEffect, useState } from "react";
import type { GoogleProviderState } from "@stella/contracts/backend/integrations";
import { backendClient } from "@/platform/backend/backend-client";
import { useCloudConversationSession } from "@/global/auth/hooks/use-cloud-conversation-session";
import { useT } from "@/shared/i18n";
import { SettingsToggleCard } from "./settings-toggle-card";

export function GoogleConnectionCard() {
  const t = useT();
  const { isCloudConversationReady } = useCloudConversationSession();
  const [state, setState] = useState<GoogleProviderState | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setState(await backendClient.call("integrations.googleProvider", {}));
    } catch {
      setError(t("settings.googleComposio.loadError"));
    }
  }, [t]);

  useEffect(() => {
    if (isCloudConversationReady) void load();
  }, [isCloudConversationReady, load]);

  const onChange = useCallback(
    (useComposio: boolean) => {
      setSaving(true);
      setError(null);
      void backendClient
        .call("integrations.setGoogleProvider", {
          provider: useComposio ? "composio" : "stella",
        })
        .then(setState)
        .catch(() => setError(t("settings.googleComposio.saveError")))
        .finally(() => setSaving(false));
    },
    [t],
  );

  if (!isCloudConversationReady) return null;
  return (
    <SettingsToggleCard
      titleKey="settings.googleComposio.title"
      description={t("settings.googleComposio.description")}
      checked={state?.provider === "composio"}
      disabled={saving || state === null}
      error={error}
      onChange={onChange}
      retry={state === null ? () => void load() : undefined}
      retryLabel={t("settings.googleComposio.retry")}
    />
  );
}
