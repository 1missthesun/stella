import { SettingsCardTitle } from "@/global/settings/settings-card-targets";
import { useCallback, useEffect, useState } from "react";
import type { DesktopServerEntry } from "@stella/contracts/desktop/self-host";
import { Button } from "@/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/ui/dialog";
import { Check, CloudIcon, Monitor, Plus, Trash2 } from "@/ui/icons";
import { useT } from "@/shared/i18n";
import { showToast } from "@/ui/toast";
import { selfHostDialogs, useDesktopServerState } from "./self-host-store";
import "./self-host.css";

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
    <div className="settings-card" data-testid="self-host-server-card">
      <div className="settings-card-header">
        <SettingsCardTitle titleKey="selfHost.settings.title" />
        {state.selfHosted ? (
          <Button
            type="button"
            variant="ghost"
            className="pill-btn"
            onClick={() => selfHostDialogs.openDevice()}
          >
            {t("selfHost.settings.connectDevice")}
          </Button>
        ) : null}
      </div>
      <div className="server-list" role="list">
        {list.map((entry) => {
          const ServerIcon = entry.kind === "hosted" ? CloudIcon : Monitor;
          return (
            <div
              key={entry.id}
              role="listitem"
              className="server-list__row"
              data-active={entry.active || undefined}
            >
              <button
                type="button"
                className="server-list__main"
                data-testid={`server-row-${entry.id}`}
                aria-current={entry.active ? "true" : undefined}
                disabled={busy || entry.active || !state.canSwitch}
                onClick={() => setPending({ kind: "switch", entry })}
              >
                <ServerIcon size={18} className="server-list__icon" />
                <span className="server-list__copy">
                  <span className="server-list__name">{nameOf(entry)}</span>
                  <span className="server-list__host">
                    {entry.kind === "hosted"
                      ? t("selfHost.settings.hostedSub")
                      : t("selfHost.settings.selfHostedSub", { host: hostOf(entry.origin) })}
                  </span>
                </span>
                {entry.active ? <Check size={16} className="server-list__check" /> : null}
              </button>
              {entry.kind === "self-hosted" && !entry.active && state.canSwitch ? (
                <button
                  type="button"
                  className="server-list__remove"
                  aria-label={t("selfHost.settings.removeA11y", { name: nameOf(entry) })}
                  title={t("selfHost.settings.removeA11y", { name: nameOf(entry) })}
                  disabled={busy}
                  onClick={() => setPending({ kind: "remove", entry })}
                >
                  <Trash2 size={16} />
                </button>
              ) : null}
            </div>
          );
        })}
        {state.canSwitch ? (
          <div role="listitem" className="server-list__row">
            <button
              type="button"
              className="server-list__main server-list__main--add"
              data-testid="server-add"
              disabled={busy}
              onClick={() => selfHostDialogs.openConnect()}
            >
              <Plus size={18} className="server-list__icon" />
              <span className="server-list__name">{t("selfHost.settings.addServer")}</span>
            </button>
          </div>
        ) : null}
      </div>
      <Dialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setPending(null);
        }}
      >
        <DialogContent fit className="settings-confirm-dialog" aria-describedby={undefined}>
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
          <DialogDescription className="settings-confirm-description">
            {pending?.kind === "remove"
              ? t("selfHost.settings.removeBody")
              : t("selfHost.settings.switchBody")}
          </DialogDescription>
          <div className="settings-confirm-actions">
            <Button
              type="button"
              variant="ghost"
              size="large"
              className="pill-btn pill-btn--lg"
              onClick={() => setPending(null)}
              disabled={busy}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              variant="primary"
              size="large"
              data-tone={pending?.kind === "remove" ? "destructive" : undefined}
              className={
                pending?.kind === "remove"
                  ? "pill-btn pill-btn--danger pill-btn--lg"
                  : "pill-btn pill-btn--lg"
              }
              onClick={() => void confirm()}
              disabled={busy}
            >
              {busy && pending?.kind === "switch"
                ? t("selfHost.settings.switching")
                : pending?.kind === "remove"
                  ? t("selfHost.settings.removeButton")
                  : t("selfHost.settings.switchButton")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
