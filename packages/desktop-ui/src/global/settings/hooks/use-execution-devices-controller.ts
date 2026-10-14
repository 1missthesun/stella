import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DeviceDestination,
  DeviceRemoteExecution,
} from "@stella/contracts/turn-plane/placement";
import { useExecutionDeviceList } from "@/features/cloud/use-execution-device-list";
import { backendClient, backendUrl } from "@/platform/backend/backend-client";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { getDeviceIdOrNull } from "@/platform/electron/device";
import { getElectronApi } from "@/platform/electron/electron";

export type ExecutionDeviceRow = DeviceDestination & {
  isCurrent: boolean;
};

export type ExecutionDevicesError = "load" | "update";

export function useExecutionDevicesController() {
  const { hasConnectedAccount } = useAuthSessionState();
  const [devices, setDevices] = useState<DeviceDestination[] | null>(null);
  const [currentDeviceId, setCurrentDeviceId] = useState<string | null>(null);
  const [error, setError] = useState<ExecutionDevicesError | null>(null);
  const [pendingDeviceId, setPendingDeviceId] = useState<string | null>(null);
  const socketOrigin = hasConnectedAccount && backendUrl ? backendUrl : null;
  const lastWriteAt = useRef(0);

  useEffect(() => {
    void getDeviceIdOrNull().then(setCurrentDeviceId, () =>
      setCurrentDeviceId(null),
    );
  }, []);

  useEffect(() => {
    if (!socketOrigin) setDevices(null);
  }, [socketOrigin]);

  useExecutionDeviceList({
    socketOrigin,
    onDevices: (next, startedAt) => {
      if (startedAt < lastWriteAt.current) return;
      setDevices(next);
      setError((current) => (current === "load" ? null : current));
    },
    onError: () => setError("load"),
  });

  const rows = useMemo<ExecutionDeviceRow[]>(() => {
    const listed = (devices ?? []).map((device) => ({
      ...device,
      isCurrent: device.deviceId === currentDeviceId,
    }));
    return listed.sort((left, right) => {
      if (left.isCurrent !== right.isCurrent) return left.isCurrent ? -1 : 1;
      return (left.label ?? left.deviceId).localeCompare(
        right.label ?? right.deviceId,
      );
    });
  }, [currentDeviceId, devices]);

  const setRemoteExecution = useCallback(
    async (deviceId: string, enabled: boolean): Promise<boolean> => {
      if (pendingDeviceId) return false;
      setPendingDeviceId(deviceId);
      setError((current) => (current === "update" ? null : current));
      try {
        const own =
          deviceId === currentDeviceId
            ? getElectronApi()?.remoteExecution
            : undefined;
        let remoteExecution: DeviceRemoteExecution;
        if (own) {
          await own.answer(enabled);
          remoteExecution = enabled ? "enabled" : "declined";
        } else {
          const result = await backendClient.call(
            "devices.setRemoteExecution",
            { deviceId, enabled },
          );
          remoteExecution = result.remoteExecution;
        }
        lastWriteAt.current = Date.now();
        setDevices((current) =>
          (current ?? []).map((device) =>
            device.deviceId === deviceId
              ? {
                  ...device,
                  remoteExecution,
                  remoteExecutionEnabled: remoteExecution === "enabled",
                }
              : device,
          ),
        );
        return true;
      } catch {
        setError("update");
        return false;
      } finally {
        setPendingDeviceId(null);
      }
    },
    [currentDeviceId, pendingDeviceId],
  );

  return {
    hasConnectedAccount,
    devices: devices === null ? null : rows,
    currentDeviceId,
    error,
    pendingDeviceId,
    setRemoteExecution,
  };
}
