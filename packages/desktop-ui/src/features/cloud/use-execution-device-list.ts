import { useEffect, useRef } from "react";
import type { DeviceDestination } from "@stella/contracts/turn-plane/placement";
import { listExecutionDevices } from "@/features/cloud/placement-client";
import { backendClient } from "@/platform/backend/backend-client";
import { getAuthToken } from "@/global/auth/services/auth-token";

export function useExecutionDeviceList(options: {
  httpOrigin: string | null;
  onDevices(devices: DeviceDestination[], startedAt: number): void;
  onError?(): void;
}): void {
  const callbacks = useRef(options);
  callbacks.current = options;
  const { httpOrigin } = options;

  useEffect(() => {
    if (!httpOrigin) return;
    let active = true;
    let pushed = false;
    let fallbackRead = false;
    const read = () => {
      const startedAt = Date.now();
      void listExecutionDevices({
        httpOrigin,
        getToken: (tokenOptions) => getAuthToken(tokenOptions ?? {}),
      })
        .then((response) => {
          if (active && !pushed) {
            callbacks.current.onDevices(response.devices, startedAt);
          }
        })
        .catch(() => {
          if (active) callbacks.current.onError?.();
        });
    };
    const stop = backendClient.watch(
      "devices.list",
      {},
      (value) => {
        if (!active) return;
        pushed = true;
        callbacks.current.onDevices(value.devices, Date.now());
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
    };
  }, [httpOrigin]);
}
