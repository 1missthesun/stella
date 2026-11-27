import { Press, T, tx } from "../kit/compat";
import { useAppsSection } from "../global/shared/apps-section.styles";
import { serverNow } from "@stella/contracts/server-clock";
import { useCloudConversationSession } from "@/global/auth/hooks/use-cloud-conversation-session";
import { getAuthHeaders } from "@/global/auth/services/auth-token";
import { useEffect, useState } from "react";
import { backendUrl } from "@/platform/backend/backend-client";

export function CloudAppPanel({ slug }: { slug: string }) {
  const s = useAppsSection();
  const { isCloudConversationReady, accountScope } =
    useCloudConversationSession();
  const config =
    isCloudConversationReady && backendUrl ? { httpOrigin: backendUrl } : null;
  const [state, setState] = useState<{
    url?: string;
    error?: string;
    loaded?: boolean;
  }>({});
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    setState({});
    if (!config?.httpOrigin) return;
    let cancelled = false;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
          `${config.httpOrigin}/owners/me/apps/${encodeURIComponent(slug)}/session`,
          {
            method: "POST",
            headers: await getAuthHeaders(),
            signal: AbortSignal.any([
              controller.signal,
              AbortSignal.timeout(60_000),
            ]),
          },
        );
        const value = await response.json();
        if (
          !response.ok ||
          typeof value.url !== "string" ||
          !Number.isSafeInteger(value.expiresAt)
        )
          throw new Error(value.error ?? "App could not be opened.");
        if (cancelled) return;
        setState({ url: value.url });
        expiry = setTimeout(
          () =>
            setState({
              error: "This app session expired. Reopen it to continue.",
            }),
          Math.max(0, value.expiresAt - serverNow()),
        );
      } catch (e) {
        if (!cancelled)
          setState({
            error: e instanceof Error ? e.message : "App could not be opened.",
          });
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(expiry);
    };
  }, [config?.httpOrigin, slug, accountScope, retry]);
  useEffect(() => {
    if (!state.url || state.loaded) return;
    const timeout = setTimeout(
      () =>
        setState({
          error: "App did not finish loading. Try opening it again.",
        }),
      60_000,
    );
    return () => clearTimeout(timeout);
  }, [state.url, state.loaded]);
  if (state.error)
    return (
      <col {...s.persistentUserAppStatus} role="alert">
        <T {...tx(s.persistentUserAppStatus)}>{state.error}</T>
        <Press text={tx(s.persistentUserAppStatus)} onPress={() => setRetry((v) => v + 1)}>Reopen app</Press>
      </col>
    );
  return (
    <>
      {!state.loaded && (
        <T w="full" {...s.persistentUserAppStatus} role="status">
          Opening app…
        </T>
      )}
      {state.url && (
        <webview
          id={`cloud-app-${slug}`}
          title={slug}
          url={state.url}
          w="full"
          h="full"
          corners={[0, 0, 12, 12]}
          onLoad={(e) => {
            if (e.phase === "finished") setState((current) => ({ ...current, loaded: true }));
          }}
          onError={() =>
            setState({
              error: "App could not be loaded. Try opening it again.",
            })
          }
        />
      )}
    </>
  );
}
