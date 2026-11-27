import { useCallback, useEffect, useState, type ReactElement, type ReactNode } from "react";
import {
  WELCOME_CLOSING,
  WELCOME_GREETING,
  WELCOME_ITEMS,
  WELCOME_LEAD,
  type WelcomeItemId,
} from "@stella/contracts/welcome-message";
import { STELLA_BROWSER_EXTENSION_STORE_URL } from "@stella/contracts/browser-extension";
import { Dialog, DialogBody, DialogCloseButton, DialogContent } from "@/ui/dialog";
import { LegalDialog } from "@/global/legal/LegalDialog";
import { ThemePicker } from "@/global/settings/ThemePicker";
import { DEFAULT_MODEL_BY_PROVIDER } from "@/global/settings/lib/provider-default-models";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { listAccountSessions } from "@/global/auth/services/auth";
import { recordAnonymousCount } from "@/features/anonymous-counts/record-anonymous-count";
import { finishNudge } from "@/features/nudges/usage-nudges-store";
import { openExternalUrl } from "@/platform/electron/open-external";
import { platformCapabilities } from "@/platform/capabilities";
import { useT } from "@/shared/i18n";
import { openWelcomeDemo } from "./demos/open-welcome-demo";
import { ChooseAiCard } from "./ChooseAiCard";
import "./welcome.css";

// Stella's first message. The words come from contracts so every client and
// the model share them; each line carries buttons for what it describes, and
// a button disappears once that thing is done.

type WelcomeAction = {
  id: string;
  label: string;
  run?: () => void;
  render?: (button: ReactElement) => ReactNode;
  busy?: boolean;
  // Demos read as a quiet link; doing something gets the accent pill.
  quiet?: boolean;
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

function LegalLine() {
  const t = useT();
  const [open, setOpen] = useState<"terms" | "privacy" | null>(null);
  const parts = t("onboarding.legalFooter").split(/\{(\w+)\}/);
  const link = (document: "terms" | "privacy", label: string) => (
    <button type="button" className="welcome-message__legal-link" onClick={() => setOpen(document)}>
      {label}
    </button>
  );
  const slots: Record<string, ReactNode> = {
    terms: link("terms", t("onboarding.termsOfService")),
    privacy: link("privacy", t("onboarding.privacyPolicy")),
  };
  return (
    <>
      <LegalDialog document={open} onOpenChange={(next) => (next ? undefined : setOpen(null))} />
      <p className="welcome-message__legal">
        {parts.map((part, index) => (
          <span key={index}>{index % 2 === 0 ? part : (slots[part] ?? `{${part}}`)}</span>
        ))}
      </p>
    </>
  );
}

function ChooseAiDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent fit className="choose-ai-dialog">
        <DialogCloseButton className="choose-ai-dialog__close" />
        <DialogBody>
          <ChooseAiCard
            onDone={() => {
              recordAnonymousCount({ type: "engine_chosen" });
              onOpenChange(false);
            }}
          />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

export function WelcomeMessage() {
  const t = useT();
  const native = platformCapabilities.nativeBridges;
  const { hasConnectedAccount: signedIn } = useAuthSessionState();
  const extensionConnected = useExtensionConnected();
  const canConnectGmail = native && signedIn && Boolean(window.electronAPI?.nativeIntegrations?.enable);
  const gmail = useGmail(canConnectGmail);
  const phoneLinked = usePhoneLinked(signedIn);
  const planConnected = usePlanConnected();
  const [chooseAiOpen, setChooseAiOpen] = useState(false);

  const actionsFor = (id: WelcomeItemId): WelcomeAction[] => {
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
          { id: "demo", label: t("welcome.actions.watchErrands"), run: () => openWelcomeDemo("errands"), quiet: true },
        ];
      case "anywhere":
        if (!signedIn) return [{ id: "signin", label: t("welcome.actions.signIn"), run: () => openRootDialog("auth") }];
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
        return [{ id: "demo", label: t("welcome.actions.watchMemory"), run: () => openWelcomeDemo("memory"), quiet: true }];
      case "plans":
        return native && !planConnected
          ? [{ id: "plan", label: t("welcome.actions.connectPlan"), run: () => setChooseAiOpen(true) }]
          : [];
      case "customize":
        return [
          {
            id: "theme",
            label: t("welcome.actions.changeLook"),
            render: (button) => <ThemePicker trigger={button} side="top" align="start" />,
          },
          { id: "demo", label: t("welcome.actions.watchCustomize"), run: () => openWelcomeDemo("customize"), quiet: true },
        ];
    }
  };

  return (
    <div className="welcome-message" data-testid="welcome-message">
      <ChooseAiDialog open={chooseAiOpen} onOpenChange={setChooseAiOpen} />
      <div className="markdown">
        <p>{WELCOME_GREETING}</p>
        <p>{WELCOME_LEAD}</p>
        <ul>
          {WELCOME_ITEMS.map((item) => {
            const actions = actionsFor(item.id);
            return (
              <li key={item.id} data-welcome-item={item.id}>
                <strong>{item.title}</strong> {item.body}
                {actions.length > 0 ? (
                  <span className="welcome-message__actions">
                    {actions.map((action) => {
                      const button = (
                        <button
                          key={action.id}
                          type="button"
                          className={`welcome-message__action${action.quiet ? "" : " welcome-message__action--primary"}`}
                          data-welcome-action={`${item.id}:${action.id}`}
                          disabled={action.busy}
                          onClick={action.run}
                        >
                          {action.label}
                        </button>
                      );
                      return action.render ? <span key={action.id}>{action.render(button)}</span> : button;
                    })}
                  </span>
                ) : null}
              </li>
            );
          })}
        </ul>
        <p>{WELCOME_CLOSING}</p>
      </div>
      <LegalLine />
    </div>
  );
}
