import { useCallback, useEffect, useState } from "react";
import { markEmailSeen } from "@/features/email/email-unseen";
import type { EmailFeed, EmailRule } from "@stella/contracts/backend/email";
import { EmailDigestPanel } from "@/features/email/EmailDigest";
import { backendClient } from "@/platform/backend/backend-client";
import { useBackendView } from "@/platform/backend/use-backend-view";
import { openExternalUrl } from "@/platform/electron/open-external";
import { useI18n } from "@/shared/i18n";
import { EmptyState } from "@/ui/empty-state/EmptyState";
import { LogIn, Mail } from "@/ui/icons";
import { useAuthSessionState } from "@/global/auth/hooks/use-auth-session-state";
import { SIGN_IN_TOAST_ACTION } from "@/shared/lib/auth-cta";
import "./email-section.css";

const errorText = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message ? error.message : fallback;

function NoteEditor({ note }: { note: string }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(note);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failed, setFailed] = useState(false);
  const [base, setBase] = useState(note);

  useEffect(() => {
    if (note === base) return;
    setDraft((current) => (current === base ? note : current));
    setBase(note);
  }, [base, note]);

  const dirty = draft.trim() !== note.trim();
  const save = async () => {
    setSaving(true);
    setFailed(false);
    try {
      const result = await backendClient.call("email.setNote", { note: draft.trim() });
      setBase(result.note);
      setDraft(result.note);
      setSaved(true);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="email-section__group">
      <h2 className="email-section__heading">{t("email.section.noteTitle")}</h2>
      <textarea
        className="email-section__note"
        value={draft}
        rows={3}
        placeholder={t("email.section.notePlaceholder")}
        onChange={(event) => {
          setDraft(event.target.value);
          setSaved(false);
        }}
      />
      {dirty || saved || failed ? (
        <div className="email-section__row-end">
          <span className="email-section__muted">
            {failed ? t("email.failed") : saved && !dirty ? t("email.section.saved") : null}
          </span>
          {dirty ? (
            <button
              type="button"
              className="pill-btn pill-btn--primary"
              disabled={saving}
              onClick={() => void save()}
            >
              {t("common.save")}
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Rules({ rules }: { rules: EmailRule[] }) {
  const { t } = useI18n();
  const [removing, setRemoving] = useState<string | null>(null);
  const remove = (ruleId: string) => {
    setRemoving(ruleId);
    void backendClient
      .call("email.removeRule", { ruleId })
      .catch(() => undefined)
      .finally(() => setRemoving(null));
  };
  return (
    <section className="email-section__group">
      <h2 className="email-section__heading">{t("email.section.rulesTitle")}</h2>
      {rules.length > 0 ? (
        <ul className="email-section__list">
          {rules.map((rule) => (
            <li key={rule.ruleId} className="email-section__rule" data-testid="email-rule">
              <span className="email-section__rule-text">
                <span>{rule.text}</span>
                <span className="email-section__muted">
                  {rule.action === "act" ? t("email.section.ruleAct") : t("email.section.ruleTell")}
                </span>
              </span>
              <button
                type="button"
                className="email-section__text-button email-section__rule-remove"
                disabled={removing === rule.ruleId}
                onClick={() => remove(rule.ruleId)}
              >
                {t("email.section.remove")}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="email-section__hint">{t("email.section.rulesHint")}</p>
    </section>
  );
}

function Footer({ feed }: { feed: EmailFeed }) {
  const { t, locale } = useI18n();
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [turningOff, setTurningOff] = useState(false);
  const { status } = feed;
  const usage = t("email.section.usage", {
    sorted: new Intl.NumberFormat(locale).format(status.usage.sorted),
    cost: usageCost(locale, status.usage.costUsd),
  });

  const checkNow = async () => {
    setChecking(true);
    setMessage(null);
    try {
      await backendClient.call("email.checkNow", {});
    } catch (error) {
      setMessage(errorText(error, t("email.failed")));
    } finally {
      setChecking(false);
    }
  };

  const turnOff = async () => {
    setTurningOff(true);
    try {
      await backendClient.call("email.setEnabled", { enabled: false });
    } catch (error) {
      setMessage(errorText(error, t("email.failed")));
      setTurningOff(false);
    }
  };

  return (
    <section className="email-section__group">
      <h2 className="email-section__heading">{t("email.section.accountsTitle")}</h2>
      <ul className="email-section__list">
        {status.accounts.map((account) => (
          <li key={account.email} className="email-section__account">
            <span className="email-section__account-email">{account.email}</span>
            <span className="email-section__muted">
              {account.error
                ? t("email.section.accountError")
                : account.live
                  ? t("email.section.live")
                  : t("email.section.polled")}
            </span>
          </li>
        ))}
      </ul>
      <p className="email-section__hint">
        {status.usage.capped ? `${usage}. ${t("email.section.capped")}` : usage}
      </p>
      {message ? <p className="email-section__hint" role="alert">{message}</p> : null}
      {confirmOff ? (
        <div className="email-section__confirm">
          <p className="email-section__hint">{t("email.section.turnOffConfirm")}</p>
          <div className="email-section__buttons">
            <button
              type="button"
              className="pill-btn pill-btn--danger"
              disabled={turningOff}
              onClick={() => void turnOff()}
            >
              {t("email.section.turnOff")}
            </button>
            <button type="button" className="email-section__text-button" onClick={() => setConfirmOff(false)}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <div className="email-section__buttons">
          <button type="button" className="pill-btn" disabled={checking} onClick={() => void checkNow()}>
            {checking ? t("email.section.checking") : t("email.section.checkNow")}
          </button>
          <button type="button" className="email-section__text-button" onClick={() => setConfirmOff(true)}>
            {t("email.section.turnOff")}
          </button>
        </div>
      )}
    </section>
  );
}

function SortedMail({ feed, active }: { feed: EmailFeed; active: boolean }) {
  const showAccount = feed.status.accounts.length > 1;
  const waiting = feed.items.filter(
    (item) => item.state === "waiting" && item.bucket !== "noise",
  );
  return (
    <div className="email-section sidebar-section__scroll" data-testid="email-section">
      <EmailDigestPanel
        active={active}
        enabled
        waiting={waiting}
        showAccount={showAccount}
        settings={
          <div className="email-section__settings">
            <NoteEditor note={feed.note} />
            <Rules rules={feed.rules} />
            <Footer feed={feed} />
          </div>
        }
      />
    </div>
  );
}

export function EmailSection({ active }: { active: boolean }) {
  const { t } = useI18n();
  const [seen, setSeen] = useState(active);
  const [connecting, setConnecting] = useState(false);
  const [connectFailed, setConnectFailed] = useState(false);
  const [turnOnFailed, setTurnOnFailed] = useState(false);
  const [turningOn, setTurningOn] = useState(false);
  const { hasConnectedAccount } = useAuthSessionState();
  const feed = useBackendView("email.feed", seen && hasConnectedAccount ? {} : "skip");

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
  const hasAccounts = (value?.status.gmailConnected?.length ?? 0) > 0;
  // Looking at the section clears the unseen badge, including mail that arrives while it is open.
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
    if (feed.status === "error") {
      return <EmptyState motif="mail" title={t("email.section.loadErrorTitle")} body={t("email.section.loadErrorBody")} />;
    }
    return <div className="email-section" aria-busy="true" />;
  }

  if (!hasAccounts) {
    const reconnect = value.status.needsReconnect;
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

  if (!value.status.enabled) {
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

  return <SortedMail feed={value} active={active} />;
}

/** A month's sorting usually costs a fraction of a cent; show that as "<$0.01", not "$0.00". */
function usageCost(locale: string, usd: number): string {
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "USD", minimumFractionDigits: 2 });
  return usd > 0 && usd < 0.01 ? `<${money.format(0.01)}` : money.format(usd);
}
