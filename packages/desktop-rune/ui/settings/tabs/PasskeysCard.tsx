import { SettingsCard, SettingsCardDesc, SettingsRow } from "../parts";
import { Button, T } from "../../kit/compat";
import { useSettings } from "../settings.styles";
import { usePill } from "../../global/shared/pill.styles";
import { SettingsCardTitle } from "../settings-card-targets";
import { useCallback, useEffect, useState } from "react";
import { authClient } from "@/global/auth/lib/auth-client";
import { useT } from "@/shared/i18n";

type PasskeyRow = {
  id: string;
  name?: string | null;
  createdAt?: string | Date | null;
  deviceType?: string | null;
};

type PasskeyFetch = (
  path: string,
  options?: { method?: string; body?: Record<string, unknown> },
) => Promise<{
  data: PasskeyRow[] | { status?: boolean } | null;
  error: { message?: string } | null;
}>;

const passkeyFetch = (): PasskeyFetch =>
  (authClient as unknown as { $fetch: PasskeyFetch }).$fetch;

export function PasskeysCard() {
  const s = useSettings();
  const t = useT();
  const [passkeys, setPasskeys] = useState<PasskeyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await passkeyFetch()("/passkey/list-user-passkeys", {
        method: "GET",
      });
      if (result.error || !Array.isArray(result.data)) {
        throw new Error(result.error?.message ?? "list failed");
      }
      setPasskeys(result.data);
      setError(null);
    } catch {
      setError(t("settings.passkeys.loadError"));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const add = useCallback(() => {
    setBusy(true);
    void authClient.passkey
      .addPasskey()
      .then((result) => {
        if (result.error) throw new Error(result.error.message ?? "add failed");
        return load();
      })
      .catch(() => setError(t("settings.passkeys.loadError")))
      .finally(() => setBusy(false));
  }, [load, t]);

  const remove = useCallback(
    (id: string) => {
      setBusy(true);
      void passkeyFetch()("/passkey/delete-passkey", {
        method: "POST",
        body: { id },
      })
        .then(load)
        .catch(() => setError(t("settings.passkeys.loadError")))
        .finally(() => setBusy(false));
    },
    [load, t],
  );

  if (window.electronAPI) return null;

  return (
    <SettingsCard>
      <SettingsCardTitle titleKey="settings.passkeys.title" />
      <SettingsCardDesc>
        {t("settings.passkeys.description")}
      </SettingsCardDesc>
      {error ? (
        <SettingsCardDesc error role="alert">
          {error}
        </SettingsCardDesc>
      ) : null}
      {passkeys?.map((passkey) => (
        <SettingsRow key={passkey.id}>
          <col {...s.settingsRowInfo}>
            <T w="full" {...s.settingsRowLabel}>
              {passkey.name || t("settings.passkeys.unnamed")}
            </T>
            <SettingsCardDesc>
              {passkey.createdAt
                ? new Date(passkey.createdAt).toLocaleDateString()
                : ""}
            </SettingsCardDesc>
          </col>
          <row {...s.settingsRowControl}>
            <Button variant="ghost" className="pill-btn pill-btn--danger" disabled={busy} onClick={() => remove(passkey.id)}>
              {t("settings.passkeys.remove")}
            </Button>
          </row>
        </SettingsRow>
      ))}
      <row {...s.settingsRowControl}>
        <Button variant="ghost" className="pill-btn" disabled={busy} onClick={add}>
          {t("settings.passkeys.add")}
        </Button>
      </row>
    </SettingsCard>
  );
}
