import { SettingsCard, SettingsCardDesc, SettingsCardHeader, SettingsRow } from "../parts";
import { Button, Form, Switch, T, TextField, type DomEvent } from "../../kit/compat";
import { useSettings } from "../settings.styles";
import { usePill } from "../../global/shared/pill.styles";
import { SettingsCardTitle } from "../settings-card-targets";
import { useCallback, useEffect, useState } from "react";
import type { UserAskStoredSecureValue } from "@stella/contracts/user-ask";
import type { SavedValuesSyncAction } from "@stella/contracts/saved-values";
import { formatJoinCode } from "@stella/contracts/saved-values-trust";
import { useSavedValuesSync } from "@/features/saved-values/use-saved-values-sync";
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
  const s = useSettings();
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
    async (event: DomEvent) => {
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
    <SettingsCard>
      <SettingsCardHeader>
        <SettingsCardTitle titleKey="settings.secureValues.title" />
      </SettingsCardHeader>
      <SettingsCardDesc>
        {t("settings.secureValues.description")}
      </SettingsCardDesc>
      {sync ? (
        <SettingsRow>
          <col {...s.settingsRowInfo}>
            <T w="full" {...s.settingsRowLabel}>
              {t("settings.secureValues.sync")}
            </T>
            <T w="full" {...s.settingsRowSublabel}>
              {t("settings.secureValues.syncHint")}
            </T>
          </col>
          <row {...s.settingsRowControl}>
            <Switch checked={sync.enabled} disabled={busy === "sync"} aria-label={t("settings.secureValues.sync")} hideLabel onCheckedChange={(next) => void toggleSync(next)} />
          </row>
        </SettingsRow>
      ) : null}
      {sync?.active ? (
        <SyncDevices sync={sync} busy={busy} justAsked={justAsked} onAction={syncAction} />
      ) : null}
      {values.length === 0 ? (
        <SettingsCardDesc>{t("settings.secureValues.empty")}</SettingsCardDesc>
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
          <SettingsRow key={value.id}>
            <col {...s.settingsRowInfo}>
              {editing ? (
                <Form onSubmit={(event) => void rename(event)}>
                  <TextField label={t("settings.secureValues.renameLabel")} hideLabel aria-label={t("settings.secureValues.renameLabel")} value={renaming.label} maxLength={120} autoFocus disabled={busy !== null} onChange={(event) =>
                      setRenaming({ id: value.id, label: event.target.value })
                    } onKeyDown={(event) => {
                      if (event.key === "Escape") setRenaming(null);
                    }} />
                </Form>
              ) : (
                <T w="full" {...s.settingsRowLabel}>{value.label}</T>
              )}
              <T w="full" {...s.settingsRowSublabel}>
                {details.join(" · ")}
              </T>
            </col>
            <row {...s.settingsRowControl}>
              {editing ? (
                <>
                  <Button variant="ghost" className="pill-btn" disabled={busy !== null} onClick={() => setRenaming(null)}>
                    {t("settings.secureValues.renameCancel")}
                  </Button>
                  <Button variant="ghost" className="pill-btn" disabled={busy !== null || !renaming.label.trim()} onClick={(event) => void rename(event)}>
                    {t("settings.secureValues.renameSave")}
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="ghost" className="pill-btn" disabled={busy !== null} onClick={() =>
                      setRenaming({ id: value.id, label: value.label })
                    }>
                    {t("settings.secureValues.rename")}
                  </Button>
                  <Button variant="ghost" className="pill-btn pill-btn--danger" disabled={busy !== null} onClick={() => void remove({ id: value.id })}>
                    {t("settings.secureValues.delete")}
                  </Button>
                </>
              )}
            </row>
          </SettingsRow>
        );
      })}
      {values.length > 1 ? (
        <SettingsRow>
          <col {...s.settingsRowInfo} />
          <row {...s.settingsRowControl}>
            <Button variant="ghost" className="pill-btn pill-btn--danger" disabled={busy !== null} onClick={() => void remove({ all: true })}>
              {t("settings.secureValues.deleteAll")}
            </Button>
          </row>
        </SettingsRow>
      ) : null}
      {error ? (
        <SettingsCardDesc error role="alert">
          {error}
        </SettingsCardDesc>
      ) : null}
    </SettingsCard>
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
  const s = useSettings();
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
        <SettingsRow>
          <col {...s.settingsRowInfo}>
            <T w="full" {...s.settingsRowLabel}>{state.label}</T>
            {"sub" in state && state.sub ? <T w="full" {...s.settingsRowSublabel}>{state.sub}</T> : null}
          </col>
          {"action" in state && state.action ? (
            <row {...s.settingsRowControl}>
              <Button variant="ghost" className="pill-btn" disabled={busy !== null || (justAsked && state.action === "askAgain")} onClick={() => void onAction("standing", { action: state.action })}>
                {state.button}
              </Button>
            </row>
          ) : null}
        </SettingsRow>
      ) : null}
      {standing === "member" && sync.devices.length > 0 ? (
        <>
          <SettingsCardDesc>{t("settings.secureValues.devices")}</SettingsCardDesc>
          {sync.devices.map((device) => {
            const sameName = sync.devices.some((other) => other !== device && other.name === device.name);
            const details = [
              device.thisDevice ? t("settings.secureValues.thisComputer") : null,
              !device.thisDevice && device.quiet ? t("settings.secureValues.quiet") : null,
              sameName ? t("settings.secureValues.added", { added: formatWhen(device.addedAt) }) : null,
            ].filter(Boolean);
            return (
            <SettingsRow key={device.deviceId}>
              <col {...s.settingsRowInfo}>
                <T w="full" {...s.settingsRowLabel}>{device.name}</T>
                {details.length > 0 ? <T w="full" {...s.settingsRowSublabel}>{details.join(" · ")}</T> : null}
              </col>
              {device.thisDevice ? null : (
                <row {...s.settingsRowControl}>
                  <Button variant="ghost" className="pill-btn pill-btn--danger" disabled={busy !== null} onClick={() => void onAction(`device:${device.deviceId}`, { action: "remove", deviceId: device.deviceId })}>
                    {t("settings.secureValues.removeDevice")}
                  </Button>
                </row>
              )}
            </SettingsRow>
            );
          })}
        </>
      ) : null}
      {sync.releases.length > 0 ? (
        <>
          <SettingsCardDesc>{t("settings.secureValues.cloudUses")}</SettingsCardDesc>
          {sync.releases.slice(0, 5).map((entry) => (
            <SettingsRow key={`${entry.at}:${entry.label}`}>
              <col {...s.settingsRowInfo}>
                <T w="full" {...s.settingsRowLabel}>{entry.label}</T>
                <T w="full" {...s.settingsRowSublabel}>
                  {[entry.taskName, formatWhen(entry.at), entry.refused ? t("settings.secureValues.refused") : null]
                    .filter(Boolean)
                    .join(" · ")}
                </T>
              </col>
            </SettingsRow>
          ))}
        </>
      ) : null}
    </>
  );
}
