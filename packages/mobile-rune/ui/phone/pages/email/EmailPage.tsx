import { useCallback, useEffect, useState } from "react";
import { markEmailSeen } from "@/features/email/email-unseen";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { backendClient } from "@/platform/backend/backend-client";
import { useBackendView } from "@/platform/backend/use-backend-view";
import { openExternalUrl } from "@/platform/electron/open-external";
import { useT } from "@/shared/i18n";
import { GUTTER } from "../../rn";
import { EmptyState } from "../EmptyState";
import { EmailView } from "./EmailView";
import { Spinner, useEmailColors } from "./kit";

// packages/mobile's EmailPage, pushed over the Apps tab: the sign-in, connect, reconnect and
// turn-on gates, then the triaged inbox (needs you, waiting, handled) and its settings.

function Gate({ active, message, action }: { active: boolean; message: string; action?: { label: string; onPress: () => void } }) {
  return (
    <col grow={1} minH={0} px={GUTTER} pt={4}>
      <EmptyState id="phone-email-empty" motif="mail" message={message} action={action} live={active} />
    </col>
  );
}

export function EmailPage({ active, bottom }: { active: boolean; bottom: number }) {
  const c = useEmailColors();
  const t = useT();
  const { hasConnectedAccount } = useAuthSessionState();
  const feed = useBackendView("email.page", hasConnectedAccount ? {} : "skip", { keepPreviousValue: true });
  const value = feed.value;
  const [waiting, setWaiting] = useState(false);
  const [turningOn, setTurningOn] = useState(false);
  const [connectFailed, setConnectFailed] = useState(false);
  const [turnOnFailed, setTurnOnFailed] = useState(false);
  const connected = (value?.gmailConnected.length ?? 0) > 0;

  useEffect(() => {
    if (!active) return;
    markEmailSeen();
    return () => markEmailSeen();
  }, [active]);

  useEffect(() => {
    if (active && value?.page) markEmailSeen();
  }, [active, value?.page]);

  useEffect(() => {
    if (connected) setWaiting(false);
  }, [connected]);

  const connect = useCallback(async () => {
    setConnectFailed(false);
    try {
      const { url } = await backendClient.call("integrations.connectLink", { id: "gmail" });
      openExternalUrl(url);
      setWaiting(true);
    } catch {
      setConnectFailed(true);
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

  if (!hasConnectedAccount) return <Gate active={active} message={t("mobile.sidebar.signedOutHint")} />;

  if (!value) {
    if (feed.status === "error") return <Gate active={active} message={t("email.section.loadErrorBody")} />;
    return (
      <col id="phone-email-loading" role="status" grow={1} minH={0} align="center" justify="center" pb={bottom}>
        <Spinner color={c.textMuted} />
      </col>
    );
  }

  if (!connected) {
    const reconnect = value.needsReconnect;
    return (
      <Gate
        active={active}
        message={connectFailed ? t("email.section.connectError") : reconnect ? t("email.section.reconnectBody") : t("email.section.connectBody")}
        action={{
          label: waiting ? t("email.section.connecting") : reconnect ? t("email.section.reconnect") : t("email.section.connect"),
          onPress: () => void connect(),
        }}
      />
    );
  }

  if (!value.enabled) {
    return (
      <Gate
        active={active}
        message={turnOnFailed ? t("email.failed") : t("email.section.offBody")}
        action={{
          label: turningOn ? t("email.section.turningOn") : t("email.section.turnOn"),
          onPress: () => {
            if (!turningOn) void turnOn();
          },
        }}
      />
    );
  }

  return <EmailView state={value} bottom={bottom} />;
}
