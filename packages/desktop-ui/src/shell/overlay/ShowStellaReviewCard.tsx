import { useEffect, useRef, useState } from "react";
import type {
  ShowStellaReviewAction,
  ShowStellaReviewState,
} from "@stella/contracts/desktop/show-stella";
import { ArrowUp, X } from "@/ui/icons";
import { useT } from "@/shared/i18n";

/** A finish card nobody touches goes to the composer after this. */
const KEEP_AFTER_MS = 20_000;
const CARD_WIDTH = 360;
const CARD_TOP = 14;

const clock = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

/**
 * Shown when a capture ends while another app is in front: Stella stays in
 * the background, and the capture can be sent with a note, opened in Stella,
 * or thrown away from here.
 */
export function ShowStellaReviewCard({
  state,
  onHover,
}: {
  state: ShowStellaReviewState;
  onHover: (hovered: boolean) => void;
}) {
  const t = useT();
  const [note, setNote] = useState("");
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const answered = useRef(false);
  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;
  const madeFocusable = useRef(false);
  const ready = state.status !== "preparing";
  const engaged = hovered || focused || note.trim().length > 0;

  const answer = (action: ShowStellaReviewAction) => {
    if (answered.current) return;
    answered.current = true;
    onHover(false);
    void window.electronAPI?.showStella?.review(action);
  };

  useEffect(() => {
    if (!ready || engaged) return;
    const timer = setTimeout(
      () => answer({ captureId: state.captureId, action: "keep" }),
      KEEP_AFTER_MS,
    );
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- answer only reads refs and props
  }, [ready, engaged, state.captureId]);

  useEffect(() => () => onHoverRef.current(false), []);

  const top = Math.max(state.display.y, 0) + CARD_TOP;
  const left = state.display.x + state.display.width / 2 - CARD_WIDTH / 2;
  const send = () => answer({ captureId: state.captureId, action: "send", note });

  return (
    <div
      className="show-stella-review"
      style={{ left, top, width: CARD_WIDTH }}
      onMouseEnter={() => {
        setHovered(true);
        onHover(true);
        if (!madeFocusable.current) {
          // Typing a note needs keys; the overlay panel takes them without bringing Stella forward.
          madeFocusable.current = true;
          window.electronAPI?.showStella?.setReviewFocusable({ focusable: true });
        }
      }}
      onMouseLeave={() => {
        setHovered(false);
        onHover(false);
      }}
    >
      <div className="show-stella-review__head">
        <div className="show-stella-review__thumb">
          {state.preview ? <img src={state.preview} alt={t("app.chat.contextChips.showCapture.alt")} /> : null}
        </div>
        <div className="show-stella-review__meta">
          <span className="show-stella-review__title">
            {t("app.chat.contextChips.showCapture.title", { duration: clock(state.durationMs) })}
          </span>
          {state.status === "preparing" && (
            <span className="show-stella-review__status">
              {t("app.chat.contextChips.showCapture.preparing")}
            </span>
          )}
          {state.status === "failed" && (
            <span className="show-stella-review__status">
              {t("app.chat.contextChips.showCapture.failed")}
            </span>
          )}
        </div>
        <button
          type="button"
          className="show-stella-review__discard"
          aria-label={t("features.showStella.review.discard")}
          title={t("features.showStella.review.discard")}
          onClick={() => answer({ captureId: state.captureId, action: "discard" })}
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>
      <div className="show-stella-review__note">
        <input
          value={note}
          placeholder={t("features.showStella.review.note")}
          onChange={(event) => setNote(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send();
            }
          }}
        />
      </div>
      <div className="show-stella-review__actions">
        <button
          type="button"
          className="show-stella-review__open"
          onClick={() => answer({ captureId: state.captureId, action: "open" })}
        >
          {t("features.showStella.review.open")}
        </button>
        <button
          type="button"
          className="show-stella-review__send"
          disabled={state.status === "failed"}
          onClick={send}
        >
          {t("features.showStella.review.send")}
          <ArrowUp size={13} strokeWidth={2.25} />
        </button>
      </div>
    </div>
  );
}
