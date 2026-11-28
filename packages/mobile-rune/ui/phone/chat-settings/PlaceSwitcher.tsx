import { useState, useSyncExternalStore } from "react";
import type { P2pComputer, P2pPeers } from "@stella/contracts/p2p";
import { useT } from "@/shared/i18n";
import { Icon } from "../../../../desktop-rune/ui/kit";
import { phoneP2p } from "../../../js/p2p";
import { computerMode, useComputerMode } from "../../computer/computer-mode";
import { connectComputer } from "../../computer/ConnectComputer";
import { phoneAlert } from "../ask";
import { glyph } from "../icons";
import { phoneNav } from "../nav";
import { useRn } from "../rn";
import { errorText, openMenu, Switcher, tapLight, type MenuChoice } from "./kit";

// packages/mobile's chat-settings/PlaceSwitcher: "Where Stella works", the phone's own Stella in
// the cloud or a computer it paired to (computer mode, over the device link). It lists only the
// computers already paired, read from the link's store without starting it, so opening the drawer
// never starts local-network discovery; pairing another one is the explicit last choice.

const NO_PEERS: P2pPeers = { devices: [], computers: [] };
const usePairedComputers = () => useSyncExternalStore(phoneP2p.subscribe, phoneP2p.peers, () => NO_PEERS).computers;

const gone = (computer: P2pComputer) => computer.link.state === "revoked" || computer.link.state === "not_paired";

export function PlaceSwitcher() {
  const c = useRn();
  const t = useT();
  const computers = usePairedComputers();
  const using = useComputerMode();
  const [busy, setBusy] = useState<string | null>(null);

  const unnamed = (id: string) => t("mobile.settings.paired.unnamedComputer", { id: id.slice(0, 4).toUpperCase() });
  const labelFor = (computer: P2pComputer) => computer.name.replace(/\.local$/i, "") || unnamed(computer.id);
  const statusFor = (computer: P2pComputer) => {
    if (busy === computer.id) return t("mobile.settings.computer.connecting");
    switch (computer.link.state) {
      case "online":
        return t("mobile.settings.computer.statusOnline");
      case "offline":
        return t("mobile.settings.computer.statusOffline");
      case "revoked":
      case "not_paired":
        return t("devices.status.unpaired");
      default:
        return t("mobile.settings.computer.connecting");
    }
  };

  const selected = using ? computers.find((computer) => computer.id === using) : undefined;
  const cloudLabel = t("mobile.settings.computer.cloud");

  const run = (id: string, work: () => Promise<void>) => {
    tapLight();
    setBusy(id);
    void work()
      .catch((error: unknown) => phoneAlert(t("mobile.settings.computer.connectFailedTitle"), errorText(error), "OK"))
      .finally(() => setBusy(null));
  };

  const chooseCloud = () => {
    if (!using) return;
    run("cloud", () => computerMode.leave());
  };

  const pick = (computer: P2pComputer) => {
    if (computer.id === using) return;
    if (gone(computer)) {
      void phoneAlert(labelFor(computer), statusFor(computer), t("mobile.common.done"));
      return;
    }
    run(computer.id, () => computerMode.enter(computer, null));
  };

  const choices: MenuChoice[] = [
    { id: "cloud", label: cloudLabel, selected: !using, run: chooseCloud },
    ...computers.map((computer): MenuChoice => ({
      id: computer.id,
      label: computer.link.state === "online" ? labelFor(computer) : `${labelFor(computer)} · ${statusFor(computer)}`,
      selected: selected?.id === computer.id,
      run: () => pick(computer),
    })),
    {
      id: "pair",
      label: t("mobile.p2p.entry"),
      run: () => {
        phoneNav.closeDrawer();
        connectComputer.open();
      },
    },
  ];

  const title = selected ? labelFor(selected) : using ? unnamed(using) : cloudLabel;
  const detail = selected ? statusFor(selected) : using ? t("mobile.settings.computer.connecting") : undefined;
  return (
    <Switcher
      id="phone-chat-settings-place"
      mark={<Icon icon={glyph(using ? "laptop" : "cloud")} size={24} color={c.text} />}
      title={title}
      detail={detail}
      detailTone={!using ? "muted" : selected?.link.state === "online" ? "ok" : "warning"}
      busy={busy !== null}
      label={`${t("mobile.settings.computer.sectionLabel")}: ${title}`}
      onPress={() => void openMenu(choices, t("mobile.common.cancel"))}
    />
  );
}
