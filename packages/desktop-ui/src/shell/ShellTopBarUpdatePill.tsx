import { memo, useEffect, useMemo, useState } from "react";
import { currentDeviceDestinations } from "@stella/contracts/turn-plane/placement";
import { friendlyDeviceName } from "@stella/contracts/device-files";
import { ChevronDown, Download } from "@/ui/icons";
import { useT } from "@/shared/i18n";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown-menu";
import { useBackendValue } from "@/platform/backend/use-backend-view";
import { getDeviceIdOrNull } from "@/platform/electron/device-id";
import {
  appSourceApi,
  useAppSourceState,
  useAutoUpdate,
  versionOffer,
} from "@/features/app-source/app-source-store";
import {
  addOffer,
  deviceLabel,
  useAppSourceAction,
} from "@/features/app-source/AppSourceCards";
import "./shell-topbar-update-pill.css";

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
        .map((device) => ({
          id: device.deviceId,
          name: deviceLabel(friendlyDeviceName(device.label)),
          online: device.online,
        })),
    [list, self],
  );
};

const UpdateMenu = ({
  computers,
  disabled,
  onUpdate,
}: {
  computers: OtherComputer[];
  disabled: boolean;
  onUpdate: (targets: string[]) => void;
}) => {
  const t = useT();
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
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setLeft(new Set());
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="shell-topbar-update-pill__more"
          aria-label={t("shell.appSource.updateOptions")}
          title={t("shell.appSource.updateOptions")}
          data-testid="topbar-update-targets"
        >
          <ChevronDown size={11} strokeWidth={2.2} aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="shell-topbar-update-targets"
        data-testid="topbar-update-targets-menu"
      >
        {computers.length > 0 ? (
          <>
            <DropdownMenuCheckboxItem checked disabled>
              {t("shell.appSource.devices.thisComputer")}
            </DropdownMenuCheckboxItem>
            {computers.map((computer) => (
              <DropdownMenuCheckboxItem
                key={computer.id}
                checked={!left.has(computer.id)}
                disabled={disabled}
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={() => toggle(computer.id)}
                data-testid="topbar-update-target"
              >
                <span className="shell-topbar-update-targets__name">
                  <span className="shell-topbar-update-targets__label">{computer.name}</span>
                  {computer.online ? null : (
                    <span className="shell-topbar-update-targets__hint">
                      {t("shell.appSource.devices.offline")}
                    </span>
                  )}
                </span>
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="shell-topbar-update-targets__go"
              disabled={disabled}
              onSelect={() => onUpdate(chosen.map((computer) => computer.id))}
              data-testid="topbar-update-targets-go"
            >
              {chosen.length === 0
                ? t("shell.appSource.devices.updateThisOnly")
                : t("shell.appSource.update")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuCheckboxItem
          checked={auto.on}
          onSelect={(event) => event.preventDefault()}
          onCheckedChange={(checked) => auto.set(checked === true)}
          data-testid="topbar-auto-update"
        >
          {t("shell.appSource.autoUpdate.label")}
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export const ShellTopBarUpdatePill = memo(function ShellTopBarUpdatePill() {
  const t = useT();
  const state = useAppSourceState();
  const { pending, run } = useAppSourceAction();
  const offer = state ? versionOffer(state) : null;
  const computers = useOtherComputers(offer !== null && !offer.draft);
  if (!state || !offer) return null;
  const updating =
    offer.adding ||
    pending === offer.key ||
    state.merging !== undefined;
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
    <div
      className="shell-topbar-update-pill"
      data-state={updating ? "updating" : "ready"}
      data-update-transition={updating ? "live" : undefined}
      data-split={menu ? "" : undefined}
    >
      <button
        type="button"
        className="shell-topbar-update-pill__main"
        onClick={() => void run(offer.key, () => addOffer(offer))}
        disabled={blocked}
        aria-label={label}
        title={
          choose
            ? t("shell.appSource.devices.updateAll")
            : t("shell.appSource.updateAvailable")
        }
        data-testid="topbar-update-pill"
      >
        <Download
          className="shell-topbar-update-pill__icon"
          size={12}
          strokeWidth={2}
          aria-hidden
        />
        <span className="shell-topbar-update-pill__label">{label}</span>
      </button>
      {menu ? (
        <UpdateMenu
          computers={choose ? computers : []}
          disabled={blocked}
          onUpdate={(targets) => void run(offer.key, () => addOffer(offer, targets))}
        />
      ) : null}
    </div>
  );
});
