import { useCallback, useEffect, useState } from "react";
import type { UserAskStoredSecureValue } from "@stella/contracts/user-ask";
import { Button } from "@/ui/button";
import { useT } from "@/shared/i18n";
import { getElectronApi } from "@/platform/electron/electron";

export function SecureValuesCard() {
  const t = useT();
  const [values, setValues] = useState<readonly UserAskStoredSecureValue[]>(
    [],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const bridge = getElectronApi()?.userAsk;
    if (!bridge?.secureValuesList) return;
    try {
      setValues(await bridge.secureValuesList());
    } catch {
      setError(t("settings.secureValues.errors.load"));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = useCallback(
    async (payload: { id?: string; all?: boolean }) => {
      const bridge = getElectronApi()?.userAsk;
      if (!bridge?.secureValuesDelete) return;
      setBusy(payload.all ? "all" : (payload.id ?? null));
      setError(null);
      try {
        await bridge.secureValuesDelete(payload);
        await load();
      } catch {
        setError(t("settings.secureValues.errors.delete"));
      } finally {
        setBusy(null);
      }
    },
    [load, t],
  );

  return (
    <div className="settings-card" data-testid="secure-values-card">
      <div className="settings-card-header">
        <h3 className="settings-card-title">
          {t("settings.secureValues.title")}
        </h3>
      </div>
      <p className="settings-card-desc">
        {t("settings.secureValues.description")}
      </p>
      {values.length === 0 ? (
        <p className="settings-card-desc">{t("settings.secureValues.empty")}</p>
      ) : null}
      {values.map((value) => (
        <div className="settings-row" key={value.id}>
          <div className="settings-row-info">
            <div className="settings-row-label">
              {value.label || value.fieldId}
            </div>
            <div className="settings-card-desc">
              {t("settings.secureValues.saved", {
                saved: new Date(value.createdAt).toLocaleString(),
                expires: new Date(value.expiresAt).toLocaleString(),
              })}
            </div>
          </div>
          <div className="settings-row-control">
            <Button
              type="button"
              variant="ghost"
              className="pill-btn pill-btn--danger"
              disabled={busy !== null}
              onClick={() => void remove({ id: value.id })}
            >
              {t("settings.secureValues.delete")}
            </Button>
          </div>
        </div>
      ))}
      {values.length > 1 ? (
        <div className="settings-row">
          <div className="settings-row-info" />
          <div className="settings-row-control">
            <Button
              type="button"
              variant="ghost"
              className="pill-btn pill-btn--danger"
              disabled={busy !== null}
              onClick={() => void remove({ all: true })}
            >
              {t("settings.secureValues.deleteAll")}
            </Button>
          </div>
        </div>
      ) : null}
      {error ? (
        <p className="settings-card-desc settings-card-desc--error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
