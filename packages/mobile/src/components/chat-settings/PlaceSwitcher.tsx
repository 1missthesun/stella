import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, View, type AlertButton } from "react-native";
import { useIsFocused } from "expo-router";
import {
  listExecutionDevices,
  type AutomaticExecutionTarget,
  type ExecutionDeviceDestination,
} from "../../lib/execution-placement";
import { getBackendClient } from "../../lib/backend";
import { tapLight } from "../../lib/haptics";
import type { ComputerControl } from "../../lib/main-shell-store";
import {
  ensurePhoneAccess,
  listStoredPairedPhoneAccess,
  type StoredPhoneAccess,
} from "../../lib/phone-access";
import { userFacingError } from "../../lib/user-facing-error";
import { useT } from "../../i18n";
import { useColors } from "../../theme/theme-context";
import { Icon } from "../Icon";
import { NativeMenu } from "../NativeMenu";
import type { NativeMenuItem } from "../NativeMenu.types";
import {
  applyRemoteExecution,
  enableRemoteExecution,
} from "../settings/computer-actions";
import {
  buildComputerRows,
  type ComputerRow,
  type ComputerRowStatusKind,
} from "../settings/computer-rows";
import { ChoiceRow, KIT, SwitcherFace } from "./kit";

const STATUS_KEYS: Readonly<Record<ComputerRowStatusKind, string>> = {
  online: "mobile.settings.computer.statusOnline",
  notReady: "mobile.settings.computer.statusNotReady",
  notEnabled: "mobile.settings.computer.statusNotEnabled",
  awaitingConsent: "mobile.settings.computer.statusAwaitingConsent",
  declined: "mobile.settings.computer.statusDeclined",
  offline: "mobile.settings.computer.statusOffline",
};

/**
 * Where the chat's turns run, shown as the one place in use, large, with its
 * state underneath. A tap opens the system menu of every place (Cloud, then
 * each computer on the account) and picking one switches to it.
 *
 * The list is the account's device list rather than this phone's pairings, so
 * a computer the owner has never paired with this phone still appears. One
 * that can't take work right now is not a choice: picking it explains why and
 * offers Enable when that would help. Running work on a computer is consent,
 * and only the Enable tap here (or the prompt on that computer's own screen)
 * grants it. There is no pairing step: picking a computer attaches this phone
 * to it on the spot.
 */
