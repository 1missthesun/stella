import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { useCloudConversationSession } from "@/global/auth/hooks/use-cloud-conversation-session";
import { getAuthHeaders } from "@/global/auth/services/auth-token";
import { parseWorkspaceApps } from "@stella/contracts/workspace-apps";
import { useCallback, useEffect, useMemo, useState } from "react";
import { backendUrl } from "@/platform/backend/backend-client";
import type { CloudApp } from "./cloud-api";
export type CloudAppsState = {
  accountScope: string;
  phase: "disabled" | "loading" | "ready" | "error";
  apps: CloudApp[];
  error: string | null;
  httpOrigin: string | null;
  signedIn: boolean;
  sessionFailed: boolean;
  retry: () => void;
};
const APPS_REFRESH_MS = 60_000;
const lastApps = new Map<string, CloudApp[]>();
export function useCloudApps(): CloudAppsState {
  const {
    isCloudConversationReady,
    accountScope,
    authBootstrapStatus,
    retryAuthBootstrap,
    refreshMainConversation,
  } = useCloudConversationSession();
  const { hasConnectedAccount, isLoading: sessionLoading } =
    useAuthSessionState();
  const origin = isCloudConversationReady && backendUrl ? backendUrl : null;
  const [result, setResult] = useState<{
    scope: string;
    apps: CloudApp[];
    error: string | null;
  } | null>(() => {
    const apps = lastApps.get(accountScope);
    return apps ? { scope: accountScope, apps, error: null } : null;
  });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!origin) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let loading = false;
    const visible = () =>
      typeof document === "undefined" || document.visibilityState !== "hidden";
    const schedule = () => {
      clearTimeout(timer);
      if (cancelled || !visible()) return;
      timer = setTimeout(() => void load(), APPS_REFRESH_MS);
    };
    const load = async () => {
      if (cancelled || loading) return;
      loading = true;
      try {
        const response = await fetch(`${origin}/owners/me/apps`, {
          headers: await getAuthHeaders(),
          signal: AbortSignal.timeout(60_000),
        });
        if (!response.ok) throw new Error("Apps could not be loaded.");
        const data = await response.json();
        const apps = parseWorkspaceApps(data.apps);
        lastApps.set(accountScope, apps);
        if (!cancelled) setResult({ scope: accountScope, apps, error: null });
      } catch (e) {
        if (!cancelled)
          setResult((previous) => ({
            scope: accountScope,
            apps: previous?.scope === accountScope ? previous.apps : [],
            error: e instanceof Error ? e.message : "Apps could not be loaded.",
          }));
      } finally {
        loading = false;
        schedule();
      }
    };
    const onVisibilityChange = () => {
      if (visible()) void load();
      else clearTimeout(timer);
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    if (visible()) void load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [origin, accountScope, attempt]);
  const sessionFailed = authBootstrapStatus === "failed";
  const retry = useCallback(() => {
    if (sessionFailed) retryAuthBootstrap();
    else if (!isCloudConversationReady) refreshMainConversation();
    else {
      setResult((previous) =>
        previous && previous.apps.length > 0 ? previous : null,
      );
      setAttempt((count) => count + 1);
    }
  }, [
    isCloudConversationReady,
    refreshMainConversation,
    retryAuthBootstrap,
    sessionFailed,
  ]);
  return useMemo(
    () => ({
      accountScope,
      httpOrigin: origin,
      phase: !isCloudConversationReady
        ? "disabled"
        : !result || result.scope !== accountScope
          ? "loading"
          : result.error
            ? "error"
            : "ready",
      apps: result?.scope === accountScope ? result.apps : [],
      error: result?.scope === accountScope ? result.error : null,
      signedIn: hasConnectedAccount || sessionLoading,
      sessionFailed,
      retry,
    }),
    [
      accountScope,
      origin,
      isCloudConversationReady,
      result,
      hasConnectedAccount,
      sessionLoading,
      sessionFailed,
      retry,
    ],
  );
}
