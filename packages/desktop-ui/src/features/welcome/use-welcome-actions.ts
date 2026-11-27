import { useCallback, useEffect, useState } from "react";
import type { WelcomeItemId } from "@stella/contracts/welcome-message";
import { STELLA_BROWSER_EXTENSION_STORE_URL } from "@stella/contracts/browser-extension";
import { DEFAULT_MODEL_BY_PROVIDER } from "@/global/settings/lib/provider-default-models";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { listAccountSessions } from "@/global/auth/services/auth";
import { finishNudge } from "@/features/nudges/usage-nudges-store";
import { openExternalUrl } from "@/platform/electron/open-external";
import { platformCapabilities } from "@/platform/capabilities";
import { useT } from "@/shared/i18n";
import { openWelcomeDemo } from "./demos/open-welcome-demo";

// The welcome message's buttons, by line: what each does, and which are
// already done (those don't show). Every client draws them its own way.

export type WelcomeAction = {
  id: string;
  label: string;
  run?: () => void;
  busy?: boolean;
  // The one step everything else waits on (signing in) gets the accent;
  // demos are the plainer sibling of the other buttons.
  primary?: boolean;
  demo?: boolean;
  // Opens the theme picker, which the client anchors to the button.
  theme?: boolean;
};

const GMAIL_CONNECTOR_ID = "gmail";
const PHONE_USER_AGENT = /iphone|ipad|android|cfnetwork|okhttp|expo/i;

const openRootDialog = (dialog: "auth" | "connect") => {
  void import("@/router").then(({ router }) => {
    void router.navigate({
      to: ".",
      search: (prev: Record<string, unknown> | undefined) => ({ ...(prev ?? {}), dialog }),
    });
  });
};

function useExtensionConnected(): boolean {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const api = window.electronAPI?.browserView;
    const apply = (state: { clients: { status: string }[] } | null | undefined) =>
      setConnected(
        Boolean(state?.clients.some((client) => client.status === "connected" || client.status === "in_use")),
      );
    void api?.getExtensionClients?.().then(apply, () => undefined);
    return api?.onExtensionClients?.(apply);
  }, []);
  return connected;
}

function useGmail(enabled: boolean) {
  const [phase, setPhase] = useState<"unknown" | "off" | "connecting" | "connected" | "error">("unknown");
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void window.electronAPI?.nativeIntegrations
      ?.list?.()
      .then((list) => {
        if (!live) return;
        const on = list.some((entry) => entry.id === GMAIL_CONNECTOR_ID && entry.enabled);
        setPhase((current) => (current === "unknown" ? (on ? "connected" : "off") : current));
      })
      .catch(() => {
        if (live) setPhase((current) => (current === "unknown" ? "off" : current));
      });
    return () => {
      live = false;
    };
  }, [enabled]);
  const connect = useCallback(async () => {
    const api = window.electronAPI?.nativeIntegrations;
    if (!api?.enable) return;
    setPhase("connecting");
    try {
      const updated = await api.enable({ id: GMAIL_CONNECTOR_ID });
      setPhase(updated.enabled ? "connected" : "error");
    } catch (error) {
      console.warn("[welcome] Gmail connect failed", error);
      setPhase("error");
    }
  }, []);
  return { phase, connect };
}

function usePhoneLinked(signedIn: boolean): boolean | null {
  const [linked, setLinked] = useState<boolean | null>(null);
  useEffect(() => {
    if (!signedIn) {
      setLinked(null);
      return;
    }
    let live = true;
    void listAccountSessions()
      .then((sessions) => {
        if (live) setLinked(sessions.some((session) => !session.current && PHONE_USER_AGENT.test(session.userAgent ?? "")));
      })
      .catch(() => {
        if (live) setLinked(false);
      });
    return () => {
      live = false;
    };
  }, [signedIn]);
  return linked;
}

// A ChatGPT or Claude plan, or a key of the person's own, is what the "Already
// pay for" line is about; Stella's own models don't count.
function usePlanConnected(): boolean {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const read = () => {
      void window.electronAPI?.system
        ?.getLocalModelPreferences?.()
        .then((preferences) => {
          const engine = preferences?.agentRuntimeEngine ?? "default";
          const provider = preferences?.modelOverrides?.orchestrator?.split("/")[0];
          setConnected(engine !== "default" || Boolean(provider && DEFAULT_MODEL_BY_PROVIDER[provider]));
        })
        .catch(() => undefined);
    };
    read();
    window.addEventListener("stella:local-model-preferences-changed", read);
    return () => window.removeEventListener("stella:local-model-preferences-changed", read);
  }, []);
  return connected;
}

export function useWelcomeActions({
  openChooseAi,
  demos = true,
}: {
  openChooseAi: () => void;
  demos?: boolean;
}): (id: WelcomeItemId) => WelcomeAction[] {
  const t = useT();
  const native = platformCapabilities.nativeBridges;
  const { hasConnectedAccount: signedIn } = useAuthSessionState();
  const extensionConnected = useExtensionConnected();
  const canConnectGmail = native && signedIn && Boolean(window.electronAPI?.nativeIntegrations?.enable);
  const gmail = useGmail(canConnectGmail);
  const phoneLinked = usePhoneLinked(signedIn);
  const planConnected = usePlanConnected();

  return (id: WelcomeItemId): WelcomeAction[] => {
    const actions = ((): WelcomeAction[] => {
      switch (id) {
        case "errands":
          return [
            ...(native && !extensionConnected
              ? [
                  {
                    id: "extension",
                    label: t("welcome.actions.getExtension"),
                    run: () => openExternalUrl(STELLA_BROWSER_EXTENSION_STORE_URL),
                  },
                ]
              : []),
            ...(canConnectGmail && (gmail.phase === "off" || gmail.phase === "connecting" || gmail.phase === "error")
              ? [
                  {
                    id: "gmail",
                    label:
                      gmail.phase === "connecting"
                        ? t("welcome.actions.gmailWaiting")
                        : gmail.phase === "error"
                          ? t("welcome.actions.gmailRetry")
                          : t("welcome.actions.connectGmail"),
                    busy: gmail.phase === "connecting",
                    run: () => void gmail.connect(),
                  },
                ]
              : []),
            { id: "demo", label: t("welcome.actions.watchErrands"), run: () => openWelcomeDemo("errands"), demo: true },
          ];
        case "anywhere":
          if (!signedIn) return [{ id: "signin", label: t("welcome.actions.signIn"), run: () => openRootDialog("auth"), primary: true }];
          return platformCapabilities.phoneAccess && phoneLinked === false
            ? [
                {
                  id: "phone",
                  label: t("welcome.actions.getPhoneApp"),
                  run: () => {
                    finishNudge("phoneApp");
                    openRootDialog("connect");
                  },
                },
              ]
            : [];
        case "memory":
          return [{ id: "demo", label: t("welcome.actions.watchMemory"), run: () => openWelcomeDemo("memory"), demo: true }];
        case "plans":
          return native && !planConnected
            ? [{ id: "plan", label: t("welcome.actions.connectPlan"), run: openChooseAi }]
            : [];
        case "customize":
          return [
            { id: "theme", label: t("welcome.actions.changeLook"), theme: true },
            { id: "demo", label: t("welcome.actions.watchCustomize"), run: () => openWelcomeDemo("customize"), demo: true },
          ];
      }
    })();
    return demos ? actions : actions.filter((action) => !action.demo);
  };
}
