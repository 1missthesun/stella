import { SettingsCardTitle } from "@/global/settings/settings-card-targets";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { UserAskStoredSecureValue } from "@stella/contracts/user-ask";
import type { SavedValuesSyncAction } from "@stella/contracts/saved-values";
import { formatJoinCode } from "@stella/contracts/saved-values-trust";
import { useSavedValuesSync } from "@/features/saved-values/use-saved-values-sync";
import { Switch } from "@/ui/switch";
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
  const { status: sync, act, setEnabled } = useSavedValuesSync();

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

  const toggleSync = useCallback(
    async (enabled: boolean) => {
      setBusy("sync");
      try {
        await setEnabled(enabled);
      } finally {
        setBusy(null);
      }
    },
    [setEnabled],
  );

  const syncAction = useCallback(
    async (key: string, action: SavedValuesSyncAction) => {
      setBusy(key);
      setError(null);
      try {
        const result = await act(action);
        if (!result.ok) setError(t("settings.secureValues.errors.devices"));
      } finally {
        setBusy(null);
      }
    },
    [act, t],
  );

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
        <SettingsCardTitle titleKey="settings.secureValues.title" />
      </div>
      <p className="settings-card-desc">
        {t("settings.secureValues.description")}
      </p>
      {sync ? (
        <div className="settings-row" data-testid="secure-values-sync">
          <div className="settings-row-info">
            <div className="settings-row-label">
              {t("settings.secureValues.sync")}
            </div>
            <div className="settings-row-sublabel">
              {t("settings.secureValues.syncHint")}
            </div>
          </div>
          <div className="settings-row-control">
            <Switch
              checked={sync.enabled}
              disabled={busy === "sync"}
              aria-label={t("settings.secureValues.sync")}
              hideLabel
              onCheckedChange={(next) => void toggleSync(next)}
            />
          </div>
        </div>
      ) : null}
      {sync?.active ? (
        <SyncDevices sync={sync} busy={busy} onAction={syncAction} />
      ) : null}
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

function SyncDevices({
  sync,
  busy,
  onAction,
}: {
  sync: NonNullable<ReturnType<typeof useSavedValuesSync>["status"]>;
  busy: string | null;
  onAction: (key: string, action: SavedValuesSyncAction) => Promise<void>;
}) {
  const t = useT();
  const standing = sync.standing;
  const waiting = sync.waiting;
  const state =
    standing === "problem"
      ? { label: t("settings.secureValues.problem"), action: "startOver" as const, button: t("settings.secureValues.startOver") }
      : standing === "waiting" && waiting?.removed
        ? { label: t("settings.secureValues.removedHere"), action: "askAgain" as const, button: t("settings.secureValues.askAgain") }
        : standing === "waiting" && waiting?.declined
          ? { label: t("settings.secureValues.declined"), action: "askAgain" as const, button: t("settings.secureValues.askAgain") }
          : standing === "waiting" && waiting?.confirmed
            ? { label: t("settings.secureValues.waitingFor", { name: waiting.approver || t("global.savedValuesDevices.otherDevice") }) }
            : standing === "waiting" && waiting?.code
              ? {
                  label: t("global.savedValuesDevices.matchTitle", {
                    name: waiting.approver || t("global.savedValuesDevices.otherDevice"),
                  }),
                  sub: formatJoinCode(waiting.code),
                  action: "confirm" as const,
                  button: t("global.savedValuesDevices.matches"),
                }
              : standing === "waiting"
                ? { label: t("global.savedValuesDevices.getTitle"), sub: t("global.savedValuesDevices.getBody") }
                : null;
  return (
    <>
      {state ? (
        <div className="settings-row" data-testid="secure-values-standing">
          <div className="settings-row-info">
            <div className="settings-row-label">{state.label}</div>
            {"sub" in state && state.sub ? <div className="settings-row-sublabel">{state.sub}</div> : null}
          </div>
          {"action" in state && state.action ? (
            <div className="settings-row-control">
              <Button
                type="button"
                variant="ghost"
                className="pill-btn"
                disabled={busy !== null}
                onClick={() => void onAction("standing", { action: state.action })}
              >
                {state.button}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {standing === "member" && sync.devices.length > 0 ? (
        <>
          <div className="settings-card-desc">{t("settings.secureValues.devices")}</div>
          {sync.devices.map((device) => (
            <div className="settings-row" key={device.deviceId} data-testid="secure-values-device">
              <div className="settings-row-info">
                <div className="settings-row-label">{device.name}</div>
                {device.thisDevice || device.quiet ? (
                  <div className="settings-row-sublabel">
                    {device.thisDevice ? t("settings.secureValues.thisComputer") : t("settings.secureValues.quiet")}
                  </div>
                ) : null}
              </div>
              {device.thisDevice ? null : (
                <div className="settings-row-control">
                  <Button
                    type="button"
                    variant="ghost"
                    className="pill-btn pill-btn--danger"
                    disabled={busy !== null}
                    onClick={() => void onAction(`device:${device.deviceId}`, { action: "remove", deviceId: device.deviceId })}
                  >
                    {t("settings.secureValues.removeDevice")}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </>
      ) : null}
      {sync.releases.length > 0 ? (
        <>
          <div className="settings-card-desc">{t("settings.secureValues.cloudUses")}</div>
          {sync.releases.slice(0, 5).map((entry) => (
            <div className="settings-row" key={`${entry.at}:${entry.label}`} data-testid="secure-values-release">
              <div className="settings-row-info">
                <div className="settings-row-label">{entry.label}</div>
                <div className="settings-row-sublabel">
                  {[entry.taskName, formatWhen(entry.at), entry.refused ? t("settings.secureValues.refused") : null]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
            </div>
          ))}
        </>
      ) : null}
    </>
  );
}
