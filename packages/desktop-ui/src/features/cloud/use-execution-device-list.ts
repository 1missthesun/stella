import { useEffect, useRef } from "react";
import type { DeviceDestination } from "@stella/contracts/turn-plane/placement";
import { listExecutionDevices } from "@/features/cloud/placement-client";
import { backendClient } from "@/platform/backend/backend-client";
import { getAuthToken } from "@/global/auth/services/auth-token";

/**
 * The owner's computers as the backend pushes them (`devices.list`), for as
 * long as `socketOrigin` is set. When the view errors, the HTTP list is read
 * once so the picker isn't empty; the live socket resubscribes on its own and
 * its next push replaces it. Polling here read the owner's object every 15
 * seconds for what the socket already carries. `onDevices` gets when the read
 * began, so a caller can drop a read that started before its own write.
 */
export function useExecutionDeviceList(options: {
  socketOrigin: string | null;
  onDevices(devices: DeviceDestination[], startedAt: number): void;
  onError?(): void;
}): void {
  const callbacks = useRef(options);
  callbacks.current = options;
  const { socketOrigin } = options;

  useEffect(() => {
    if (!socketOrigin) return;
    let active = true;
    let pushed = false;
    let fallbackRead = false;
    const read = () => {
      const startedAt = Date.now();
      void listExecutionDevices({
        socketOrigin,
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
  }, [socketOrigin]);
}
