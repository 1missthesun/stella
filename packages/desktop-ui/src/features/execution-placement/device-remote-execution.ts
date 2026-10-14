import type { DeviceDestination } from "@stella/contracts/turn-plane/placement";

export type RemoteExecutionDeviceView = Pick<
  DeviceDestination,
  "online" | "remoteExecutionEnabled" | "remoteExecution"
> & {
  availability?: DeviceDestination["availability"];
};

export type DeviceExecutionBlocker =
  | "offline"
  | "notEnabled"
  | "asking"
  | "declined"
  | "notReady";

export const isExecutionDeviceSelectable = (
  device: RemoteExecutionDeviceView,
): boolean =>
  device.online &&
  device.remoteExecutionEnabled &&
  device.availability?.ready === true;

export const executionDeviceBlocker = (
  device: RemoteExecutionDeviceView,
): DeviceExecutionBlocker | null => {
  if (isExecutionDeviceSelectable(device)) return null;
  if (!device.online) return "offline";
  switch (device.remoteExecution) {
    case "unconfigured":
      return "notEnabled";
    case "asking":
      return "asking";
    case "declined":
      return "declined";
    default:
      return "notReady";
  }
};
