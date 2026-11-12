import { memo } from "react";
import type { EmailCard } from "@stella/contracts/email-card";
import { useI18n } from "@/shared/i18n";
import { Mail } from "@/ui/icons";
import { openEmailDigest } from "./email-digest-store";
import "./email-card.css";

/**
 * Email in the chat is one tiny row: a count, never the mail itself. Opening
 * it shows the digest in the Email tab; Stella keeps the list in hidden context.
 */
export const EmailChatCard = memo(function EmailChatCard({ card }: { card: EmailCard }) {
  const { t, tPlural } = useI18n();
  const count = card.items.length;
  if (count === 0) return null;
  const urgent = card.kind === "urgent";
  const label = urgent
    ? tPlural("email.row.urgent", count)
    : card.kind === "rule"
      ? tPlural("email.row.asked", count)
      : tPlural("email.row.new", count);
  return (
    <button
      type="button"
      className="email-row"
      data-kind={card.kind}
      data-testid="email-card"
      aria-label={`${t("email.title")}: ${label}`}
      title={t("email.row.open")}
      onClick={() => openEmailDigest(card.cardId)}
    >
      <Mail size={13} strokeWidth={1.9} className="email-row__icon" aria-hidden="true" />
      {urgent ? <span className="email-row__dot" aria-hidden="true" /> : null}
      <span className="email-row__label">{label}</span>
    </button>
  );
});
