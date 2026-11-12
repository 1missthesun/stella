import { useCallback, useEffect, useRef, useState } from "react";
import { Play } from "@/ui/icons";
import { Button } from "@/ui/button";
import { useT } from "@/shared/i18n";
import type { ChoreographyCue } from "@/global/onboarding/demo/use-choreography";
import {
  DemoPlayerControls,
  filmStartAt,
  useDemoPlayer,
} from "@/global/onboarding/demo/DemoPlayer";
import {
  CAPABILITY_FILMS,
  type CapabilityId,
} from "@/global/onboarding/film/capability-films";
import type { OnboardingChatAnswer } from "../onboarding-chat-flow";

type CapabilitiesCardProps = {
  active: boolean;
  answered: OnboardingChatAnswer | undefined;
  onAnswer: (answer: OnboardingChatAnswer) => void;
};

const AUTO_ADVANCE_HOLD_MS = 1400;

const CHAPTERS = CAPABILITY_FILMS;
type ChapterId = CapabilityId;

const scriptEnd = (cues: ChoreographyCue[]) => cues[cues.length - 1]!.at;

export function CapabilitiesCard({
  active,
  answered,
  onAnswer,
}: CapabilitiesCardProps) {
  const t = useT();
  const [chapterIndex, setChapterIndex] = useState(0);
  const [playNonce, setPlayNonce] = useState(0);
  const [playedChapters, setPlayedChapters] = useState<ReadonlySet<ChapterId>>(
    () => new Set(),
  );
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stillRef = useRef(false);

  const clearAdvanceTimer = useCallback(() => {
    if (advanceTimerRef.current) {
      clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearAdvanceTimer, [clearAdvanceTimer]);

  const activeChapter = CHAPTERS[chapterIndex]!;
  const player = useDemoPlayer({
    cues: activeChapter.cues,
    active: active && answered === undefined,
    startAt: filmStartAt(activeChapter.cues),
    onDone: () => {
      const index = chapterIndex;
      const chapter = CHAPTERS[index]!;
      setPlayedChapters((prev) => {
        if (prev.has(chapter.id)) return prev;
        const next = new Set(prev);
        next.add(chapter.id);
        return next;
      });
      if (stillRef.current || index >= CHAPTERS.length - 1) return;
      clearAdvanceTimer();
      advanceTimerRef.current = setTimeout(() => {
        advanceTimerRef.current = null;
        setChapterIndex(index + 1);
        resetPlayer();
      }, AUTO_ADVANCE_HOLD_MS);
    },
  });
  const { phase, reset: resetPlayer } = player;
  const still = phase === "still";
  stillRef.current = still;

  const play = useCallback(() => {
    clearAdvanceTimer();
    setPlayNonce((nonce) => nonce + 1);
    player.play();
  }, [clearAdvanceTimer, player]);

  const showChapter = useCallback(
    (index: number) => {
      clearAdvanceTimer();
      setChapterIndex(index);
      resetPlayer();
    },
    [clearAdvanceTimer, resetPlayer],
  );

  if (answered !== undefined) {
    return (
      <div className="obc-card" data-settled>
        <span className="obc-card__settled-icon">
          <Play size={14} />
        </span>
        <span className="obc-card__settled-text">
          <span className="obc-card__settled-title">
            {t("onboarding.chat.capabilities.settledTitle")}
          </span>
          <span className="obc-card__settled-desc">
            {CHAPTERS.map((chapter) =>
              t(`onboarding.chat.capabilities.${chapter.id}.word`),
            ).join(" · ")}
          </span>
        </span>
      </div>
    );
  }

  return (
    <div className="obc-card">
      <h3 className="obc-card__title" key={activeChapter.id}>
        {t(`onboarding.chat.capabilities.${activeChapter.id}.title`)}
      </h3>

      <div className="obc-cap-frame">
        <div className="obc-cap-stage obc-cap-stage--film" aria-hidden="true">
          {/* Only the active chapter mounts so inactive demos never burn frames. */}
          <div key={activeChapter.id} className="obc-cap-chapter" data-active>
            {activeChapter.render({
              has: player.has,
              typed: activeChapter.prompt,
              typing: false,
            })}
          </div>
        </div>
        <DemoPlayerControls phase={phase} disabled={!active} onPlay={play} />
      </div>

      <div
        className="obc-cap-words"
        role="tablist"
        aria-label={t("onboarding.chat.capabilities.tablist")}
      >
        {CHAPTERS.map((chapter, index) => {
          const isActive = index === chapterIndex;
          return (
            <button
              key={chapter.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className="obc-cap-words__word"
              data-active={isActive || undefined}
              data-completed={playedChapters.has(chapter.id) || undefined}
              onClick={() => showChapter(index)}
            >
              <span className="obc-cap-words__label">
                {t(`onboarding.chat.capabilities.${chapter.id}.word`)}
              </span>
              <span className="obc-cap-words__track" aria-hidden="true">
                {isActive && (phase === "playing" || phase === "ended") ? (
                  <span
                    key={playNonce}
                    className="obc-cap-words__fill"
                    style={{
                      animationDuration: `${scriptEnd(chapter.cues) - filmStartAt(chapter.cues)}ms`,
                    }}
                  />
                ) : isActive && still ? (
                  <span className="obc-cap-words__fill" data-still />
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

      <p className="obc-cap-caption" key={`caption:${activeChapter.id}`}>
        {t(`onboarding.chat.capabilities.${activeChapter.id}.caption`)}
      </p>

      <div className="obc-actions">
        <Button
          type="button"
          variant="primary"
          disabled={!active}
          onClick={() => onAnswer("done")}
        >
          {t("common.continue")}
        </Button>
      </div>
    </div>
  );
}
