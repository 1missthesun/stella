import { SettingsTabHeader } from "@/global/settings/AiryControls";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { UserAskStoredSecureValue } from "@stella/contracts/user-ask";
import type { SavedValuesSyncAction } from "@stella/contracts/saved-values";
import { formatJoinCode } from "@stella/contracts/saved-values-trust";
import { useSavedValuesSync } from "@/features/saved-values/use-saved-values-sync";
import { Switch } from "@/ui/switch";
import { Button } from "@/ui/button";
import { LogOut, Pencil, Trash2 } from "@/ui/icons";
import { TextField } from "@/ui/text-field";
import { useT } from "@/shared/i18n";
import { getElectronApi } from "@/platform/electron/electron";

const ASKED_SHOWN_MS = 4_000;

const formatTime = (at: number) =>
  new Date(at).toLocaleTimeString(undefined, { timeStyle: "short" });

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

  // Synced logins can arrive while this is open (this device just joined, or
  // another device saved one), so the list follows the sync's state.
  const syncedAt = sync?.lastSyncedAt;
  const standing = sync?.standing;
  useEffect(() => {
    void load();
  }, [load, syncedAt, standing]);

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

  const [justAsked, setJustAsked] = useState(false);
  useEffect(() => {
    if (!justAsked) return;
    const timer = window.setTimeout(() => setJustAsked(false), ASKED_SHOWN_MS);
    return () => window.clearTimeout(timer);
  }, [justAsked]);

  const askedAt = sync?.waiting?.askedAt;
  useEffect(() => {
    if (askedAt) setError(null);
  }, [askedAt]);

  const syncAction = useCallback(
    async (key: string, action: SavedValuesSyncAction) => {
      setBusy(key);
      setError(null);
      try {
        const result = await act(action);
        if (!result.ok) setError(t("settings.secureValues.errors.devices"));
        else if (action.action === "askAgain") setJustAsked(true);
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
    <>
      <SettingsTabHeader
        titleKey="settings.secureValues.title"
        cardKey="settings.secureValues.title"
      />
      <div className="settings-card" data-testid="secure-values-card">
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
        <SyncDevices sync={sync} busy={busy} justAsked={justAsked} onAction={syncAction} />
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
                <div className="settings-row-label settings-row-label-inline">
                  <span>{value.label}</span>
                  <button
                    type="button"
                    className="settings-inline-edit-btn"
                    disabled={busy !== null}
                    aria-label={`${t("settings.secureValues.rename")} — ${value.label}`}
                    title={t("settings.secureValues.rename")}
                    onClick={() =>
                      setRenaming({ id: value.id, label: value.label })
                    }
                  >
                    <Pencil size={13} aria-hidden />
                  </button>
                </div>
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
                    className="pill-btn pill-btn--primary"
                    disabled={busy !== null || !renaming.label.trim()}
                    onClick={(event) => void rename(event)}
                  >
                    {t("settings.secureValues.renameSave")}
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  className="settings-icon-btn settings-icon-btn--danger"
                  disabled={busy !== null}
                  aria-label={`${t("settings.secureValues.delete")} — ${value.label}`}
                  title={t("settings.secureValues.delete")}
                  onClick={() => void remove({ id: value.id })}
                >
                  <Trash2 size={15} aria-hidden />
                </Button>
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
    </>
  );
}

function SyncDevices({
  sync,
  busy,
  justAsked,
  onAction,
}: {
  sync: NonNullable<ReturnType<typeof useSavedValuesSync>["status"]>;
  busy: string | null;
  justAsked: boolean;
  onAction: (key: string, action: SavedValuesSyncAction) => Promise<void>;
}) {
  const t = useT();
  const standing = sync.standing;
  const waiting = sync.waiting;
  const askAgain = {
    action: "askAgain" as const,
    button: t(justAsked ? "settings.secureValues.askedNow" : "settings.secureValues.askAgain"),
  };
  const askNames = waiting?.approvers?.join(" / ") || t("global.savedValuesDevices.otherDevice");
  const state =
    standing === "problem"
      ? { label: t("settings.secureValues.problem"), action: "startOver" as const, button: t("settings.secureValues.startOver") }
      : standing === "waiting" && waiting?.removed
        ? { label: t("settings.secureValues.removedHere"), ...askAgain }
        : standing === "waiting" && waiting?.declined
          ? { label: t("settings.secureValues.declined"), ...askAgain }
          : standing === "waiting" && (waiting?.skipped || waiting?.idle)
            ? sync.records > 0
              ? {
                  label: t("settings.secureValues.onOtherDevices", { names: askNames }),
                  sub: t("settings.secureValues.useHereHint"),
                  action: "askAgain" as const,
                  button: t(justAsked ? "settings.secureValues.askedNow" : "settings.secureValues.useHere"),
                }
              : {
                  label: t("settings.secureValues.notSyncingWith", { names: askNames }),
                  action: "askAgain" as const,
                  button: t(justAsked ? "settings.secureValues.askedNow" : "settings.secureValues.syncHere"),
                }
          : standing === "waiting" && waiting?.confirmed
            ? { label: t("settings.secureValues.waitingFor", { name: waiting.approver || t("global.savedValuesDevices.otherDevice") }) }
            : standing === "waiting" && waiting?.code
              ? {
                  label: t("global.savedValuesDevices.getTitle"),
                  sub: `${t("global.savedValuesDevices.matchTitle", {
                    name: waiting.approver || t("global.savedValuesDevices.otherDevice"),
                  })}: ${formatJoinCode(waiting.code)}`,
                  action: "confirm" as const,
                  button: t("global.savedValuesDevices.matches"),
                }
              : standing === "waiting"
                ? {
                    label: t("global.savedValuesDevices.getTitle"),
                    sub: waiting?.askFailed
                      ? t("settings.secureValues.askFailed")
                      : waiting?.askedAt
                        ? t("settings.secureValues.asked", { time: formatTime(waiting.askedAt), names: askNames })
                        : t("global.savedValuesDevices.getBody", { names: askNames }),
                    ...askAgain,
                  }
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
                disabled={busy !== null || (justAsked && state.action === "askAgain")}
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
          <div className="settings-subhead">{t("settings.secureValues.devices")}</div>
          {sync.devices.map((device) => {
            const sameName = sync.devices.some((other) => other !== device && other.name === device.name);
            const details = [
              device.thisDevice ? t("settings.secureValues.thisComputer") : null,
              !device.thisDevice && device.quiet ? t("settings.secureValues.quiet") : null,
              sameName ? t("settings.secureValues.added", { added: formatWhen(device.addedAt) }) : null,
            ].filter(Boolean);
            return (
            <div className="settings-row" key={device.deviceId} data-testid="secure-values-device">
              <div className="settings-row-info">
                <div className="settings-row-label">{device.name}</div>
                {details.length > 0 ? <div className="settings-row-sublabel">{details.join(" · ")}</div> : null}
              </div>
              {device.thisDevice ? null : (
                <div className="settings-row-control">
                  <Button
                    type="button"
                    variant="ghost"
                    className="settings-icon-btn"
                    disabled={busy !== null}
                    aria-label={`${t("settings.secureValues.removeDevice")} — ${device.name}`}
                    title={t("settings.secureValues.removeDevice")}
                    onClick={() => void onAction(`device:${device.deviceId}`, { action: "remove", deviceId: device.deviceId })}
                  >
                    <LogOut size={15} aria-hidden />
                  </Button>
                </div>
              )}
            </div>
            );
          })}
        </>
      ) : null}
      {sync.releases.length > 0 ? (
        <>
          <div className="settings-subhead">{t("settings.secureValues.cloudUses")}</div>
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
