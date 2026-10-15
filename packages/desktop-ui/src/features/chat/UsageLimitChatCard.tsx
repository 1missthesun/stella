import { useEffect } from "react";
import { Pause, X } from "@/ui/icons";
import { useT } from "@/shared/i18n";
import {
  dismissUsageLimitCard,
  registerUsageLimitCardSurface,
  useUsageLimitCard,
} from "./usage-limit-card";
import "@/features/schedule/schedule-card.css";

/** The chat's usage-limit card, in the message list where the paused reply would be. */
export function UsageLimitChatCard({ conversationId }: { conversationId: string | null | undefined }) {
  const t = useT();
  const card = useUsageLimitCard(conversationId);
  useEffect(() => registerUsageLimitCardSurface(), []);
  if (!card || !conversationId) return null;
  return (
    <div className="event-row event-row--assistant">
      <div className="event-item assistant">
        <div className="schedule-card schedule-card--wrap usage-limit-card" role="status" data-testid="usage-limit-card">
          <span className="schedule-card__tile usage-limit-card__tile" aria-hidden="true">
            <Pause size={16} strokeWidth={2} />
          </span>
          <span className="schedule-card__body">
            <span className="schedule-card__headline">{card.title}</span>
            {card.description || card.resume ? (
              <span className="schedule-card__meta">
                <span className="schedule-card__status">{card.description ?? ""}</span>
                {card.resume ? (
                  <span className="schedule-card__actions">
                    <button
                      type="button"
                      className="schedule-card__button schedule-card__button--primary"
                      onClick={card.resume}
                    >
                      Resume
                    </button>
                  </span>
                ) : null}
              </span>
            ) : null}
          </span>
          <button
            type="button"
            className="schedule-card__dismiss"
            aria-label={t("common.close")}
            onClick={() => dismissUsageLimitCard(conversationId)}
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
