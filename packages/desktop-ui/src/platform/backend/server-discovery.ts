import { useSyncExternalStore } from "react";
import {
  parseServerDiscovery,
  SELF_HOST_DISCOVERY_PATH,
  type ServerDiscovery,
  type ServerFeatures,
} from "@stella/contracts/self-host";
import { backendUrl } from "./backend-url";
import {
  fetchWithDeadline,
  REQUEST_BUDGET_MS,
} from "@stella/contracts/request-deadline";

const launchedSelfHosted =
  (import.meta.env.VITE_STELLA_SELF_HOSTED as string | undefined) === "1";

let discovery: ServerDiscovery | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const loadServerDiscovery = (): Promise<void> => {
  if (loading) return loading;
  loading = (async () => {
    if (!backendUrl) return;
    try {
      const response = await fetchWithDeadline(
        fetch,
        `${backendUrl}${SELF_HOST_DISCOVERY_PATH}`,
        { headers: { Accept: "application/json" } },
        { label: "server discovery", timeoutMs: REQUEST_BUDGET_MS.lookup },
      );
      if (!response.ok) return;
      discovery = parseServerDiscovery(await response.json());
      listeners.forEach((listener) => listener());
    } catch {
      loading = null;
    }
  })();
  return loading;
};

export const getServerDiscovery = (): ServerDiscovery | null => discovery;

export const isSelfHostedServer = (): boolean =>
  launchedSelfHosted || discovery?.ownerMode === true;

export const serverFeatureOn = (feature: keyof ServerFeatures): boolean =>
  !isSelfHostedServer() || discovery?.features[feature] === true;

export const useServerDiscovery = (): ServerDiscovery | null =>
  useSyncExternalStore(subscribe, () => discovery, () => null);

export const useSelfHostedServer = (): boolean => {
  const current = useServerDiscovery();
  return launchedSelfHosted || current?.ownerMode === true;
};

export const useServerFeature = (feature: keyof ServerFeatures): boolean => {
  const current = useServerDiscovery();
  const selfHosted = launchedSelfHosted || current?.ownerMode === true;
  return !selfHosted || current?.features[feature] === true;
};
