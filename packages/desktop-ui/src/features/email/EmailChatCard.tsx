import { memo } from "react";
import type { EmailCard } from "@stella/contracts/email-card";
import { useI18n } from "@/shared/i18n";
import { Mail } from "@/ui/icons";
import { openEmailDigest } from "./email-digest-store";
import { useEmailFeature } from "./email-feature";
import "./email-card.css";

/**
 * Email in the chat is one row the size of a reply: a mail icon and how much
 * came in, never the mail itself. Opening it shows the briefing in the Email
 * tab; Stella keeps the list in hidden context.
 */
export const EmailChatCard = memo(function EmailChatCard({ card }: { card: EmailCard }) {
  const { t, tPlural } = useI18n();
  const on = useEmailFeature();
  const count = card.items.length;
  if (count === 0 || !on) return null;
  const urgent = card.items.filter((item) => item.bucket === "urgent").length;
  const label =
    card.kind === "rule"
      ? tPlural("email.row.askedEmails", count)
      : card.kind === "urgent"
        ? tPlural("email.row.urgentEmails", count)
        : urgent > 0
          ? `${tPlural("email.row.urgent", urgent)} · ${tPlural("email.row.newEmails", count)}`
          : tPlural("email.row.newEmails", count);
  return (
    <div className="message-line message-line--assistant">
      <button
        type="button"
        className="email-row"
        data-kind={card.kind}
        data-urgent={card.kind === "urgent" || urgent > 0 || undefined}
        data-testid="email-card"
        aria-label={`${t("email.title")}: ${label}`}
        title={t("email.row.open")}
        onClick={() => openEmailDigest(card.cardId)}
      >
        <Mail size={18} strokeWidth={1.8} className="email-row__icon" aria-hidden="true" />
        <span className="email-row__label">{label}</span>
      </button>
    </div>
  );
});
