import { SettingsCard, SettingsCardHeader, SettingsRow } from "../../settings/parts";
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Monitor, MoreHorizontal, Plus, Press, Smartphone, Switch, T, tx } from "../../kit/compat";
import { DropdownMenu, MenuItem } from "../../kit";
import { useSelfHost } from "../self-host/self-host.styles";
import { useSettings } from "../../settings/settings.styles";
import { SettingsCardTitle } from "../../settings/settings-card-targets";
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { P2pComputer, P2pDevice } from "@stella/contracts/p2p";
import { useLocale, useT } from "@/shared/i18n";
import { settingsDialog } from "@/shell/settings-dialog-store";
import { useChatStorageMode } from "@/features/chat/services/chat-storage-preference";
import { EnterCodeDialog } from "./EnterCodeDialog";
import { PairDeviceDialog } from "./PairDeviceDialog";
import { isPhone, p2p, useDevices, useLocalNetwork } from "./use-devices";

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

const ago = (at: number, locale: string) => {
  const elapsed = Date.now() - at;
  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const [unit, ms] of UNITS) if (elapsed >= ms) return format.format(-Math.floor(elapsed / ms), unit);
  return format.format(0, "minute");
};

type Pending = { kind: "unpair"; device: P2pDevice } | { kind: "forget"; computer: P2pComputer };

