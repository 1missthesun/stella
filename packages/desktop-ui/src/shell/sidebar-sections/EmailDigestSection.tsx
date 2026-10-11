import { useCallback, useEffect, useState } from "react";
import type { EmailDigest } from "@stella/contracts/backend/email-digest";
import { ago, useNow } from "@/features/app-source/AppSourceCards";
import { backendClient } from "@/platform/backend/backend-client";
import {
  useBackendAccountEpoch,
  useBackendView,
} from "@/platform/backend/use-backend-view";
import { openExternalUrl } from "@/platform/electron/open-external";
import { useLocale, useT } from "@/shared/i18n";
import { EmptyState } from "@/ui/empty-state/EmptyState";
import { Check, LoaderCircle, Mail } from "@/ui/icons";
import "./email-digest-section.css";

const GMAIL_ID = "gmail";

type Connection = "checking" | "connected" | "disconnected" | "unavailable";

const threadUrl = (threadId: string) =>
  `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(threadId)}`;

const connectGmail = async (): Promise<boolean> => {
  const api = window.electronAPI?.nativeIntegrations;
  if (api?.enable) return (await api.enable({ id: GMAIL_ID })).enabled;
  const { url } = await backendClient.call("integrations.connectLink", {
    id: GMAIL_ID,
  });
  openExternalUrl(url);
  return false;
};

function DigestGroup({
  digest,
  now,
}: {
  digest: EmailDigest;
  now: number;
}) {
  const t = useT();
  const locale = useLocale();
  return (
    <section className="email-digest__group" data-testid="email-digest">
      <h2 className="email-digest__heading">
        {now - digest.createdAt < 60_000
          ? t("shell.emailDigest.justNow")
          : ago(locale, digest.createdAt, now)}
      </h2>
      <ul className="email-digest__list">
        {digest.items.map((item, index) => {
          const open = item.threadId
            ? () => openExternalUrl(threadUrl(item.threadId!))
            : undefined;
          return (
            <li key={`${digest.digestId}:${index}`}>
              <button
                type="button"
                className="email-digest__item"
                disabled={!open}
                onClick={open}
              >
                <span className="email-digest__from" title={item.from}>
                  {item.from.replace(/\s*<[^>]*>\s*$/u, "")}
                </span>
                <span className="email-digest__summary">{item.summary}</span>
                <span className="email-digest__subject" title={item.subject}>
                  {item.subject}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function EmailDigestSection({ active }: { active: boolean }) {
  const t = useT();
  const locale = useLocale();
  const now = useNow();
  const epoch = useBackendAccountEpoch();
  const [seen, setSeen] = useState(active);
  const [connection, setConnection] = useState<Connection>("checking");
  const [connecting, setConnecting] = useState(false);
  const [connectFailed, setConnectFailed] = useState(false);
  const [checking, setChecking] = useState(false);
  const feed = useBackendView("emailDigest.feed", seen ? {} : "skip");

  useEffect(() => {
    if (active) setSeen(true);
  }, [active]);

  const refresh = useCallback(async () => {
    try {
      const { connected } = await backendClient.call("emailDigest.start", {});
      setConnection(connected ? "connected" : "disconnected");
    } catch {
      setConnection("unavailable");
    }
  }, []);

  const liveEnabled = feed.value?.status.enabled;
  const liveCheckedAt = feed.value?.status.lastCheckedAt;

  useEffect(() => {
    if (active) void refresh();
  }, [active, epoch, refresh, liveEnabled, liveCheckedAt]);

  const connect = useCallback(async () => {
    setConnecting(true);
    setConnectFailed(false);
    try {
      await connectGmail();
      await refresh();
    } catch {
      setConnectFailed(true);
    } finally {
      setConnecting(false);
    }
  }, [refresh]);

  const checkNow = useCallback(async () => {
    setChecking(true);
    try {
      await backendClient.call("emailDigest.checkNow", {});
    } catch {
    } finally {
      setChecking(false);
    }
  }, []);

  const value = feed.value;
  const status = value?.status;
  const digests = value?.digests ?? [];

  if (connection === "checking" && !value) {
    return <div className="email-digest" aria-busy="true" />;
  }

  if (connection === "disconnected" || connection === "unavailable") {
    return (
      <EmptyState
        motif="mail"
        title={t("shell.emailDigest.connectTitle")}
        body={t("shell.emailDigest.connectBody")}
        detail={
          connectFailed
            ? t("shell.emailDigest.connectError")
            : connection === "unavailable"
              ? t("shell.emailDigest.unavailable")
              : undefined
        }
        action={{
          label: connecting
            ? t("shell.emailDigest.connecting")
            : t("shell.emailDigest.connect"),
          icon: Mail,
          onClick: () => {
            if (!connecting) void connect();
          },
        }}
      />
    );
  }

  const running = status?.running || checking;
  const latestDigestAt = digests[0]?.createdAt ?? 0;
  const quiet =
    !running &&
    status?.lastCheckedAt !== undefined &&
    status.lastCheckedAt > latestDigestAt &&
    (status.lastOutcome === "nothing_new" ||
      status.lastOutcome === "nothing_important");

  return (
    <div className="email-digest sidebar-section__scroll" data-testid="email-digest-section">
      <div className="email-digest__bar">
        <div className="email-digest__status" role="status">
          {running ? (
            <>
              <LoaderCircle
                className="stella-loader-circle"
                size={13}
                strokeWidth={2}
                aria-hidden="true"
              />
              {t("shell.emailDigest.checking")}
            </>
          ) : status?.lastCheckedAt !== undefined ? (
            t("shell.emailDigest.checked", {
              when: ago(locale, status.lastCheckedAt, now),
            })
          ) : (
            t("shell.emailDigest.firstDigest")
          )}
        </div>
        <button
          type="button"
          className="email-digest__button"
          disabled={running}
          onClick={() => void checkNow()}
        >
          {t("shell.emailDigest.checkNow")}
        </button>
      </div>
      {quiet ? (
        <div className="email-digest__quiet" data-testid="email-digest-quiet">
          <Check size={14} strokeWidth={2} aria-hidden="true" />
          {t("shell.emailDigest.nothingNew")}
        </div>
      ) : null}
      {status?.lastOutcome === "error" && status.lastError && !running ? (
        <div className="email-digest__quiet" data-tone="error" role="alert">
          {t("shell.emailDigest.error")}
        </div>
      ) : null}
      {digests.map((digest) => (
        <DigestGroup key={digest.digestId} digest={digest} now={now} />
      ))}
    </div>
  );
}
