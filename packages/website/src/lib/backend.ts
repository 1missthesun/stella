"use client";

import { useEffect, useState } from "react";
import type { ViewArgs, ViewName, ViewResult } from "@stella/contracts/backend/api";
import { BackendClient, stableStringify } from "@stella/contracts/backend/client";
import { getAuthToken } from "./auth-token";
import { isBackendConfigured, readBackendUrl } from "./backend-url";

let cachedClient: BackendClient | null = null;

export { isBackendConfigured };

export function getBackendClient(): BackendClient {
  if (cachedClient) return cachedClient;
  const baseUrl = readBackendUrl();
  if (!baseUrl) throw new Error("NEXT_PUBLIC_STELLA_BACKEND_URL is not configured.");
  cachedClient = new BackendClient({
    baseUrl,
    getToken: (options) =>
      getAuthToken(options?.force ? { forceRefresh: true } : undefined),
  });
  return cachedClient;
}

export function reconnectBackendClient(): void {
  cachedClient?.reconnect();
}

export function useBackendValue<K extends ViewName>(
  view: K,
  args: ViewArgs<K> | "skip",
): ViewResult<K> | undefined {
  const argsJson = args === "skip" ? null : stableStringify(args);
  const key = argsJson === null ? null : `${view}\u0000${argsJson}`;
  const [state, setState] = useState<{ key: string | null; value?: ViewResult<K> }>({
    key: null,
  });
  useEffect(() => {
    if (key === null || argsJson === null || !isBackendConfigured()) return;
    const unwatch = getBackendClient().watch(
      view,
      JSON.parse(argsJson) as ViewArgs<K>,
      (value) => setState({ key, value }),
      () => {},
    );
    return () => {
      unwatch();
      setState({ key: null });
    };
  }, [key, view, argsJson]);
  return state.key === key ? state.value : undefined;
}
