import { memo, useState, type ReactNode } from "react";
import { EMAIL_REASON_WORDS, type EmailCard, type EmailCardItem } from "@stella/contracts/email-card";
import { useI18n } from "@/shared/i18n";
import { ChevronDown, Mail } from "@/ui/icons";
import {
  correctEmail,
  dismissEmail,
  openGmailThread,
  senderName,
  useEmailFeedItems,
} from "./email-items";
import "@/features/schedule/schedule-card.css";
import "./email-card.css";

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

/**
 * Email in the chat is one quiet line: urgent mail says who and the point, a
 * summary says how many need you; the summary's numbered list opens in place.
 */
function Line({
  kind,
  label,
  from,
  text,
  title,
  actions,
  expanded,
  onToggle,
  children,
}: {
  kind: EmailCard["kind"];
  label?: string;
  from?: string;
  text: ReactNode;
  title?: string;
  actions?: ReactNode;
  expanded?: boolean;
  onToggle?: () => void;
  children?: ReactNode;
}) {
  const body = (
    <>
      <Mail size={14} strokeWidth={1.9} className="email-line__icon" aria-hidden="true" />
      {label ? <span className="email-line__label">{label}</span> : null}
      {from ? <span className="email-line__from">{from}</span> : null}
      <span className="email-line__text">{text}</span>
      {onToggle ? <ChevronDown size={14} strokeWidth={1.9} className="email-line__chevron" aria-hidden="true" /> : null}
    </>
  );
  return (
    <div className="email-line" data-kind={kind} data-expanded={expanded || undefined} data-testid="email-card">
      <div className="email-line__bar" title={title}>
        {onToggle ? (
          <button type="button" className="email-line__main" aria-expanded={expanded} onClick={onToggle}>
            {body}
          </button>
        ) : (
          <span className="email-line__main">{body}</span>
        )}
        {actions ? <span className="email-line__actions">{actions}</span> : null}
      </div>
      {expanded ? children : null}
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
  const actions = settled ? (
    <span className="email-line__settled">
      {settled === "moved" ? t("email.card.movedToSummary") : t("email.card.wontShow")}
    </span>
  ) : (
    <>
      <button
        type="button"
        className="schedule-card__button email-line__hover-action"
        disabled={busy}
        onClick={() => run(() => correctEmail(item.itemId, "needs_you"), () => settle("moved"))}
      >
        {failed ? t("email.failed") : t("email.notUrgent")}
      </button>
      <button
        type="button"
        className="schedule-card__button schedule-card__button--primary"
        onClick={() => openGmailThread(item.threadId, item.account)}
      >
        {t("common.open")}
      </button>
    </>
  );
  return (
    <Line
      kind={card.kind}
      label={settled ? undefined : t("email.section.urgent")}
      from={senderName(item.from)}
      text={line}
      title={`${item.from}\n${item.subject}\n${line}`}
      actions={actions}
    />
  );
}

function RuleCard({ card, item }: { card: EmailCard; item: EmailCardItem }) {
  const { t } = useI18n();
  const { showAccounts } = useEmailFeedItems();
  const what = [item.line || item.subject, showAccounts ? item.account : null].filter(Boolean).join(" · ");
  return (
    <Line
      kind={card.kind}
      from={senderName(item.from)}
      text={what}
      title={`${card.ruleText ?? ""}\n\n${item.from}\n${item.subject}`}
      actions={
        <button
          type="button"
          className="schedule-card__button schedule-card__button--primary"
          onClick={() => openGmailThread(item.threadId, item.account)}
        >
          {t("common.open")}
        </button>
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
    <li
      className="email-card__row"
      data-dismissed={dismissed || undefined}
      data-needs-you={item.bucket === "urgent" || item.bucket === "needs_you" || undefined}
    >
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
  const { tPlural } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const needYou = card.items.filter((item) => item.bucket === "urgent" || item.bucket === "needs_you").length;
  const worth = card.items.length - needYou;
  const counts = [
    needYou > 0 ? tPlural("email.card.needYou", needYou) : null,
    worth > 0 ? tPlural("email.card.worthKnowing", worth) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const senders = [...new Set(card.items.map((item) => senderName(item.from)))].slice(0, 3).join(", ");
  return (
    <Line
      kind={card.kind}
      text={
        <>
          {counts}
          {senders ? <span className="email-line__muted"> · {senders}</span> : null}
          {card.noiseCount ? (
            <span className="email-line__muted"> · {tPlural("email.card.skipped", card.noiseCount)}</span>
          ) : null}
        </>
      }
      expanded={expanded}
      onToggle={() => setExpanded((open) => !open)}
    >
      <ol className="email-card__rows email-line__rows">
        {card.items.map((item) => (
          <SummaryRow key={item.itemId} item={item} />
        ))}
      </ol>
    </Line>
  );
}

export const EmailChatCard = memo(function EmailChatCard({ card }: { card: EmailCard }) {
  const first = card.items[0];
  if (!first) return null;
  if (card.kind === "urgent") return <UrgentCard card={card} item={first} />;
  if (card.kind === "rule") return <RuleCard card={card} item={first} />;
  return <SummaryCard card={card} />;
});
