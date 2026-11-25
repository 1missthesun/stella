import { SettingsCard, SettingsCardHeader } from "../../settings/parts";
import { Button, Check, CloudIcon, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Monitor, Plus, Press, T, Trash2, showToast, tx } from "../../kit/compat";
import { usePill } from "../shared/pill.styles";
import { useSelfHost } from "./self-host.styles";
import { useSettings } from "../../settings/settings.styles";
import { SettingsCardTitle } from "../../settings/settings-card-targets";
import { useCallback, useEffect, useState } from "react";
import type { DesktopServerEntry } from "@stella/contracts/desktop/self-host";
import { useT } from "@/shared/i18n";
import { selfHostDialogs, useDesktopServerState } from "@/global/self-host/self-host-store";

const hostOf = (origin: string | null) => {
  if (!origin) return "";
  try {
    return new URL(origin).host;
  } catch {
    return origin;
  }
};

type Pending = { kind: "switch" | "remove"; entry: DesktopServerEntry };

export function ServerSettingsCard() {
  const sSelfHost = useSelfHost();
  const sSettings = useSettings();
  const t = useT();
  const state = useDesktopServerState();
  const [servers, setServers] = useState<DesktopServerEntry[] | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const api = window.electronAPI?.selfHost;
    if (!api?.listServers) return;
    try {
      setServers(await api.listServers());
    } catch {
      setServers(null);
    }
  }, []);

  useEffect(() => {
    if (state?.canSwitch) void refresh();
  }, [refresh, state?.canSwitch]);

  if (!state || (!state.canSwitch && !state.selfHosted)) return null;

  const nameOf = (entry: DesktopServerEntry) =>
    entry.kind === "hosted" ? t("selfHost.settings.hostedName") : entry.name;

  const fallbackEntry: DesktopServerEntry = state.selfHosted
    ? {
        id: state.serverId ?? "current",
        kind: "self-hosted",
        name: state.name ?? hostOf(state.backendUrl),
        origin: state.backendUrl,
        active: true,
        signedIn: true,
      }
    : { id: "hosted", kind: "hosted", name: "Stella", origin: null, active: true, signedIn: true };
  const list = state.canSwitch && servers ? servers : [fallbackEntry];

  const confirm = async () => {
    if (!pending) return;
    const api = window.electronAPI?.selfHost;
    if (!api) return;
    const { kind, entry } = pending;
    setBusy(true);
    if (kind === "remove") {
      await api.removeServer(entry.id).catch(() => undefined);
      setBusy(false);
      setPending(null);
      void refresh();
      return;
    }
    const result = await api.switchServer(entry.id);
    if (result.ok) {
      if (!result.relaunching) {
        setBusy(false);
        setPending(null);
      }
      return;
    }
    setBusy(false);
    setPending(null);
    if (result.reason === "needs_pairing") {
      selfHostDialogs.openConnect(null, result.error);
      return;
    }
    showToast({
      title: t("selfHost.settings.switchFailed"),
      description: result.error,
      variant: "error",
    });
  };

  return (
    <SettingsCard>
      <SettingsCardHeader>
        <SettingsCardTitle titleKey="selfHost.settings.title" />
        {state.selfHosted ? (
          <Button variant="ghost" className="pill-btn" onClick={() => selfHostDialogs.openDevice()}>
            {t("selfHost.settings.connectDevice")}
          </Button>
        ) : null}
      </SettingsCardHeader>
      <col role="list">
        {list.map((entry, index) => {
          const ServerIcon = entry.kind === "hosted" ? CloudIcon : Monitor;
          return (
            <row {...sSelfHost.serverListRow} {...(index > 0 ? sSelfHost.serverListRowDivided : null)} key={entry.id} role="listitem">
              <Press {...sSelfHost.serverListMain} selected={entry.active} disabled={busy || entry.active || !state.canSwitch} onPress={() => setPending({ kind: "switch", entry })} {...((busy || entry.active || !state.canSwitch) ? sSelfHost.serverListMainDisabled : null)}>
                <ServerIcon size={18} {...sSelfHost.serverListIcon} />
                <col {...sSelfHost.serverListCopy}>
                  <T {...tx(sSelfHost.serverListMain)} {...sSelfHost.serverListName} {...(busy || entry.active || !state.canSwitch ? null : sSelfHost.serverListNameHover)}>{nameOf(entry)}</T>
                  <T {...tx(sSelfHost.serverListMain)} {...sSelfHost.serverListHost}>
                    {entry.kind === "hosted"
                      ? t("selfHost.settings.hostedSub")
                      : t("selfHost.settings.selfHostedSub", { host: hostOf(entry.origin) })}
                  </T>
                </col>
                {entry.active ? <Check size={16} {...sSelfHost.serverListCheck} color={sSelfHost.serverListCheck.color} /> : null}
              </Press>
              {entry.kind === "self-hosted" && !entry.active && state.canSwitch ? (
                <Press {...sSelfHost.serverListRemove} label={t("selfHost.settings.removeA11y", { name: nameOf(entry) })} title={t("selfHost.settings.removeA11y", { name: nameOf(entry) })} disabled={busy} onPress={() => setPending({ kind: "remove", entry })}>
                  <Trash2 size={16} color={sSelfHost.serverListRemove.color} />
                </Press>
              ) : null}
            </row>
          );
        })}
        {state.canSwitch ? (
          <row {...sSelfHost.serverListRow} {...(list.length > 0 ? sSelfHost.serverListRowDivided : null)} role="listitem">
            <Press {...sSelfHost.serverListMain} {...sSelfHost.serverListMainAdd} disabled={busy} onPress={() => selfHostDialogs.openConnect()} {...((busy) ? sSelfHost.serverListMainDisabled : null)}>
              <Plus size={18} {...sSelfHost.serverListIcon} {...sSelfHost.serverListMainAdd_serverListIcon} color={sSelfHost.serverListMainAdd_serverListIcon.color} />
              <T {...tx(sSelfHost.serverListMain)} {...sSelfHost.serverListName} {...sSelfHost.serverListMainAdd_serverListName} {...(busy ? null : sSelfHost.serverListNameHover)}>{t("selfHost.settings.addServer")}</T>
            </Press>
          </row>
        ) : null}
      </col>
      <Dialog open={pending !== null} onOpenChange={(open) => {
          if (!open && !busy) setPending(null);
        }}>
        <DialogContent fit {...sSettings.settingsConfirmDialog}>
          <DialogHeader>
            <DialogTitle>
              {pending
                ? t(
                    pending.kind === "switch"
                      ? "selfHost.settings.switchTitle"
                      : "selfHost.settings.removeTitle",
                    { name: nameOf(pending.entry) },
                  )
                : null}
            </DialogTitle>
          </DialogHeader>
          <DialogDescription {...sSettings.settingsConfirmDescription}>
            {pending?.kind === "remove"
              ? t("selfHost.settings.removeBody")
              : t("selfHost.settings.switchBody")}
          </DialogDescription>
          <row {...sSettings.settingsConfirmActions}>
            <Button variant="ghost" size="large" className="pill-btn pill-btn--lg" onClick={() => setPending(null)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" size="large" data-tone={pending?.kind === "remove" ? "destructive" : undefined} className={
                pending?.kind === "remove"
                  ? "pill-btn pill-btn--danger pill-btn--lg"
                  : "pill-btn pill-btn--lg"
              } onClick={() => void confirm()} disabled={busy}>
              {busy && pending?.kind === "switch"
                ? t("selfHost.settings.switching")
                : pending?.kind === "remove"
                  ? t("selfHost.settings.removeButton")
                  : t("selfHost.settings.switchButton")}
            </Button>
          </row>
        </DialogContent>
      </Dialog>
    </SettingsCard>
  );
}
