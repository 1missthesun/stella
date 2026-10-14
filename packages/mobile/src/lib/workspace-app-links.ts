import {
  parseWorkspaceApps,
  type WorkspaceApp,
} from "@stella/contracts/workspace-apps";
import { router } from "expo-router";
import { useEffect, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { env } from "../config/env";
import { getAuthToken } from "./auth-token";

const REFRESH_AFTER_MS = 15_000;

type AppsState = { apps: WorkspaceApp[] | null; loading: boolean };
let state: AppsState = { apps: null, loading: false };
let fetchedAt = 0;
let inflight: Promise<void> | null = null;
let pendingOpen: string | null = null;
const listeners = new Set<() => void>();
let mountedAppCards = 0;

const notify = () => {
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function shareWorkspaceApps(list: WorkspaceApp[]) {
  state = { ...state, apps: list };
  fetchedAt = Date.now();
  notify();
}

const setLoading = (loading: boolean) => {
  state = { ...state, loading };
  notify();
};

function refreshWorkspaceApps(): Promise<void> {
  if (inflight) return inflight;
  if (!env.backendUrl) return Promise.resolve();
  setLoading(true);
  inflight = (async () => {
    try {
      const token = await getAuthToken();
      const response = await fetch(`${env.backendUrl}/owners/me/apps`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) return;
      shareWorkspaceApps(parseWorkspaceApps((await response.json()).apps));
    } catch {
      // A card stays in its loading look; the next mount retries.
    } finally {
      inflight = null;
      setLoading(false);
    }
  })();
  return inflight;
}

export function useWorkspaceApp(slug: string): WorkspaceApp | null | undefined {
  const snapshot = useSyncExternalStore(subscribe, () => state);
  const app = snapshot.apps?.find((entry) => entry.slug === slug);
  const known = app !== undefined;
  useEffect(() => {
    mountedAppCards += 1;
    return () => {
      mountedAppCards -= 1;
    };
  }, []);
  useEffect(() => {
    if (!known || Date.now() - fetchedAt > REFRESH_AFTER_MS)
      void refreshWorkspaceApps();
  }, [slug, known]);
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "active" && Date.now() - fetchedAt > REFRESH_AFTER_MS)
        void refreshWorkspaceApps();
    });
    return () => subscription.remove();
  }, []);
  if (app) return app.status === "ready" ? app : null;
  return snapshot.apps === null || snapshot.loading ? undefined : null;
}

export function refreshLinkedWorkspaceApps() {
  if (mountedAppCards > 0) void refreshWorkspaceApps();
}

export function requestOpenApp(slug: string) {
  pendingOpen = slug;
  notify();
  router.push("/apps");
}

export function usePendingAppOpen(): string | null {
  return useSyncExternalStore(subscribe, () => pendingOpen);
}

export function clearPendingAppOpen() {
  pendingOpen = null;
  notify();
}

export const workspaceAppPreviewUrl = (app: WorkspaceApp): string | null =>
  env.backendUrl
    ? `${env.backendUrl}/owners/me/apps/${encodeURIComponent(app.slug)}/preview?v=${encodeURIComponent(app.revision)}`
    : null;
