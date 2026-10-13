import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { UserAskStoredSecureValue } from "@stella/contracts/user-ask";
import { Button } from "@/ui/button";
import { TextField } from "@/ui/text-field";
import { useT } from "@/shared/i18n";
import { getElectronApi } from "@/platform/electron/electron";

const formatWhen = (at: number) =>
  new Date(at).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

export function SecureValuesCard() {
  const t = useT();
  const [values, setValues] = useState<readonly UserAskStoredSecureValue[]>(
    [],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; label: string } | null>(
    null,
  );

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

  const rename = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      const bridge = getElectronApi()?.userAsk;
      if (!bridge?.secureValuesRename || !renaming) return;
      const label = renaming.label.trim();
      if (!label) return;
      setBusy(renaming.id);
      setError(null);
      try {
        const result = await bridge.secureValuesRename({
          id: renaming.id,
          label,
        });
        if (result?.ok === false) {
          setError(t("settings.secureValues.errors.rename"));
          return;
        }
        setRenaming(null);
        await load();
      } catch {
        setError(t("settings.secureValues.errors.rename"));
      } finally {
        setBusy(null);
      }
    },
    [load, renaming, t],
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
      {values.map((value) => {
        const editing = renaming?.id === value.id;
        const details = [
          value.account,
          value.fieldLabels.join(", "),
          t("settings.secureValues.saved", {
            saved: formatWhen(value.updatedAt),
          }),
          value.lastUsedAt
            ? t("settings.secureValues.lastUsed", {
                used: formatWhen(value.lastUsedAt),
              })
            : t("settings.secureValues.neverUsed"),
        ].filter(Boolean);
        return (
          <div
            className="settings-row"
            key={value.id}
            data-testid="secure-value-row"
          >
            <div className="settings-row-info">
              {editing ? (
                <form onSubmit={(event) => void rename(event)}
                >
                  <TextField
                    label={t("settings.secureValues.renameLabel")}
                    hideLabel
                    aria-label={t("settings.secureValues.renameLabel")}
                    value={renaming.label}
                    maxLength={120}
                    autoFocus
                    disabled={busy !== null}
                    onChange={(event) =>
                      setRenaming({ id: value.id, label: event.target.value })
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setRenaming(null);
                    }}
                  />
                </form>
              ) : (
                <div className="settings-row-label">{value.label}</div>
              )}
              <div className="settings-row-sublabel">
                {details.join(" · ")}
              </div>
            </div>
            <div className="settings-row-control">
              {editing ? (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    className="pill-btn"
                    disabled={busy !== null}
                    onClick={() => setRenaming(null)}
                  >
                    {t("settings.secureValues.renameCancel")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="pill-btn"
                    disabled={busy !== null || !renaming.label.trim()}
                    onClick={(event) => void rename(event)}
                  >
                    {t("settings.secureValues.renameSave")}
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    className="pill-btn"
                    disabled={busy !== null}
                    onClick={() =>
                      setRenaming({ id: value.id, label: value.label })
                    }
                  >
                    {t("settings.secureValues.rename")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="pill-btn pill-btn--danger"
                    disabled={busy !== null}
                    onClick={() => void remove({ id: value.id })}
                  >
                    {t("settings.secureValues.delete")}
                  </Button>
                </>
              )}
            </div>
          </div>
        );
      })}
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
