import { AlertCircle } from "@/ui/icons";
import { useSafeguardCard } from "./safeguard-card";
import "@/features/schedule/schedule-card.css";

/** The chat's safety-block card, in the message list where the stopped reply would be. */
export function SafeguardChatCard({
  conversationId,
  replying,
}: {
  conversationId: string | null | undefined;
  replying: boolean;
}) {
  const card = useSafeguardCard(conversationId);
  if (!card || !conversationId || replying) return null;
  const { notice, pending } = card;
  const working = pending !== undefined;
  return (
    <div className="event-row event-row--assistant">
      <div className="event-item assistant">
        <div className="schedule-card schedule-card--wrap safeguard-card" role="status" data-testid="safeguard-card">
          <span className="schedule-card__tile usage-limit-card__tile" aria-hidden="true">
            <AlertCircle size={16} strokeWidth={2} />
          </span>
          <span className="schedule-card__body">
            <span className="schedule-card__headline">{notice.title}</span>
            <span className="schedule-card__status safeguard-card__text">{card.problem ?? notice.description}</span>
            <span className="schedule-card__actions safeguard-card__actions">
              <button
                type="button"
                className="schedule-card__button schedule-card__button--primary"
                data-testid="safeguard-remove"
                disabled={working}
                onClick={() => card.choose("remove")}
              >
                {pending === "remove" ? "Removing…" : notice.remove.label}
              </button>
              {notice.switchTo ? (
                <button
                  type="button"
                  className="schedule-card__button"
                  data-testid="safeguard-switch"
                  disabled={working}
                  onClick={() => card.choose("switch")}
                >
                  {pending === "switch" ? "Switching…" : notice.switchTo.actionLabel}
                </button>
              ) : null}
              {notice.clear ? (
                <button
                  type="button"
                  className="schedule-card__button"
                  data-testid="safeguard-clear"
                  disabled={working}
                  onClick={() => card.choose("clear")}
                >
                  {pending === "clear" ? "Starting fresh…" : notice.clear.label}
                </button>
              ) : null}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