export function PlaceSwitcher({
  control,
  signedIn,
  open,
  width,
}: {
  control: ComputerControl | null;
  signedIn: boolean;
  open: boolean;
  width: number;
}) {
  const colors = useColors();
  const t = useT();
  const [expanded, setExpanded] = useState(false);
  const focused = useIsFocused();
  const [destinations, setDestinations] = useState<
    ExecutionDeviceDestination[] | undefined
  >(undefined);
  const [pairedDesktops, setPairedDesktops] = useState<StoredPhoneAccess[]>([]);
  const [busy, setBusy] = useState<{
    deviceId: string;
    kind: "connecting" | "enabling";
  } | null>(null);

  const refreshPaired = useCallback(async () => {
    setPairedDesktops(await listStoredPairedPhoneAccess());
  }, []);
  const chatPaired = control?.pairedDesktops;
  useEffect(() => {
    void refreshPaired();
  }, [refreshPaired, chatPaired]);

  // Presence is pushed while the panel is open, and only ever a read:
  // nothing here may move a computer's consent, however often it runs. When
  // the view errors, the list is read once over HTTP; the live socket
  // resubscribes on its own, and its next push replaces that read.
  const canListDevices = control !== null || signedIn;
  const [refreshToken, setRefreshToken] = useState(0);
  useEffect(() => {
    if (!focused || !open || !canListDevices) return;
    let active = true;
    let pushed = false;
    let fallbackRead = false;
    const controller = new AbortController();
    const read = () => {
      void listExecutionDevices({ signal: controller.signal })
        .then((devices) => {
          if (active && !pushed) setDestinations(devices);
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          // A failed read keeps the last good list rather than painting an
          // outage nobody reported.
          console.warn(
            "[execution-devices] presence read failed; keeping the last good device list",
            error,
          );
        });
    };
    const stop = getBackendClient().watch(
      "devices.list",
      {},
      (value) => {
        if (!active) return;
        pushed = true;
        setDestinations(value.devices);
      },
      () => {
        if (!active || pushed || fallbackRead) return;
        fallbackRead = true;
        read();
      },
    );
    return () => {
      active = false;
      stop();
      controller.abort();
    };
  }, [focused, open, canListDevices, refreshToken]);

  // A paired computer missing from the owner's device list reads as offline
  // forever. The two id spaces can drift, so log each distinct miss once.
  const reportedJoinMissRef = useRef("");
  useEffect(() => {
    if (destinations === undefined) return;
    const present = new Set(destinations.map((device) => device.deviceId));
    const missing = pairedDesktops
      .map((access) => access.desktopDeviceId)
      .filter((id) => !present.has(id));
    const signature = missing.join(",");
    if (signature === reportedJoinMissRef.current) return;
    reportedJoinMissRef.current = signature;
    if (missing.length === 0) return;
    console.warn(
      "[execution-devices] paired computer absent from the owner's device list. " +
        `paired=[${missing.join(", ")}] returned=[${destinations
          .map((device) => device.deviceId)
          .join(", ")}]`,
    );
  }, [destinations, pairedDesktops]);

  const target = control?.executionTarget ?? { mode: "cloud" as const };
  const rows = buildComputerRows({
    devices: destinations,
    stored: pairedDesktops,
    activeDeviceId: control?.access?.desktopDeviceId ?? null,
  });
  const labelFor = (row: ComputerRow) =>
    row.label?.replace(/\.local$/i, "") ||
    t("mobile.settings.paired.unnamedComputer", {
      id: row.deviceId.slice(0, 4).toUpperCase(),
    });
  const statusTextFor = (row: ComputerRow) => {
    if (busy?.deviceId === row.deviceId) {
      if (busy.kind === "enabling")
        return t("mobile.settings.computer.enabling");
      if (busy.kind === "connecting") {
        return t("mobile.settings.computer.connecting");
      }
    }
    if (row.preferActiveStatusLabel && control) return control.statusLabel;
    return t(STATUS_KEYS[row.statusKind]);
  };
  // A computer that can't take work isn't a real choice, so Cloud carries
  // the check (and the turn) whenever the picked computer is unavailable.
  const selectedRow =
    target.mode === "device"
      ? rows.find((row) => row.deviceId === target.deviceId && row.available)
      : undefined;

  if (!control && !signedIn) return null;

  const choose = (next: AutomaticExecutionTarget) => {
    if (!control) return;
    tapLight();
    control.onExecutionTargetChange(next);
  };

  /**
   * Pick a computer, attaching this phone to it first when it holds no
   * credential for it. That is a transport credential and nothing else: an
   * unconsented computer is not selectable in the first place.
   */
  const selectComputer = (row: ComputerRow) => {
    if (!control) return;
    if (row.access) {
      choose({ mode: "device", deviceId: row.deviceId });
      return;
    }
    tapLight();
    setBusy({ deviceId: row.deviceId, kind: "connecting" });
    void ensurePhoneAccess(row.deviceId)
      .then(async (access) => {
        control.onRepaired(access);
        control.onExecutionTargetChange({
          mode: "device",
          deviceId: row.deviceId,
        });
        await refreshPaired();
      })
      .catch((error: unknown) => {
        Alert.alert(
          t("mobile.settings.computer.connectFailedTitle"),
          userFacingError(error),
        );
      })
      .finally(() => setBusy(null));
  };

  /** Say yes on this computer's behalf; only ever from a tap. */
  const enableComputer = (row: ComputerRow) => {
    tapLight();
    setBusy({ deviceId: row.deviceId, kind: "enabling" });
    void enableRemoteExecution(row.deviceId)
      .then((result) => {
        setDestinations((current) =>
          applyRemoteExecution(current, row.deviceId, result.remoteExecution),
        );
        setRefreshToken((value) => value + 1);
      })
      .catch((error: unknown) => {
        Alert.alert(
          t("mobile.settings.computer.enableFailedTitle"),
          userFacingError(error),
        );
      })
      .finally(() => setBusy(null));
  };

  /** What this phone can do about a computer: Enable, or nothing. */
  const explain = (row: ComputerRow) => {
    const label = labelFor(row);
    const buttons: AlertButton[] = [];
    if (row.canEnable) {
      buttons.push({
        text: t("mobile.settings.computer.enable"),
        onPress: () => enableComputer(row),
      });
    }
    buttons.push({
      text: buttons.length
        ? t("mobile.common.cancel")
        : t("mobile.common.done"),
      style: "cancel",
    });
    Alert.alert(label, statusTextFor(row), buttons);
  };

  const cloudSelected = !selectedRow;
  const cloudLabel = t("mobile.settings.computer.cloud");
  const pick = (row: ComputerRow) =>
    row.available ? selectComputer(row) : explain(row);
  const working = busy !== null;

  const face = (
    <SwitcherFace
      glyph={
        <Icon
          name={cloudSelected ? "cloud" : "laptop"}
          size={24}
          color={colors.text}
          weight="semibold"
        />
      }
      title={selectedRow ? labelFor(selectedRow) : cloudLabel}
      detail={selectedRow ? statusTextFor(selectedRow) : undefined}
      detailTone={selectedRow ? "ok" : "muted"}
      busy={working}
    />
  );

  const items: NativeMenuItem[] = [
    {
      id: "cloud",
      title: cloudLabel,
      systemImage: "cloud",
      selected: cloudSelected,
      onPress: () => choose({ mode: "cloud" }),
    },
    ...rows.map((row, index): NativeMenuItem => ({
      id: row.deviceId,
      title: row.available
        ? labelFor(row)
        : `${labelFor(row)} · ${statusTextFor(row)}`,
      systemImage: "laptopcomputer",
      selected: selectedRow?.deviceId === row.deviceId,
      separatorBefore: index === 0,
      onPress: () => pick(row),
    })),
  ];

  return (
    <View>
      <NativeMenu
        plain
        label={face}
        accessibilityLabel={`${t("mobile.settings.computer.sectionLabel")}: ${
          selectedRow ? labelFor(selectedRow) : cloudLabel
        }`}
        items={items}
        width={width}
        height={KIT.switcherHeight}
        disabled={!control || working}
        onFallbackPress={() => setExpanded((value) => !value)}
      />
      {expanded ? (
        <View>
          <ChoiceRow
            label={cloudLabel}
            selected={cloudSelected}
            onPress={() => {
              setExpanded(false);
              choose({ mode: "cloud" });
            }}
          />
          {rows.map((row) => (
            <ChoiceRow
              key={row.deviceId}
              label={labelFor(row)}
              detail={statusTextFor(row)}
              selected={selectedRow?.deviceId === row.deviceId}
              disabled={busy?.deviceId === row.deviceId}
              onPress={() => {
                setExpanded(false);
                pick(row);
              }}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}
