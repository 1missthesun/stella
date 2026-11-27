import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowRight } from "@/ui/icons";
import { Button } from "@/ui/button";
import { useT } from "@/shared/i18n";
import { useRetainedSurfaceActive } from "@/ui/retained-surface";
import { DemoPlayerControls, filmStartAt, useDemoPlayer, type DemoPhase } from "./DemoPlayer";
import type { ChoreographyCue } from "./use-choreography";
import { CAPABILITY_FILMS } from "./film/capability-films";
import { SELFMOD_CUES, SELFMOD_PROMPT, SelfModFilm } from "./film/selfmod-film";
import { ChatbotMock, StellaMemoryMock } from "./scene/DemoScenes";
import type { WelcomeDemoId } from "./open-welcome-demo";
import "./welcome-demos.css";

const CHAPTER_ADVANCE_MS = 1400;

const scriptEnd = (cues: readonly ChoreographyCue[]) => cues[cues.length - 1]!.at;

/** Rests on its poster whenever the viewer hides it, so it never plays unseen. */
function usePosterWhenHidden(shown: boolean, phase: DemoPhase, reset: () => void) {
  useEffect(() => {
    if (!shown && (phase === "playing" || phase === "ended")) reset();
  }, [phase, reset, shown]);
}

function DemoFrame({
  phase,
  onPlay,
  variant,
  children,
}: {
  phase: DemoPhase;
  onPlay: () => void;
  variant: "film" | "memory";
  children: ReactNode;
}) {
  return (
    <div className="wdemo-frame" data-variant={variant}>
      <div className="wdemo-frame__stage" aria-hidden="true">
        {children}
      </div>
      <DemoPlayerControls phase={phase} onPlay={onPlay} />
    </div>
  );
}

