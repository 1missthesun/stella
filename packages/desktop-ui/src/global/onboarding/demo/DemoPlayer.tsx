import { useCallback, useEffect, useMemo, useState } from "react";
import { Play, RotateCcw } from "@/ui/icons";
import { useT } from "@/shared/i18n";
import { useChoreography, type ChoreographyCue } from "./use-choreography";

const SEND_LEAD_MS = 450;

export const filmStartAt = (cues: readonly ChoreographyCue[]) =>
  Math.max(0, (cues.find((cue) => cue.id === "send")?.at ?? 0) - SEND_LEAD_MS);

export type DemoPhase = "poster" | "playing" | "ended" | "still";

const usePrefersReducedMotion = () => {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(
    () => typeof window.matchMedia === "function" && window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const update = () => setReduced(list.matches);
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, []);
  return reduced;
};

export function useDemoPlayer({
  cues,
  active,
  startAt = 0,
  onDone,
}: {
  cues: readonly ChoreographyCue[];
  active: boolean;
  startAt?: number;
  onDone?: () => void;
}) {
  const reduced = usePrefersReducedMotion();
  const [phase, setPhase] = useState<Exclude<DemoPhase, "still">>("poster");
  const film = useChoreography({
    cues,
    active: active && (reduced || phase !== "poster"),
    startAt,
    onDone: () => {
      setPhase("ended");
      onDone?.();
    },
  });

  const posterIds = useMemo(
    () => new Set(cues.filter((cue) => cue.at <= startAt).map((cue) => cue.id)),
    [cues, startAt],
  );
  const posterHas = useCallback((id: string) => posterIds.has(id), [posterIds]);

  const { restart } = film;
  const play = useCallback(() => {
    if (phase === "ended") restart();
    setPhase("playing");
  }, [phase, restart]);
  const reset = useCallback(() => setPhase("poster"), []);

  return {
    phase: (reduced ? "still" : phase) as DemoPhase,
    has: !reduced && phase === "poster" ? posterHas : film.has,
    play,
    reset,
  };
}

export function DemoPlayerControls({
  phase,
  disabled,
  onPlay,
}: {
  phase: DemoPhase;
  disabled?: boolean;
  onPlay: () => void;
}) {
  const t = useT();
  return (
    <>
      <button
        type="button"
        className="obc-demo-play"
        data-visible={phase === "poster" || undefined}
        disabled={phase !== "poster" || disabled}
        aria-label={t("onboarding.chat.capabilities.play")}
        onClick={onPlay}
      >
        <span className="obc-demo-play__disc" aria-hidden="true">
          <Play size={20} />
        </span>
      </button>
      <button
        type="button"
        className="obc-cap-replay"
        data-visible={phase === "ended" || undefined}
        disabled={phase !== "ended" || disabled}
        aria-label={t("onboarding.chat.capabilities.replay")}
        onClick={onPlay}
      >
        <RotateCcw size={12} />
      </button>
    </>
  );
}
