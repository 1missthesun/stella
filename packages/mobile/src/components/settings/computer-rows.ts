import type { DeviceRemoteExecution } from "@stella/contracts/turn-plane/placement";
import type { ExecutionDeviceDestination } from "../../lib/execution-placement";
import type { StoredPhoneAccess } from "../../lib/phone-access";

export type ComputerRowStatusKind =
  | "online"
  | "notReady"
  | "notEnabled"
  | "awaitingConsent"
  | "declined"
  | "offline";

export type ComputerRow = {
  deviceId: string;
  label?: string;
  access: StoredPhoneAccess | null;
  statusKind: ComputerRowStatusKind;
  preferActiveStatusLabel: boolean;
  available: boolean;
  listed: boolean;
  canEnable: boolean;
};

const remoteExecutionOf = (
  device: ExecutionDeviceDestination,
): DeviceRemoteExecution =>
  device.remoteExecution ??
  (device.remoteExecutionEnabled ? "enabled" : "unconfigured");

const statusKindOf = (
  device: ExecutionDeviceDestination | undefined,
): ComputerRowStatusKind => {
  if (!device) return "offline";
  const state = remoteExecutionOf(device);
  if (state === "unconfigured") return "notEnabled";
  if (state === "asking") return "awaitingConsent";
  if (state === "declined") return "declined";
  if (!device.online) return "offline";
  return device.availability?.ready === true ? "online" : "notReady";
};

export const buildComputerRows = (props: {
  devices: ExecutionDeviceDestination[] | undefined;
  stored: StoredPhoneAccess[];
  activeDeviceId?: string | null;
}): ComputerRow[] => {
  const storedByDeviceId = new Map(
    props.stored.map((access) => [access.desktopDeviceId, access]),
  );
  const rows: ComputerRow[] = [];
  const seen = new Set<string>();

  const push = (
    deviceId: string,
    device: ExecutionDeviceDestination | undefined,
  ) => {
    if (seen.has(deviceId)) return;
    seen.add(deviceId);
    const statusKind = statusKindOf(device);
    const available = Boolean(
      device?.online &&
        device.remoteExecutionEnabled &&
        device.availability?.ready === true,
    );
    rows.push({
      deviceId,
      ...(device?.label ? { label: device.label } : {}),
      access: storedByDeviceId.get(deviceId) ?? null,
      statusKind,
      preferActiveStatusLabel:
        props.activeDeviceId === deviceId && statusKind === "offline",
      available,
      listed: Boolean(device),
      canEnable: device ? remoteExecutionOf(device) !== "enabled" : false,
    });
  };

  for (const device of props.devices ?? []) push(device.deviceId, device);
  for (const access of props.stored) push(access.desktopDeviceId, undefined);

  return rows;
};
