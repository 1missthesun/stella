import { memo, useState, type ReactNode } from "react";
import { EMAIL_REASON_WORDS, type EmailCard, type EmailCardItem } from "@stella/contracts/email-card";
import { useI18n } from "@/shared/i18n";
import { Mail } from "@/ui/icons";
import {
  correctEmail,
  dismissEmail,
  openGmailThread,
  senderName,
  useEmailFeedItems,
} from "./email-items";
import "@/features/schedule/schedule-card.css";
import "./email-card.css";

const COLLAPSED_ROWS = 3;

type Settled = "moved" | "dismissed";

function useItemSettled(itemId: string): [Settled | null, (next: Settled) => void] {
  const { items } = useEmailFeedItems();
  const [local, setLocal] = useState<Settled | null>(null);
  const item = items?.get(itemId);
  const fromFeed: Settled | null =
    item?.state === "dismissed"
      ? "dismissed"
      : item?.corrected && item.bucket !== "urgent"
        ? "moved"
        : null;
  return [local ?? fromFeed, setLocal];
}

function useRun() {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const run = (action: () => Promise<unknown>, onDone: () => void) => {
    setBusy(true);
    setFailed(false);
    void action()
      .then(onDone)
      .catch(() => setFailed(true))
      .finally(() => setBusy(false));
  };
  return { busy, failed, run };
}

function Shell({
  kind,
  headline,
  status,
  trailing,
  children,
}: {
  kind: EmailCard["kind"];
  headline: string;
  status: ReactNode;
  trailing?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div
      className={`schedule-card email-card${children ? " email-card--list" : ""}`}
      data-kind={kind}
      data-testid="email-card"
    >
      <span className="schedule-card__tile" aria-hidden="true">
        <Mail size={16} strokeWidth={1.9} />
      </span>
      <span className="schedule-card__body">
        <span className="schedule-card__headline" title={headline}>
          {headline}
        </span>
        {status || trailing ? (
          <span className="schedule-card__meta">
            <span className="schedule-card__status">{status}</span>
            {trailing}
          </span>
        ) : null}
        {children}
      </span>
    </div>
  );
}

function UrgentCard({ card, item }: { card: EmailCard; item: EmailCardItem }) {
  const { t } = useI18n();
  const [settled, settle] = useItemSettled(item.itemId);
  const { busy, failed, run } = useRun();
  const { showAccounts } = useEmailFeedItems();
  const line = [item.line || EMAIL_REASON_WORDS[item.reason], showAccounts ? item.account : null]
    .filter(Boolean)
    .join(" · ");
  const trailing = settled ? (
    <span className="schedule-card__settled">
      {settled === "moved" ? t("email.card.movedToSummary") : t("email.card.wontShow")}
    </span>
  ) : (
    <span className="schedule-card__actions">
      <button
        type="button"
        className="schedule-card__button"
        disabled={busy}
        onClick={() => run(() => correctEmail(item.itemId, "needs_you"), () => settle("moved"))}
      >
        {t("email.notUrgent")}
      </button>
      <button
        type="button"
        className="schedule-card__button schedule-card__button--primary"
        onClick={() => openGmailThread(item.threadId, item.account)}
      >
        {t("common.open")}
      </button>
    </span>
  );
  return (
    <Shell
      kind={card.kind}
      headline={`${senderName(item.from)} · ${item.subject}`}
      status={<span title={line}>{failed ? t("email.failed") : line}</span>}
      trailing={trailing}
    />
  );
}

function RuleCard({ card, item }: { card: EmailCard; item: EmailCardItem }) {
  const { t } = useI18n();
  const { showAccounts } = useEmailFeedItems();
  const what = [item.line || item.subject, showAccounts ? item.account : null].filter(Boolean).join(" · ");
  return (
    <Shell
      kind={card.kind}
      headline={card.ruleText ?? senderName(item.from)}
      status={
        <span title={`${item.from}\n${item.subject}${item.line ? `\n${item.line}` : ""}`}>
          <span className="email-card__from">{senderName(item.from)}</span> {what}
        </span>
      }
      trailing={
        <span className="schedule-card__actions">
          <button
            type="button"
            className="schedule-card__button schedule-card__button--primary"
            onClick={() => openGmailThread(item.threadId, item.account)}
          >
            {t("common.open")}
          </button>
        </span>
      }
    />
  );
}

function SummaryRow({ item }: { item: EmailCardItem }) {
  const { t } = useI18n();
  const { showAccounts } = useEmailFeedItems();
  const [settled, settle] = useItemSettled(item.itemId);
  const { busy, failed, run } = useRun();
  const dismissed = settled === "dismissed";
  return (
    <li className="email-card__row" data-dismissed={dismissed || undefined}>
      <button
        type="button"
        className="email-card__open"
        title={item.from}
        onClick={() => openGmailThread(item.threadId, item.account)}
      >
        <span className="email-card__n">{item.n}</span>
        <span className="email-card__text">
          <span className="email-card__head">
            <span className="email-card__from">{senderName(item.from)}</span>
            <span className="email-card__subject">
              {showAccounts && item.account ? `${item.subject} · ${item.account}` : item.subject}
            </span>
          </span>
          {item.line ? <span className="email-card__line">{item.line}</span> : null}
        </span>
      </button>
      {dismissed ? (
        <span className="email-card__row-note">{t("email.card.wontShow")}</span>
      ) : (
        <button
          type="button"
          className="email-card__row-action"
          disabled={busy}
          data-failed={failed || undefined}
          onClick={() => run(() => dismissEmail(item.itemId), () => settle("dismissed"))}
        >
          {failed ? t("email.failed") : t("email.notImportant")}
        </button>
      )}
    </li>
  );
}

function SummaryCard({ card }: { card: EmailCard }) {
  const { t, tPlural } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const needYou = card.items.filter((item) => item.bucket === "urgent" || item.bucket === "needs_you").length;
  const worth = card.items.length - needYou;
  const headline = [
    needYou > 0 ? tPlural("email.card.needYou", needYou) : null,
    worth > 0 ? tPlural("email.card.worthKnowing", worth) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const shown = expanded ? card.items : card.items.slice(0, COLLAPSED_ROWS);
  const hidden = card.items.length - COLLAPSED_ROWS;
  return (
    <Shell
      kind={card.kind}
      headline={headline}
      status={card.noiseCount ? tPlural("email.card.skipped", card.noiseCount) : null}
    >
      <ol className="email-card__rows">
        {shown.map((item) => (
          <SummaryRow key={item.itemId} item={item} />
        ))}
      </ol>
      {hidden > 0 ? (
        <button
          type="button"
          className="schedule-card__button email-card__more"
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? t("email.card.showLess") : t("email.card.showAll", { count: card.items.length })}
        </button>
      ) : null}
    </Shell>
  );
}

export const EmailChatCard = memo(function EmailChatCard({ card }: { card: EmailCard }) {
  const first = card.items[0];
  if (!first) return null;
  if (card.kind === "urgent") return <UrgentCard card={card} item={first} />;
  if (card.kind === "rule") return <RuleCard card={card} item={first} />;
  return <SummaryCard card={card} />;
});
