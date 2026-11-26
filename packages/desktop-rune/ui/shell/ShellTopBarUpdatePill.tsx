import { memo, useEffect, useMemo, useState } from "react";
import { currentDeviceDestinations } from "@stella/contracts/turn-plane/placement";
import { friendlyDeviceName } from "@stella/contracts/device-files";
import { useT } from "@/shared/i18n";
import { useBackendValue } from "@/platform/backend/use-backend-view";
import { getDeviceIdOrNull } from "@/platform/electron/device-id";
import { appSourceApi, useAppSourceState, useAutoUpdate, versionOffer } from "@/features/app-source/app-source-store";
import { addOffer, deviceLabel, useAppSourceAction } from "@/features/app-source/AppSourceCards";
import { DropdownMenu, Icons, MenuCheckboxItem, MenuItem, MenuSeparator } from "../kit";
import { derive, fontSize, look, mixOklch, useTokens } from "../theme";
import { GroupIcon } from "./topbar/chrome";

type OtherComputer = { id: string; name: string; online: boolean };

const useThisDeviceId = () => {
  const [id, setId] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void getDeviceIdOrNull().then((value) => {
      if (live) setId(value);
    });
    return () => {
      live = false;
    };
  }, []);
  return id;
};

const useOtherComputers = (enabled: boolean): OtherComputer[] => {
  const self = useThisDeviceId();
  const list = useBackendValue("devices.list", enabled && self ? {} : "skip");
  return useMemo(
    () =>
      currentDeviceDestinations(list?.devices ?? [])
        .filter((device) => device.deviceId !== self)
        .map((device) => ({ id: device.deviceId, name: deviceLabel(friendlyDeviceName(device.label)), online: device.online })),
    [list, self],
  );
};

/** `.app button` inherits weight and letter-spacing over the pill's semibold, so the label is 400 with the body's -0.15px. */
const LABEL = look(fontSize["2xs"], 400, { lh: 1, em: -0.15 / fontSize["2xs"] });

function pillLook(t: ReturnType<typeof useTokens>) {
  return derive(t, "update-pill", (t) => ({
    readyFill: mixOklch(t.c.primary, 12, "transparent"),
    readyBorder: mixOklch(t.c.primary, 36, "transparent"),
    hoverFill: mixOklch(t.c.foreground, 10, "transparent"),
    hoverBorder: mixOklch(t.c.foreground, 16, "transparent"),
    split: mixOklch(t.c.primary, 26, "transparent"),
    moreHover: mixOklch(t.c.primary, 10, "transparent"),
  }));
}

