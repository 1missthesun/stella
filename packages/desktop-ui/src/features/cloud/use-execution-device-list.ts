import { useEffect, useRef } from "react";
import type { DeviceDestination } from "@stella/contracts/turn-plane/placement";
import { listExecutionDevices } from "@/features/cloud/placement-client";
import { backendClient } from "@/platform/backend/backend-client";
import { getAuthToken } from "@/global/auth/services/auth-token";

/** How often the list is read where the backend does not push it yet. */
const DEVICE_POLL_INTERVAL_MS = 15_000;

/**
 * The owner's computers as the backend pushes them (`devices.list`), for as
 * long as `socketOrigin` is set. A backend without that view gets the HTTP
 * list read on a timer instead. `onDevices` gets when the read began, so a
 * caller can drop a read that started before its own write.
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
    let timer: number | undefined;
    const read = () => {
      const startedAt = Date.now();
      void listExecutionDevices({
        socketOrigin,
        getToken: (tokenOptions) => getAuthToken(tokenOptions ?? {}),
      })
        .then((response) => {
          if (active) callbacks.current.onDevices(response.devices, startedAt);
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
        if (timer !== undefined) window.clearInterval(timer);
        timer = undefined;
        callbacks.current.onDevices(value.devices, Date.now());
      },
      () => {
        if (!active || timer !== undefined) return;
        read();
        timer = window.setInterval(read, DEVICE_POLL_INTERVAL_MS);
      },
    );
    return () => {
      active = false;
      stop();
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [socketOrigin]);
}