function ErrandsDemo() {
  const t = useT();
  const shown = useRetainedSurfaceActive();
  const [chapterIndex, setChapterIndex] = useState(0);
  const [playNonce, setPlayNonce] = useState(0);
  const [played, setPlayed] = useState<ReadonlySet<string>>(() => new Set());
  const advanceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stillRef = useRef(false);

  const clearAdvance = useCallback(() => {
    if (!advanceRef.current) return;
    clearTimeout(advanceRef.current);
    advanceRef.current = null;
  }, []);
  useEffect(() => clearAdvance, [clearAdvance]);

  const chapter = CAPABILITY_FILMS[chapterIndex]!;
  const player = useDemoPlayer({
    cues: chapter.cues,
    active: shown,
    startAt: filmStartAt(chapter.cues),
    onDone: () => {
      const index = chapterIndex;
      const id = CAPABILITY_FILMS[index]!.id;
      setPlayed((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
      if (stillRef.current || index >= CAPABILITY_FILMS.length - 1) return;
      clearAdvance();
      advanceRef.current = setTimeout(() => {
        advanceRef.current = null;
        setChapterIndex(index + 1);
        resetPlayer();
      }, CHAPTER_ADVANCE_MS);
    },
  });
  const { phase, reset: resetPlayer } = player;
  stillRef.current = phase === "still";
  usePosterWhenHidden(shown, phase, resetPlayer);
  useEffect(() => {
    if (!shown) clearAdvance();
  }, [clearAdvance, shown]);

  const play = useCallback(() => {
    clearAdvance();
    setPlayNonce((nonce) => nonce + 1);
    player.play();
  }, [clearAdvance, player]);

  const showChapter = useCallback(
    (index: number) => {
      clearAdvance();
      setChapterIndex(index);
      resetPlayer();
    },
    [clearAdvance, resetPlayer],
  );

  const key = (part: string) =>
    `features.welcomeDemos.errands.chapters.${chapter.id}.${part}`;

  return (
    <>
      <h2 className="wdemo__title" key={`title:${chapter.id}`}>
        {t(key("title"))}
      </h2>
      <DemoFrame phase={phase} onPlay={play} variant="film">
        <div key={chapter.id} className="wdemo-frame__chapter">
          {chapter.render({ has: player.has, typed: chapter.prompt, typing: false })}
        </div>
      </DemoFrame>
      <div
        className="wdemo-chapters"
        role="tablist"
        aria-label={t("features.welcomeDemos.errands.tablist")}
      >
        {CAPABILITY_FILMS.map((entry, index) => {
          const active = index === chapterIndex;
          const running = active && (phase === "playing" || phase === "ended");
          return (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={active}
              className="wdemo-chapters__tab"
              data-active={active || undefined}
              data-completed={played.has(entry.id) || undefined}
              onClick={() => showChapter(index)}
            >
              <span className="wdemo-chapters__label">
                {t(`features.welcomeDemos.errands.chapters.${entry.id}.word`)}
              </span>
              <span className="wdemo-chapters__track" aria-hidden="true">
                {running ? (
                  <span
                    key={playNonce}
                    className="wdemo-chapters__fill"
                    style={{
                      animationDuration: `${scriptEnd(entry.cues) - filmStartAt(entry.cues)}ms`,
                    }}
                  />
                ) : active && phase === "still" ? (
                  <span className="wdemo-chapters__fill" data-still />
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
      <p className="wdemo__body wdemo__body--caption" key={`caption:${chapter.id}`}>
        {t(key("caption"))}
      </p>
    </>
  );
}

const CUSTOMIZE_STEPS = ["ask", "preview", "update"] as const;

function CustomizeDemo() {
  const t = useT();
  const shown = useRetainedSurfaceActive();
  const film = useDemoPlayer({
    cues: SELFMOD_CUES,
    active: shown,
    startAt: filmStartAt(SELFMOD_CUES),
  });
  usePosterWhenHidden(shown, film.phase, film.reset);

  return (
    <>
      <p className="wdemo__body">{t("features.welcomeDemos.customize.body")}</p>
      <DemoFrame phase={film.phase} onPlay={film.play} variant="film">
        <div className="wdemo-frame__chapter">
          <SelfModFilm has={film.has} typed={SELFMOD_PROMPT} typing={false} />
        </div>
      </DemoFrame>
      <ol className="wdemo-steps">
        {CUSTOMIZE_STEPS.map((step, index) => (
          <li key={step} className="wdemo-steps__item">
            <span className="wdemo-steps__num">{index + 1}</span>
            <span className="wdemo-steps__text">
              <b>{t(`features.welcomeDemos.customize.steps.${step}.title`)}</b>
              <span>{t(`features.welcomeDemos.customize.steps.${step}.body`)}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="wdemo__fine">{t("features.welcomeDemos.customize.hint")}</p>
    </>
  );
}

const CHATBOT_CUES: ChoreographyCue[] = [
  { id: "q", at: 700 },
  { id: "reply", at: 2100 },
  { id: "end", at: 2600 },
];

const STELLA_CUES: ChoreographyCue[] = [
  { id: "q", at: 500 },
  { id: "recall", at: 1300 },
  { id: "found", at: 2500 },
  { id: "reply", at: 3500 },
  { id: "end", at: 4300 },
];

type MemoryMode = "chatbot" | "stella";

const MEMORY_W = 520;
const MEMORY_H = 300;

/** Lays its children out at a fixed size and scales them to the frame's width. */
function FitCanvas({
  width,
  height,
  children,
}: {
  width: number;
  height: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setScale(node.clientWidth / width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [width]);
  return (
    <div
      ref={ref}
      className="wdemo-fit"
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      <div
        className="wdemo-fit__canvas"
        style={{ width, height, transform: `scale(${scale})`, opacity: scale > 0 ? 1 : 0 }}
      >
        {children}
      </div>
    </div>
  );
}

function MemoryDemo() {
  const t = useT();
  const shown = useRetainedSurfaceActive();
  const [mode, setMode] = useState<MemoryMode>("chatbot");
  const chatbot = useDemoPlayer({
    cues: CHATBOT_CUES,
    active: shown && mode === "chatbot",
    startAt: CHATBOT_CUES[0]!.at,
  });
  const stella = useDemoPlayer({
    cues: STELLA_CUES,
    active: shown && mode === "stella",
    startAt: STELLA_CUES[0]!.at,
  });
  const current = mode === "stella" ? stella : chatbot;
  usePosterWhenHidden(shown, chatbot.phase, chatbot.reset);
  usePosterWhenHidden(shown, stella.phase, stella.reset);

  return (
    <>
      <h2 className="wdemo__title" key={`title:${mode}`}>
        {mode === "stella"
          ? t("features.welcomeDemos.memory.titleStella")
          : t("features.welcomeDemos.memory.titleChatbot")}
      </h2>
      <p className="wdemo__body" key={`body:${mode}`}>
        {mode === "stella"
          ? t("features.welcomeDemos.memory.bodyStella")
          : t("features.welcomeDemos.memory.bodyChatbot")}
      </p>
      <DemoFrame
        key={mode}
        phase={current.phase}
        onPlay={current.play}
        variant="memory"
      >
        <FitCanvas width={MEMORY_W} height={MEMORY_H}>
          <div className="omorph" data-mode={mode}>
            <div className="omorph__chatbot">
              <ChatbotMock has={chatbot.has} />
            </div>
            <div className="omorph__stella">
              <StellaMemoryMock has={stella.has} />
            </div>
          </div>
        </FitCanvas>
      </DemoFrame>
      {mode === "chatbot" ? (
        <div className="wdemo__actions">
          <Button type="button" variant="primary" onClick={() => setMode("stella")}>
            {t("features.welcomeDemos.memory.showStella")}
            <ArrowRight size={14} />
          </Button>
        </div>
      ) : null}
    </>
  );
}

export function WelcomeDemoView({ id }: { id: WelcomeDemoId }) {
  return (
    <div className="wdemo" data-demo={id}>
      <div className="wdemo__column">
        {id === "errands" ? (
          <ErrandsDemo />
        ) : id === "customize" ? (
          <CustomizeDemo />
        ) : (
          <MemoryDemo />
        )}
      </div>
    </div>
  );
}

export default WelcomeDemoView;
