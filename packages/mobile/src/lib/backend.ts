import { useEffect, useState } from "react";
import type {
  ViewArgs,
  ViewName,
  ViewResult,
} from "@stella/contracts/backend/api";
import {
  BackendClient,
  stableStringify,
  type BackendRequestError,
} from "@stella/contracts/backend/client";
import { env } from "../config/env";
import { getAuthToken } from "./auth-token";
import { isSelfHostedLaunch } from "./server-registry";
import { noteBackendError } from "./server-features";

let cachedClient: BackendClient | null = null;

export function getBackendClient(): BackendClient {
  if (cachedClient) return cachedClient;
  if (!env.backendUrl) {
    throw new Error("EXPO_PUBLIC_STELLA_BACKEND_URL is not configured.");
  }
  const client = new BackendClient({
    baseUrl: env.backendUrl,
    getToken: (options) =>
      getAuthToken(options?.force ? { forceRefresh: true } : undefined),
  });
  if (isSelfHostedLaunch) {
    const call = client.call.bind(client);
    client.call = (async (name, args) => {
      try {
        return await call(name, args);
      } catch (error) {
        noteBackendError(error);
        throw error;
      }
    }) as typeof client.call;
    const watch = client.watch.bind(client);
    client.watch = ((view, args, onValue, onError) =>
      watch(view, args, onValue, (error) => {
        noteBackendError(error);
        onError?.(error);
      })) as typeof client.watch;
  }
  cachedClient = client;
  return cachedClient;
}

export function reconnectBackend(): void {
  cachedClient?.reconnect();
}

export function readBackendView<K extends ViewName>(
  view: K,
  args: ViewArgs<K>,
): Promise<ViewResult<K>> {
  return new Promise((resolve, reject) => {
    let done = false;
    let unsubscribe: (() => void) | null = null;
    const settle = (finish: () => void) => {
      if (done) return;
      done = true;
      unsubscribe?.();
      finish();
    };
    unsubscribe = getBackendClient().watch(
      view,
      args,
      (value) => settle(() => resolve(value)),
      (error) => settle(() => reject(error)),
    );
    if (done) unsubscribe();
  });
}

export function useBackendView<K extends ViewName>(
  view: K,
  args: ViewArgs<K> | "skip",
): { value: ViewResult<K> | undefined; error: BackendRequestError | undefined } {
  const key = args === "skip" ? null : `${view}\u0000${stableStringify(args)}`;
  const [state, setState] = useState<{
    key: string | null;
    value?: ViewResult<K>;
    error?: BackendRequestError;
  }>({ key: null });
  useEffect(() => {
    setState({ key });
    if (args === "skip" || key === null) return;
    return getBackendClient().watch(
      view,
      args,
      (value) => setState({ key, value }),
      (error) => setState((previous) => ({ ...previous, key, error })),
    );
    // `key` captures `args`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, view]);
  const current = state.key === key ? state : { key };
  return { value: current.value, error: current.error };
}
