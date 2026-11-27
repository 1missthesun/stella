// The phone's stand-in for desktop-rune/ui/global/devices/DevicesCard.tsx. A phone is only ever a
// device: it lists the computers it paired to (each one opens that computer's chat) and pairs to
// another one; it shows no code of its own.
import { SettingsCard, SettingsCardHeader } from "../../../../../../desktop-rune/ui/settings/parts";
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, Monitor, MoreHorizontal, Plus, Press, T, tx } from "../../../../../../desktop-rune/ui/kit/compat";
import { DropdownMenu, MenuItem } from "../../../../../../desktop-rune/ui/kit";
import { useSelfHost } from "../../../../../../desktop-rune/ui/global/self-host/self-host.styles";
import { useSettings } from "../../../../../../desktop-rune/ui/settings/settings.styles";
import { SettingsCardTitle } from "../../../../../../desktop-rune/ui/settings/settings-card-targets";
import { useState } from "react";
import type { P2pComputer } from "@stella/contracts/p2p";
import { useT } from "@/shared/i18n";
import { connectComputer } from "../../../../../ui/computer/ConnectComputer";
import { computerMode } from "../../../../../ui/computer/computer-mode";
import { phoneNav } from "../../../../../ui/phone/nav";
import { useDevices } from "./use-devices";
import { phoneP2p } from "../../../../p2p";

export function DevicesCard() {
  const s = useSelfHost();
  const sSettings = useSettings();
  const t = useT();
  const { computers } = useDevices();
  const [menu, setMenu] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState<P2pComputer | null>(null);
  const [busy, setBusy] = useState(false);

  const status = (computer: P2pComputer) => {
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

  const open = (computer: P2pComputer) => {
    phoneNav.closeDrawer();
    void computerMode.enter(computer, null);
  };

  const forget = async () => {
    if (!forgetting) return;
    setBusy(true);
    try {
      if (computerMode.current() === forgetting.id) await computerMode.leave();
      await phoneP2p.forgetComputer(forgetting.id);
    } finally {
      setBusy(false);
      setForgetting(null);
    }
  };

  return (
    <SettingsCard>
      <SettingsCardHeader>
        <SettingsCardTitle titleKey="devices.title" />
      </SettingsCardHeader>
      <col role="list">
        {computers.map((computer) => {
          const canOpen = computer.link.state !== "revoked" && computer.link.state !== "not_paired";
          return (
            <row {...s.serverListRow} key={computer.id} role="listitem">
              <Press {...s.serverListMain} disabled={!canOpen} onPress={() => open(computer)} {...(canOpen ? null : s.serverListMainDisabled)}>
                <Monitor size={18} {...s.serverListIcon} />
                <col {...s.serverListCopy}>
                  <T {...tx(s.serverListMain)} {...s.serverListName}>
                    {t("devices.computerChat", { name: computer.name })}
                  </T>
                  <T {...tx(s.serverListMain)} {...s.serverListHost}>{status(computer)}</T>
                </col>
              </Press>
              <DropdownMenu
                id={`devices-more:${computer.id}`}
                open={menu === computer.id}
                onOpenChange={(open) => setMenu(open ? computer.id : null)}
                align="end"
                trigger={(trigger) => (
                  <Press id={trigger.id} {...s.serverListRemove} label={t("devices.more", { name: computer.name })} onPress={trigger.toggle}>
                    <MoreHorizontal size={16} color={s.serverListRemove.color} />
                  </Press>
                )}
              >
                <MenuItem onSelect={() => setForgetting(computer)}>{t("devices.forget")}</MenuItem>
              </DropdownMenu>
            </row>
          );
        })}
        <row {...s.serverListRow} role="listitem">
          <Press
            {...s.serverListMain}
            {...s.serverListMainAdd}
            onPress={() => {
              phoneNav.closeDrawer();
              connectComputer.open();
            }}
          >
            <Plus size={18} {...s.serverListIcon} {...s.serverListMainAdd_serverListIcon} color={s.serverListMainAdd_serverListIcon.color} />
            <T {...tx(s.serverListMain)} {...s.serverListName} {...s.serverListMainAdd_serverListName}>
              {t("mobile.p2p.entry")}
            </T>
          </Press>
        </row>
      </col>

      <Dialog
        open={forgetting !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setForgetting(null);
        }}
      >
        <DialogContent fit {...sSettings.settingsConfirmDialog}>
          <DialogHeader {...sSettings.settingsConfirmDialog_dialogHeader}>
            <DialogTitle>{forgetting ? t("devices.forgetTitle", { name: forgetting.name }) : null}</DialogTitle>
          </DialogHeader>
          <DialogDescription>{t("devices.forgetBody")}</DialogDescription>
          <row {...sSettings.settingsConfirmActions}>
            <Button variant="ghost" size="large" className="pill-btn pill-btn--lg" onClick={() => setForgetting(null)} disabled={busy}>
              {t("common.cancel")}
            </Button>
            <Button variant="primary" size="large" data-tone="destructive" className="pill-btn pill-btn--danger pill-btn--lg" onClick={() => void forget()} disabled={busy}>
              {t("devices.forget")}
            </Button>
          </row>
        </DialogContent>
      </Dialog>
    </SettingsCard>
  );
}