/** Phones and computers connected to this one directly, and the computers this one uses. */
export function DevicesCard() {
  const s = useSelfHost();
  const sSettings = useSettings();
  const t = useT();
  const locale = useLocale();
  const navigate = useNavigate();
  const storage = useChatStorageMode();
  const { devices, computers } = useDevices();
  const localNetwork = useLocalNetwork();
  const [dialog, setDialog] = useState<"pair" | "enter" | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);

  if (!p2p()) return null;

  const openChat = (conversationId: string | null) => {
    if (!conversationId) return;
    settingsDialog.close();
    void navigate({ to: "/chat" as never, search: { c: conversationId } as never });
  };

  const openComputer = async (computer: P2pComputer) => openChat(await p2p()!.conversationFor(computer.id));

  const deviceStatus = (device: P2pDevice) =>
    device.connected
      ? t("devices.status.connected")
      : device.lastSeenAt
        ? t("devices.status.lastSeen", { time: ago(device.lastSeenAt, locale) })
        : t("devices.status.notYet");

  const computerStatus = (computer: P2pComputer) => {
    switch (computer.link.state) {
      case "online":
        return computer.link.path?.kind === "relay" ? t("devices.status.onlineRelay") : t("devices.status.online");
      case "offline":
        return t("devices.status.offline");
      case "revoked":
      case "not_paired":
        return t("devices.status.unpaired");
      default:
        return t("devices.status.connecting");
    }
  };

  const confirm = async () => {
    if (!pending) return;
    const api = p2p()!;
    setBusy(true);
    try {
      if (pending.kind === "unpair") await api.revokeDevice(pending.device.id);
      else await api.forgetComputer(pending.computer.id);
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const more = (id: string, name: string, item: { label: string; onSelect: () => void }) => (
    <DropdownMenu
      id={`devices-more:${id}`}
      open={menu === id}
      onOpenChange={(open) => setMenu(open ? id : null)}
      align="end"
      trigger={(trigger) => (
        <Press id={trigger.id} {...s.serverListRemove} label={t("devices.more", { name })} title={t("devices.more", { name })} onPress={trigger.toggle}>
          <MoreHorizontal size={16} color={s.serverListRemove.color} />
        </Press>
      )}
    >
      <MenuItem onSelect={item.onSelect}>{item.label}</MenuItem>
    </DropdownMenu>
  );

  return (
    <SettingsCard>
      <SettingsCardHeader>
        <SettingsCardTitle titleKey="devices.title" />
        <Button variant="ghost" className="pill-btn" onClick={() => setDialog("pair")}>
          {t("selfHost.device.title")}
        </Button>
      </SettingsCardHeader>
      <col role="list">
        {devices.map((device) => {
          const Icon = isPhone(device.platform) ? Smartphone : Monitor;
          return (
            <row {...s.serverListRow} key={device.id} role="listitem">
              <row {...s.serverListMain} {...s.serverListMainDisabled}>
                <Icon size={18} {...s.serverListIcon} />
                <col {...s.serverListCopy}>
                  <T {...s.serverListName}>{device.name}</T>
                  <T {...s.serverListHost}>{deviceStatus(device)}</T>
                </col>
              </row>
              {more(device.id, device.name, { label: t("devices.unpair"), onSelect: () => setPending({ kind: "unpair", device }) })}
            </row>
          );
        })}
        {computers.map((computer) => {
          const Icon = isPhone(computer.platform) ? Smartphone : Monitor;
          const canOpen = storage === "local" && computer.link.state !== "revoked" && computer.link.state !== "not_paired";
          return (
            <row {...s.serverListRow} key={computer.id} role="listitem">
              <Press {...s.serverListMain} disabled={!canOpen} onPress={() => void openComputer(computer)} {...(canOpen ? null : s.serverListMainDisabled)}>
                <Icon size={18} {...s.serverListIcon} />
                <col {...s.serverListCopy}>
                  <T {...tx(s.serverListMain)} {...s.serverListName} {...(canOpen ? s.serverListNameHover : null)}>
                    {t("devices.computerChat", { name: computer.name })}
                  </T>
                  <T {...tx(s.serverListMain)} {...s.serverListHost}>{computerStatus(computer)}</T>
                </col>
              </Press>
              {more(computer.id, computer.name, { label: t("devices.forget"), onSelect: () => setPending({ kind: "forget", computer }) })}
            </row>
          );
        })}
        <row {...s.serverListRow} role="listitem">
          <Press {...s.serverListMain} {...s.serverListMainAdd} onPress={() => setDialog("enter")}>
            <Plus size={18} {...s.serverListIcon} {...s.serverListMainAdd_serverListIcon} color={s.serverListMainAdd_serverListIcon.color} />
            <T {...tx(s.serverListMain)} {...s.serverListName} {...s.serverListMainAdd_serverListName} {...s.serverListNameHover}>
              {t("devices.enter.title")}
            </T>
          </Press>
        </row>
      </col>
      <SettingsRow>
        <col {...sSettings.settingsRowInfo}>
          <T w="full" {...sSettings.settingsRowLabel}>
            {t("devices.local.label")}
          </T>
          <T w="full" {...sSettings.settingsRowSublabel}>
            {t("devices.local.description")}
          </T>
        </col>
        <row {...sSettings.settingsRowControl}>
          <Switch checked={localNetwork} onCheckedChange={(on: boolean) => void p2p()!.setLocalNetwork(on)} aria-label={t("devices.local.label")} hideLabel />
        </row>
      </SettingsRow>

      {dialog === "pair" ? <PairDeviceDialog onClose={() => setDialog(null)} /> : null}
      {dialog === "enter" ? (
        <EnterCodeDialog
          onClose={() => setDialog(null)}
          onPaired={(conversationId) => {
            setDialog(null);
            if (storage === "local") openChat(conversationId);
          }}
        />
      ) : null}

      <Dialog open={pending !== null} onOpenChange={(open) => {
          if (!open && !busy) setPending(null);
        }}>
        <DialogContent fit {...sSettings.settingsConfirmDialog}>
          <DialogHeader {...sSettings.settingsConfirmDialog_dialogHeader}>
            <DialogTitle>
              {pending?.kind === "unpair"
                ? t("devices.unpairTitle", { name: pending.device.name })
                : pending?.kind === "forget"
                  ? t("devices.forgetTitle", { name: pending.computer.name })
                  : null}
            </DialogTitle>
          </DialogHeader>
          <DialogDescription>{pending?.kind === "unpair" ? t("devices.unpairBody") : t("devices.forgetBody")}</DialogDescription>
          <row {...sSettings.settingsConfirmActions}>
            <Button variant="ghost" size="large" className="pill-btn pill-btn--lg" onClick={() => setPending(null)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" size="large" data-tone="destructive" className="pill-btn pill-btn--danger pill-btn--lg" onClick={() => void confirm()} disabled={busy}>
              {pending?.kind === "unpair" ? t("devices.unpair") : t("devices.forget")}
            </Button>
          </row>
        </DialogContent>
      </Dialog>
    </SettingsCard>
  );
}
