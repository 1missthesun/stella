import type { DeviceRemoteExecution } from "@stella/contracts/turn-plane/placement";
import { getBackendClient } from "../../lib/backend";
import type { ExecutionDeviceDestination } from "../../lib/execution-placement";

export const enableRemoteExecution = async (deviceId: string) =>
  await getBackendClient().call("devices.setRemoteExecution", {
    deviceId,
    enabled: true,
  });

export const applyRemoteExecution = (
  devices: ExecutionDeviceDestination[] | undefined,
  deviceId: string,
  remoteExecution: DeviceRemoteExecution,
): ExecutionDeviceDestination[] | undefined =>
  devices?.map((device) =>
    device.deviceId === deviceId
      ? {
          ...device,
          remoteExecution,
          remoteExecutionEnabled: remoteExecution === "enabled",
        }
      : device,
  );
