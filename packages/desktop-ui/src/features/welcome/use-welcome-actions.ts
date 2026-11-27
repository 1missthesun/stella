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
import { uiState } from "@/platform/ui-state";
import { openWelcomeDemo, type WelcomeDemoId } from "./demos/open-welcome-demo";

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
  // Opens the theme picker, which the client anchors to the button; `run`
  // is then called when the picker closes.
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

// Once the theme picker has been opened and closed from the welcome, the look
// line offers its demo instead.
const LOOK_SEEN_KEY = "stella-welcome-look-seen";

function useLookSeen(): [boolean, () => void] {
  const [seen, setSeen] = useState(() => uiState.getItem(LOOK_SEEN_KEY) === "1");
  const markSeen = useCallback(() => {
    uiState.setItem(LOOK_SEEN_KEY, "1");
    setSeen(true);
  }, []);
  return [seen, markSeen];
}

// Each line offers at most one button, on the right of its text: the setup
// step it describes while that isn't done, else a demo of it.
export function useWelcomeActions({
  openChooseAi,
  demos = true,
}: {
  openChooseAi: () => void;
  demos?: boolean;
}): (id: WelcomeItemId) => WelcomeAction | null {
  const t = useT();
  const native = platformCapabilities.nativeBridges;
  const { hasConnectedAccount: signedIn } = useAuthSessionState();
  const extensionConnected = useExtensionConnected();
  const canConnectGmail = native && signedIn && Boolean(window.electronAPI?.nativeIntegrations?.enable);
  const gmail = useGmail(canConnectGmail);
  const phoneLinked = usePhoneLinked(signedIn);
  const planConnected = usePlanConnected();
  const [lookSeen, markLookSeen] = useLookSeen();

  const demo = (id: WelcomeDemoId, label: string): WelcomeAction | null =>
    demos ? { id: "demo", label, run: () => openWelcomeDemo(id), demo: true } : null;

  return (id: WelcomeItemId): WelcomeAction | null => {
    switch (id) {
      case "errands":
        if (native && !extensionConnected) {
          return {
            id: "extension",
            label: t("welcome.actions.getExtension"),
            run: () => openExternalUrl(STELLA_BROWSER_EXTENSION_STORE_URL),
          };
        }
        if (canConnectGmail && (gmail.phase === "off" || gmail.phase === "connecting" || gmail.phase === "error")) {
          return {
            id: "gmail",
            label:
              gmail.phase === "connecting"
                ? t("welcome.actions.gmailWaiting")
                : gmail.phase === "error"
                  ? t("welcome.actions.gmailRetry")
                  : t("welcome.actions.connectGmail"),
            busy: gmail.phase === "connecting",
            run: () => void gmail.connect(),
          };
        }
        return demo("errands", t("welcome.actions.watchErrands"));
      case "anywhere":
        if (!signedIn) return { id: "signin", label: t("welcome.actions.signIn"), run: () => openRootDialog("auth"), primary: true };
        return platformCapabilities.phoneAccess && phoneLinked === false
          ? {
              id: "phone",
              label: t("welcome.actions.getPhoneApp"),
              run: () => {
                finishNudge("phoneApp");
                openRootDialog("connect");
              },
            }
          : null;
      case "memory":
        return demo("memory", t("welcome.actions.watchMemory"));
      case "plans":
        return native && !planConnected ? { id: "plan", label: t("welcome.actions.connectPlan"), run: openChooseAi } : null;
      case "customize":
        return lookSeen
          ? demo("customize", t("welcome.actions.watchCustomize"))
          : { id: "theme", label: t("welcome.actions.changeLook"), theme: true, run: markLookSeen };
    }
  };
}