const UpdateMenu = ({ computers, disabled, onUpdate }: { computers: OtherComputer[]; disabled: boolean; onUpdate: (targets: string[]) => void }) => {
  const t = useT();
  const tk = useTokens();
  const l = pillLook(tk);
  const auto = useAutoUpdate();
  const [open, setOpen] = useState(false);
  const [left, setLeft] = useState<ReadonlySet<string>>(() => new Set());
  const chosen = computers.filter((computer) => !left.has(computer.id));
  const toggle = (id: string) =>
    setLeft((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <DropdownMenu
      id="topbar-update-targets"
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setLeft(new Set());
      }}
      align="end"
      minW={220}
      trigger={(trigger) => (
        <box
          id={trigger.id}
          role="button"
          label={t("shell.appSource.updateOptions")}
          title={t("shell.appSource.updateOptions")}
          focusable
          w={20}
          h="full"
          pl={2}
          pr={4}
          center
          borderSides={[0, 0, 0, 1]}
          border={l.split}
          fill={open ? l.moreHover : undefined}
          hover={l.moreHover}
          opacity={open ? 1 : 0.72}
          motion={{ dur: 0.12 }}
          onPress={trigger.toggle}
        >
          <GroupIcon icon={Icons.stella.ChevronDown} size={11} strokeWidth={2.2} color={tk.c.textStrong} />
        </box>
      )}
    >
      {computers.length > 0 ? (
        <>
          <MenuCheckboxItem checked disabled onCheckedChange={() => {}}>
            {t("shell.appSource.devices.thisComputer")}
          </MenuCheckboxItem>
          {computers.map((computer) => (
            <MenuCheckboxItem key={computer.id} id={`topbar-update-target-${computer.id}`} keepOpen disabled={disabled} checked={!left.has(computer.id)} onCheckedChange={() => toggle(computer.id)}>
              <col minW={0} gap={1}>
                <text {...look(fontSize.base, 500, { lh: 1.3 })} color={tk.c.textBase} truncate>{computer.name}</text>
                {computer.online ? null : <text {...look(fontSize["2xs"], 400)} color={tk.c.textWeak}>{t("shell.appSource.devices.offline")}</text>}
              </col>
            </MenuCheckboxItem>
          ))}
          <MenuSeparator />
          <MenuItem id="topbar-update-targets-go" centered strong disabled={disabled} onSelect={() => onUpdate(chosen.map((computer) => computer.id))}>
            {chosen.length === 0 ? t("shell.appSource.devices.updateThisOnly") : t("shell.appSource.update")}
          </MenuItem>
          <MenuSeparator />
        </>
      ) : null}
      <MenuCheckboxItem id="topbar-auto-update" keepOpen checked={auto.on} onCheckedChange={(checked) => auto.set(checked)}>
        {t("shell.appSource.autoUpdate.label")}
      </MenuCheckboxItem>
    </DropdownMenu>
  );
};

/** desktop-ui's `ShellTopBarUpdatePill`: Update, or what holds it, with a menu of other computers to update too and the automatic-update switch. */
export const ShellTopBarUpdatePill = memo(function ShellTopBarUpdatePill() {
  const t = useT();
  const tk = useTokens();
  const l = pillLook(tk);
  const state = useAppSourceState();
  const { pending, run } = useAppSourceAction();
  const offer = state ? versionOffer(state) : null;
  const computers = useOtherComputers(offer !== null && !offer.draft);
  if (!state || !offer) return null;
  const updating = offer.adding || pending === offer.key || state.merging !== undefined;
  const label = updating
    ? state.heldForRecording
      ? t("shell.appSource.afterRecording")
      : state.heldForReply
        ? t("shell.appSource.afterReply")
        : t("shell.appSource.updating")
    : t("shell.appSource.update");
  const blocked = updating || state.busy || pending !== null;
  const menu = appSourceApi() !== null;
  const choose = menu && !updating && !offer.draft && computers.length > 0;

  return (
    <row
      id="shell-topbar-update-pill"
      h={22}
      align="stretch"
      radius={999}
      clip={999}
      fill={l.readyFill}
      border={l.readyBorder}
      hoverFill={updating ? undefined : l.hoverFill}
      hoverBorder={updating ? undefined : l.hoverBorder}
      opacity={updating ? 0.7 : 1}
      noWindowDrag
      motion={{ dur: 0.12 }}
    >
      <row
        id="topbar-update-pill"
        role="button"
        label={label}
        title={choose ? t("shell.appSource.devices.updateAll") : t("shell.appSource.updateAvailable")}
        disabled={blocked}
        focusable={!blocked}
        h="full"
        pl={13}
        pr={menu ? 9 : 16}
        gap={6}
        align="center"
        focusRing={{ width: 2, offset: 0, color: tk.c.ring, radius: 999 }}
        onPress={blocked ? undefined : () => void run(offer.key, () => addOffer(offer))}
      >
        <GroupIcon icon={Icons.stella.Download} size={12} strokeWidth={2} color={tk.c.textStrong} opacity={0.88} />
        <text {...LABEL} nowrap color={tk.c.textStrong}>{label}</text>
      </row>
      {menu ? <UpdateMenu computers={choose ? computers : []} disabled={blocked} onUpdate={(targets) => void run(offer.key, () => addOffer(offer, targets))} /> : null}
    </row>
  );
});
