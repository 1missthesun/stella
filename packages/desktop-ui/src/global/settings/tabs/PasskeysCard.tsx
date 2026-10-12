import { useCallback, useEffect, useState } from "react";
import { authClient } from "@/global/auth/lib/auth-client";
import { Button } from "@/ui/button";
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

/**
 * Passkeys bind to the auth domain, so enrollment and sign-in run in the
 * web shell on that origin; the desktop app keeps its existing sign-in.
 * This card only renders there.
 */
export function PasskeysCard() {
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
    <div className="settings-card">
      <h3 className="settings-card-title">{t("settings.passkeys.title")}</h3>
      <p className="settings-card-desc">
        {t("settings.passkeys.description")}
      </p>
      {error ? (
        <p className="settings-card-desc settings-card-desc--error" role="alert">
          {error}
        </p>
      ) : null}
      {passkeys?.map((passkey) => (
        <div className="settings-row" key={passkey.id}>
          <div className="settings-row-info">
            <div className="settings-row-label">
              {passkey.name || t("settings.passkeys.unnamed")}
            </div>
            <div className="settings-card-desc">
              {passkey.createdAt
                ? new Date(passkey.createdAt).toLocaleDateString()
                : ""}
            </div>
          </div>
          <div className="settings-row-control">
            <Button
              type="button"
              variant="ghost"
              className="pill-btn pill-btn--danger"
              disabled={busy}
              onClick={() => remove(passkey.id)}
            >
              {t("settings.passkeys.remove")}
            </Button>
          </div>
        </div>
      ))}
      <div className="settings-row-control">
        <Button
          type="button"
          variant="ghost"
          className="pill-btn"
          disabled={busy}
          onClick={add}
        >
          {t("settings.passkeys.add")}
        </Button>
      </div>
    </div>
  );
}
