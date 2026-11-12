import { Button } from "@/ui/button";
import { Wand2 } from "@/ui/icons";
import { useT } from "@/shared/i18n";
import {
  DemoPlayerControls,
  filmStartAt,
  useDemoPlayer,
} from "@/global/onboarding/demo/DemoPlayer";
import {
  SELFMOD_CUES,
  SELFMOD_PROMPT,
  SelfModFilm,
} from "@/global/onboarding/film/selfmod-film";
import type { OnboardingChatAnswer } from "../onboarding-chat-flow";

type SelfModCardProps = {
  active: boolean;
  answered: OnboardingChatAnswer | undefined;
  onAnswer: (answer: OnboardingChatAnswer) => void;
};

export function SelfModCard({ active, answered, onAnswer }: SelfModCardProps) {
  const t = useT();
  const film = useDemoPlayer({
    cues: SELFMOD_CUES,
    active: active && answered === undefined,
    startAt: filmStartAt(SELFMOD_CUES),
  });

  if (answered !== undefined) {
    return (
      <div className="obc-card" data-settled>
        <span className="obc-card__settled-icon">
          <Wand2 size={15} />
        </span>
        <span className="obc-card__settled-text">
          <span className="obc-card__settled-title">
            {t("onboarding.chat.selfmod.settledTitle")}
          </span>
          <span className="obc-card__settled-desc">
            {t("onboarding.chat.selfmod.settledDesc")}
          </span>
        </span>
      </div>
    );
  }

  return (
    <div className="obc-card">
      <div className="obc-card__section">
        <h3 className="obc-card__title">{t("onboarding.chat.selfmod.title")}</h3>
        <p className="obc-card__body">{t("onboarding.chat.selfmod.body")}</p>
      </div>

      <div className="obc-cap-frame">
        <div className="obc-cap-stage obc-cap-stage--film" aria-hidden="true">
          <div className="obc-cap-chapter" data-active>
            <SelfModFilm has={film.has} typed={SELFMOD_PROMPT} typing={false} />
          </div>
        </div>
        <DemoPlayerControls phase={film.phase} disabled={!active} onPlay={film.play} />
      </div>

      <ol className="obc-steps">
        {(["ask", "preview", "update"] as const).map((step, index) => (
          <li key={step} className="obc-steps__item">
            <span className="obc-steps__num">{index + 1}</span>
            <span className="obc-steps__text">
              <b>{t(`onboarding.chat.selfmod.steps.${step}.title`)}</b>
              <span>{t(`onboarding.chat.selfmod.steps.${step}.body`)}</span>
            </span>
          </li>
        ))}
      </ol>

      <div className="obc-actions">
        <Button
          type="button"
          variant="primary"
          disabled={!active}
          onClick={() => onAnswer("done")}
        >
          {t("common.continue")}
        </Button>
        <span className="obc-actions__spacer" />
        <span className="obc-actions__hint">{t("onboarding.chat.selfmod.hint")}</span>
      </div>
    </div>
  );
}
