// Tells the views host which account is signed in, from anywhere in the app (not only while a chat
// is open): views keep each account's saved values apart, so a switch must reach the host before
// the new account's backend carries any view's changes.
import { useEffect } from "react";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { backendClient } from "@/platform/backend/backend-client";

export function ViewsAccountBridge() {
  const { hasSession, isLoading, cacheScope } = useAuthSessionState();
  useEffect(() => {
    if (isLoading) return;
    globalThis.stella.views?.connectBackend?.(hasSession ? backendClient : null, hasSession ? cacheScope : null);
  }, [hasSession, isLoading, cacheScope]);
  return null;
}
