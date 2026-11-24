import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EmailPageState } from "@stella/contracts/backend/email";
import { EMAIL_PAGE_CANVAS, EMAIL_PAGE_FRAME_HTML, EMAIL_PAGE_OFF_ACTION, EMAIL_PAGE_RULE_REMOVE_PREFIX, emailPageActions, isEmailPageHostAction } from "@stella/contracts/email-page";
import type { CanvasActionEvent } from "@stella/contracts/canvas-actions";
import { useTheme } from "@/context/theme-context";
import { markEmailSeen } from "@/features/email/email-unseen";
import { useEmailFeature } from "@/features/email/email-feature";
import { useDisplayPanelOpen } from "@/features/workspace-display/tab-store";
import { backendClient } from "@/platform/backend/backend-client";
import { useBackendView } from "@/platform/backend/use-backend-view";
import { openExternalUrl } from "@/platform/electron/open-external";
import { useI18n } from "@/shared/i18n";
import { EmptyState } from "@/ui/empty-state/EmptyState";
import { LogIn, Mail } from "@/ui/icons";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { SIGN_IN_TOAST_ACTION } from "@/shared/lib/auth-cta";
import { CanvasFrame, useHtmlCanvasSource } from "@/shell/display/canvas-tab/CanvasFrame";
import { useCanvasActions, type CanvasActionOutcome } from "@/shell/display/canvas-tab/use-canvas-actions";
import { useCanvasLinks } from "@/shell/display/canvas-tab/use-canvas-links";
import "./email-section.css";

const EMAIL_PAGE_IDENTITY = { canvas: EMAIL_PAGE_CANVAS, title: "Email" };

const runHostAction = async (event: CanvasActionEvent): Promise<CanvasActionOutcome> => {
  try {
    if (event.id === EMAIL_PAGE_OFF_ACTION) {
      await backendClient.call("email.setEnabled", { enabled: false });
    } else {
      await backendClient.call("email.tool", {
        action: "rules",
        op: "remove",
        rule: event.id.slice(EMAIL_PAGE_RULE_REMOVE_PREFIX.length),
      });
    }
    return "sent";
  } catch {
    return "failed";
  }
};

function EmailPageFrame({ state }: { state: EmailPageState }) {
  const { locale } = useI18n();
  const { resolvedColorMode, colors } = useTheme();
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const { source, error } = useHtmlCanvasSource(EMAIL_PAGE_FRAME_HTML);
  const actions = useMemo(() => emailPageActions(state.page, state.rules), [state.page, state.rules]);
  const data = useMemo(
    () => ({
      view: state,
      theme: resolvedColorMode,
      accent: colors.primary,
      accentFg: colors.primaryForeground,
      locale,
    }),
    [state, resolvedColorMode, colors.primary, colors.primaryForeground, locale],
  );
  const { onFrameLoad } = useCanvasActions({
    frame: () => frameRef.current,
    actions,
    identity: EMAIL_PAGE_IDENTITY,
    data,
    onAction: (event) => (isEmailPageHostAction(event.id) ? runHostAction(event) : undefined),
  });
  useCanvasLinks(frameRef, null);
  if (error) return <EmptyState motif="mail" title={error} />;
  if (!source) return <div className="email-section" aria-busy="true" />;
  return (
    <div className="email-page" data-testid="email-section">
      <CanvasFrame frameRef={frameRef} source={source} title="Email" className="email-page__frame" onDocument={onFrameLoad} />
    </div>
  );
}

export function EmailSection({ active }: { active: boolean }) {
  return useEmailFeature() ? <EmailSectionBody active={active} /> : null;
}

function EmailSectionBody({ active: selected }: { active: boolean }) {
  const panelOpen = useDisplayPanelOpen();
  const active = selected && panelOpen;
  const { t } = useI18n();
  const [seen, setSeen] = useState(active);
  const [connecting, setConnecting] = useState(false);
  const [connectFailed, setConnectFailed] = useState(false);
  const [turnOnFailed, setTurnOnFailed] = useState(false);
  const [turningOn, setTurningOn] = useState(false);
  const { hasConnectedAccount } = useAuthSessionState();
  const feed = useBackendView("email.page", seen && hasConnectedAccount ? {} : "skip");

  useEffect(() => {
    if (active) setSeen(true);
  }, [active]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setConnectFailed(false);
    try {
      const { url } = await backendClient.call("integrations.connectLink", { id: "gmail" });
      openExternalUrl(url);
    } catch {
      setConnectFailed(true);
      setConnecting(false);
    }
  }, []);

  const turnOn = useCallback(async () => {
    setTurningOn(true);
    setTurnOnFailed(false);
    try {
      await backendClient.call("email.setEnabled", { enabled: true });
    } catch {
      setTurnOnFailed(true);
    } finally {
      setTurningOn(false);
    }
  }, []);

  const value = feed.value;
  const hasAccounts = (value?.gmailConnected.length ?? 0) > 0;
  useEffect(() => {
    if (active && value) markEmailSeen();
  }, [active, value]);
  useEffect(() => {
    if (hasAccounts) setConnecting(false);
  }, [hasAccounts]);

  if (!hasConnectedAccount) {
    return (
      <EmptyState
        motif="mail"
        title={t("email.section.connectTitle")}
        body={t("email.section.connectBody")}
        detail={t("global.localMode.needsAccount")}
        action={{ label: t("common.signIn"), icon: LogIn, onClick: SIGN_IN_TOAST_ACTION.onClick }}
      />
    );
  }

  if (!value) {
    if (feed.status === "error" && feed.error.code !== "UNAUTHENTICATED") {
      return <EmptyState motif="mail" title={t("email.section.loadErrorTitle")} body={t("email.section.loadErrorBody")} />;
    }
    return <div className="email-section" aria-busy="true" />;
  }

  if (!hasAccounts) {
    const reconnect = value.needsReconnect;
    return (
      <EmptyState
        motif="mail"
        title={reconnect ? t("email.section.reconnectTitle") : t("email.section.connectTitle")}
        body={reconnect ? t("email.section.reconnectBody") : t("email.section.connectBody")}
        detail={connectFailed ? t("email.section.connectError") : undefined}
        action={{
          label: connecting
            ? t("email.section.connecting")
            : reconnect
              ? t("email.section.reconnect")
              : t("email.section.connect"),
          icon: Mail,
          onClick: () => void connect(),
        }}
      />
    );
  }

  if (!value.enabled) {
    return (
      <EmptyState
        motif="mail"
        title={t("email.section.offTitle")}
        body={t("email.section.offBody")}
        detail={turnOnFailed ? t("email.failed") : undefined}
        action={{
          label: turningOn ? t("email.section.turningOn") : t("email.section.turnOn"),
          onClick: () => {
            if (!turningOn) void turnOn();
          },
        }}
      />
    );
  }

  return <EmailPageFrame state={value} />;
}

