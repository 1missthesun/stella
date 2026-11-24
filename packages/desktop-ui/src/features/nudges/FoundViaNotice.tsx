import { Search, X } from "@/ui/icons";
import { useT } from "@/shared/i18n";
import { uiState } from "@/platform/ui-state";
import {
  FOUND_VIA_ANSWERS,
  type FoundViaChoice,
} from "@stella/contracts/telemetry/anonymous-counts";
import { recordAnonymousCount } from "@/features/anonymous-counts/record-anonymous-count";
import { FOUND_VIA_CHOICE_KEY, finishNudge } from "./usage-nudges-store";
import "@/app/chat/composer-notice.css";
import "./nudges.css";

const answer = (choice: FoundViaChoice, close: () => void) => {
  uiState.setItem(FOUND_VIA_CHOICE_KEY, choice);
  recordAnonymousCount({ type: "found_via", answer: choice });
  finishNudge("foundVia");
  close();
};

export function FoundViaNotice({
  compact,
  onClose,
}: {
  compact: boolean;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <div
      className={`composer-notice composer-notice--found-via${compact ? " composer-notice--compact" : ""}`}
      role="group"
      aria-label={t("nudges.foundVia.title")}
      data-testid="found-via-notice"
    >
      <div className="composer-notice__icon" aria-hidden>
        <Search size={compact ? 14 : 16} />
      </div>
      <div className="composer-notice__body">
        <p className="composer-notice__title">{t("nudges.foundVia.title")}</p>
        <p className="composer-notice__sub">{t("nudges.foundVia.body")}</p>
        <div className="nudge-pills">
          {FOUND_VIA_ANSWERS.map((choice) => (
            <button
              key={choice}
              type="button"
              className="nudge-pill"
              onClick={() => answer(choice, onClose)}
            >
              {t(`nudges.foundVia.answers.${choice}`)}
            </button>
          ))}
        </div>
      </div>
      <button
        type="button"
        className="composer-notice__dismiss"
        aria-label={t("nudges.foundVia.skip")}
        onClick={() => answer("skipped", onClose)}
      >
        <X size={14} />
      </button>
    </div>
  );
}
