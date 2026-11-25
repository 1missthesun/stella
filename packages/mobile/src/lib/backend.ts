import AsyncStorage from "@react-native-async-storage/async-storage";
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
import { REQUEST_BUDGET_MS } from "@stella/contracts/request-deadline";
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
    client.call = (async (name, args, options) => {
      try {
        return await call(name, args, options);
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
  return getBackendClient().read(view, args, { timeoutMs: REQUEST_BUDGET_MS.call });
}

const rememberedViews = new Map<string, unknown>();
const persistedViewText = new Map<string, string>();
const VIEW_STORAGE_PREFIX = "stella-mobile:view:v2:";

function rememberView(memoryKey: string, value: unknown, persist: boolean): void {
  rememberedViews.set(memoryKey, value);
  if (!persist) return;
  const text = JSON.stringify(value);
  if (persistedViewText.get(memoryKey) === text) return;
  persistedViewText.set(memoryKey, text);
  void AsyncStorage.setItem(VIEW_STORAGE_PREFIX + memoryKey, text).catch(() => {
    persistedViewText.delete(memoryKey);
  });
}

const rememberedScope = (owner: string) =>
  `${encodeURIComponent(env.backendUrl)}:${encodeURIComponent(owner)}:`;

const warmedOwners = new Set<string>();

export async function warmRememberedViews(owner: string): Promise<void> {
  if (warmedOwners.has(owner)) return;
  warmedOwners.add(owner);
  const prefix = VIEW_STORAGE_PREFIX + rememberedScope(owner);
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((key) =>
      key.startsWith(prefix),
    );
    for (const [storageKey, text] of await AsyncStorage.multiGet(keys)) {
      const memoryKey = storageKey.slice(VIEW_STORAGE_PREFIX.length);
      if (text === null || rememberedViews.has(memoryKey)) continue;
      rememberedViews.set(memoryKey, JSON.parse(text));
      persistedViewText.set(memoryKey, text);
    }
  } catch {
    warmedOwners.delete(owner);
  }
}

type ViewState<K extends ViewName> = {
  key: string | null;
  hasValue: boolean;
  value?: ViewResult<K>;
  error?: BackendRequestError;
};

/**
 * `rememberFor` (the signed-in owner id) keeps the view's last value for the
 * session, and `persist` also across launches (loaded by
 * `warmRememberedViews`), so a screen that mounts again shows it at once while
 * the live subscription refreshes it.
 */
export function useBackendView<K extends ViewName>(
  view: K,
  args: ViewArgs<K> | "skip",
  options: { rememberFor?: string | null; persist?: boolean } = {},
): { value: ViewResult<K> | undefined; error: BackendRequestError | undefined } {
  const argsJson = args === "skip" ? null : stableStringify(args);
  const key = argsJson === null ? null : `${view}\u0000${argsJson}`;
  const memoryKey =
    argsJson !== null && options.rememberFor
      ? `${rememberedScope(options.rememberFor)}${view}:${encodeURIComponent(argsJson)}`
      : null;
  const identity = memoryKey ?? key;
  const persist = options.persist === true;
  const [state, setState] = useState<ViewState<K>>(() =>
    initialViewState<K>(identity, memoryKey),
  );
  useEffect(() => {
    setState((previous) =>
      previous.key === identity
        ? previous
        : initialViewState<K>(identity, memoryKey),
    );
    if (key === null || argsJson === null) return;
    return getBackendClient().watch(
      view,
      JSON.parse(argsJson) as ViewArgs<K>,
      (value) => {
        if (memoryKey) rememberView(memoryKey, value, persist);
        setState({ key: identity, hasValue: true, value });
      },
      (error) =>
        setState((previous) => ({ ...previous, key: identity, error })),
    );
  }, [identity, key, view, argsJson, memoryKey, persist]);
  const current =
    state.key === identity
      ? state
      : initialViewState<K>(identity, memoryKey);
  return { value: current.value, error: current.error };
}

function initialViewState<K extends ViewName>(
  key: string | null,
  memoryKey: string | null,
): ViewState<K> {
  if (memoryKey && rememberedViews.has(memoryKey)) {
    return {
      key,
      hasValue: true,
      value: rememberedViews.get(memoryKey) as ViewResult<K>,
    };
  }
  return { key, hasValue: false };
}
