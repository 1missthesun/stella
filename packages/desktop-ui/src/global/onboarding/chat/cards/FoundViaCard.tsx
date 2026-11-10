import { useState } from "react";
import { Button } from "@/ui/button";
import { Search } from "@/ui/icons";
import { useT } from "@/shared/i18n";
import { uiState } from "@/platform/ui-state";
import {
  FOUND_VIA_ANSWERS,
  isFoundViaChoice,
  type FoundViaAnswer,
  type FoundViaChoice,
} from "@stella/contracts/telemetry/anonymous-counts";
import { recordAnonymousCount } from "@/features/anonymous-counts/record-anonymous-count";
import type { OnboardingChatAnswer } from "../onboarding-chat-flow";

type FoundViaCardProps = {
  active: boolean;
  answered: OnboardingChatAnswer | undefined;
  onAnswer: (answer: OnboardingChatAnswer) => void;
};

const CHOICE_KEY = "stella-onboarding-found-via";

const readChoice = (): FoundViaChoice | null => {
  const value = uiState.getItem(CHOICE_KEY);
  return isFoundViaChoice(value) ? value : null;
};

/** "How did you find Stella?": optional, one tap plus Continue, or Skip. Sent only as an anonymous count. */
export function FoundViaCard({ active, answered, onAnswer }: FoundViaCardProps) {
  const t = useT();
  const [selected, setSelected] = useState<FoundViaAnswer | null>(null);

  const submit = (choice: FoundViaChoice) => {
    uiState.setItem(CHOICE_KEY, choice);
    recordAnonymousCount({ type: "found_via", answer: choice });
    onAnswer(choice === "skipped" ? "skipped" : "done");
  };

  if (answered !== undefined) {
    const choice = readChoice();
    return (
      <div className="obc-card" data-settled>
        <span className="obc-card__settled-icon">
          <Search size={15} />
        </span>
        <span className="obc-card__settled-text">
          <span className="obc-card__settled-title">
            {t("onboarding.chat.foundVia.settledTitle")}
          </span>
          <span className="obc-card__settled-desc">
            {choice && choice !== "skipped"
              ? t(`onboarding.chat.foundVia.answers.${choice}`)
              : t("onboarding.chat.foundVia.settledSkipped")}
          </span>
        </span>
      </div>
    );
  }

  return (
    <div className="obc-card">
      <div className="obc-card__section">
        <h3 className="obc-card__title">{t("onboarding.chat.foundVia.title")}</h3>
        <p className="obc-card__body">{t("onboarding.chat.foundVia.body")}</p>
      </div>

      <div
        className="obc-pills"
        role="radiogroup"
        aria-label={t("onboarding.chat.foundVia.title")}
      >
        {FOUND_VIA_ANSWERS.map((choice) => (
          <button
            key={choice}
            type="button"
            role="radio"
            aria-checked={selected === choice}
            className="obc-pill"
            data-active={selected === choice}
            disabled={!active}
            onClick={() => setSelected(choice)}
          >
            {t(`onboarding.chat.foundVia.answers.${choice}`)}
          </button>
        ))}
      </div>

      <div className="obc-actions">
        <Button
          type="button"
          variant="primary"
          disabled={!active || selected === null}
          onClick={() => selected && submit(selected)}
        >
          {t("common.continue")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={!active}
          onClick={() => submit("skipped")}
        >
          {t("onboarding.chat.foundVia.skip")}
        </Button>
      </div>
    </div>
  );
}
