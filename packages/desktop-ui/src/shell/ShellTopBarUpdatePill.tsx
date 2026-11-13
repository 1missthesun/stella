import { memo, useEffect, useMemo, useState } from "react";
import { currentDeviceDestinations } from "@stella/contracts/turn-plane/placement";
import { friendlyDeviceName } from "@stella/contracts/device-files";
import { ChevronDown, Download } from "@/ui/icons";
import { useT, useTPlural } from "@/shared/i18n";
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

/** The account's other computers; empty with one computer, so nothing extra shows. */
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

/**
 * A small chevron beside Update: Update goes to every computer by default;
 * this narrows it to some of them, or to this one only.
 */
const UpdateTargets = ({
  computers,
  disabled,
  onUpdate,
}: {
  computers: OtherComputer[];
  disabled: boolean;
  onUpdate: (targets: string[]) => void;
}) => {
  const t = useT();
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
          disabled={disabled}
          aria-label={t("shell.appSource.devices.choose")}
          title={t("shell.appSource.devices.choose")}
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
        <DropdownMenuCheckboxItem checked disabled>
          {t("shell.appSource.devices.thisComputer")}
        </DropdownMenuCheckboxItem>
        {computers.map((computer) => (
          <DropdownMenuCheckboxItem
            key={computer.id}
            checked={!left.has(computer.id)}
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
          onSelect={() => onUpdate(chosen.map((computer) => computer.id))}
          data-testid="topbar-update-targets-go"
        >
          {chosen.length === 0
            ? t("shell.appSource.devices.updateThisOnly")
            : t("shell.appSource.update")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

export const ShellTopBarUpdatePill = memo(function ShellTopBarUpdatePill() {
  const t = useT();
  const tPlural = useTPlural();
  const state = useAppSourceState();
  const { pending, run } = useAppSourceAction();
  const offer = state ? versionOffer(state) : null;
  const computers = useOtherComputers(offer !== null && !offer.draft);
  if (!state || !offer) return null;
  const updating =
    offer.adding ||
    pending === offer.key ||
    state.merging !== undefined;
  const tasks = state.heldForTasks ?? 0;
  const label = updating
    ? state.heldForRecording
      ? t("shell.appSource.afterRecording")
      : tasks > 0
        ? tPlural("shell.appSource.afterTasks", tasks)
        : state.heldForReply
          ? t("shell.appSource.afterReply")
          : t("shell.appSource.updating")
    : t("shell.appSource.update");
  const blocked = updating || state.busy || pending !== null;
  const choose = !updating && !offer.draft && computers.length > 0 && appSourceApi() !== null;
  // Waiting for Stella's reply or the tasks running here: the user may go ahead anyway.
  const updateNow = appSourceApi()?.updateNow;
  const held = updating && !state.heldForRecording && (tasks > 0 || state.heldForReply === true) && typeof updateNow === "function";

  return (
    <div
      className="shell-topbar-update-pill"
      data-state={held ? "held" : updating ? "updating" : "ready"}
      data-update-transition={updating ? "live" : undefined}
      data-split={choose || held ? "" : undefined}
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
      {held ? (
        <button
          type="button"
          className="shell-topbar-update-pill__now"
          onClick={() => void updateNow?.()}
          title={t("shell.appSource.updateNowHint")}
          data-testid="topbar-update-now"
        >
          {t("shell.appSource.updateNow")}
        </button>
      ) : null}
      {choose ? (
        <UpdateTargets
          computers={computers}
          disabled={blocked}
          onUpdate={(targets) => void run(offer.key, () => addOffer(offer, targets))}
        />
      ) : null}
    </div>
  );
});
