import { useEffect, useMemo, useRef, useState } from "react";
import { useMinimumVisibleValue } from "@/shared/hooks/use-minimum-visible-value";
import { useWindowFocus } from "@/shared/hooks/use-window-focus";
import { cn } from "@/shared/lib/utils";
import { StellaCharacter } from "@/ui/stella-character/StellaCharacter";
import { SwapText } from "./SwapText";
import { CHAT_ACTIVITY_SHIMMER_GROUP } from "./TextShimmer";
import { computeStillStatus } from "@stella/contracts/working-status";
import {
  getWorkingIndicatorCharacterState,
  getWorkingIndicatorDisplayStatus,
  getWorkingIndicatorThinkingText,
  INLINE_WORKING_INDICATOR_MIN_VISIBLE_MS,
  WORKING_INDICATOR_COMPACTING_TEXT,
  WORKING_INDICATOR_LONG_THINKING_MS,
  WORKING_INDICATOR_LONG_TOOL_MS,
  WORKING_INDICATOR_POSE_ROTATE_MS,
  WORKING_INDICATOR_THINKING_LABEL_MS,
  type WorkingIndicatorCharacterState,
} from "@/features/chat/working-indicator-state";
import "./indicators.css";

const INDICATOR_MARK_SIZE_PX = 30;

/** Punches the eyes out of the mark so they read as holes, not paint. */
const INDICATOR_EYE_COLOR = "var(--surface-base)";

interface WorkingIndicatorProps {
  status?: string;
  toolName?: string;
  /** Stable id of the in-flight tool call. Used as a seed for the
   * friendly variation picker so the label doesn't flicker on each
   * re-render. */
  toolCallId?: string;
  compacting?: boolean;
  isReasoning?: boolean;
  /** Per-turn seed so the reasoning/idle label varies across turns
   * instead of always landing on the first variation ("Thinking"). */
  reasoningSeed?: string;
  className?: string;
  /** Stops persistent motion while the shell finishes its finite exit. */
  animationActive?: boolean;
  minimumVisibleMs?: number;
}

const STRETCH_MARKS_MS = [
  WORKING_INDICATOR_THINKING_LABEL_MS,
  WORKING_INDICATOR_LONG_THINKING_MS,
  WORKING_INDICATOR_LONG_TOOL_MS,
];

/**
 * How long the current stretch (a spell of thinking, or one tool call) has
 * run, re-rendering as it crosses each label threshold. A new stretch reads
 * zero from its first render, so a fresh tool never inherits the last one's
 * age.
 */
function useStretchElapsedMs(stretch: string | null): number {
  const [started, setStarted] = useState<{
    stretch: string;
    at: number;
  } | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (stretch === null) {
      setStarted(null);
      return;
    }
    setStarted({ stretch, at: Date.now() });
    const timers = STRETCH_MARKS_MS.map((ms) =>
      window.setTimeout(() => setTick((tick) => tick + 1), ms),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [stretch]);
  if (stretch === null || started?.stretch !== stretch) return 0;
  return Date.now() - started.at;
}

export function WorkingIndicator({
  status,
  toolName,
  toolCallId,
  compacting,
  isReasoning,
  reasoningSeed,
  className,
  animationActive = true,
  minimumVisibleMs = INLINE_WORKING_INDICATOR_MIN_VISIBLE_MS,
}: WorkingIndicatorProps) {
  const windowFocused = useWindowFocus();
  const animationPaused = !animationActive || !windowFocused;

  // One pose per rotation window of a tool call, dealt from the whole
  // repertoire rather than read off the tool's name; a long call moves on to
  // another pose every window and never repeats the one it just left.
  const [poseEpoch, setPoseEpoch] = useState(0);
  useEffect(() => {
    if (animationPaused) return;
    const timer = window.setInterval(
      () => setPoseEpoch((epoch) => epoch + 1),
      WORKING_INDICATOR_POSE_ROTATE_MS,
    );
    return () => window.clearInterval(timer);
  }, [animationPaused]);
  const previousPoseRef = useRef<WorkingIndicatorCharacterState | undefined>(
    undefined,
  );

  const thinking = !toolName && Boolean(isReasoning) && !compacting;
  const stretchMs = useStretchElapsedMs(
    toolName ? `tool:${toolCallId ?? toolName}` : thinking ? "thinking" : null,
  );
  const thinkingText = thinking
    ? getWorkingIndicatorThinkingText(stretchMs)
    : "";
  const longTool =
    Boolean(toolName) && stretchMs >= WORKING_INDICATOR_LONG_TOOL_MS;

  // Pose and label are held as one tuple so they can never disagree: holding
  // them separately would let a stale label sit under the next activity's
  // pose for the remainder of its floor.
  const liveDisplay = useMemo(() => {
    const characterState = getWorkingIndicatorCharacterState({
      toolName,
      isReasoning,
      seed: `${toolCallId ?? reasoningSeed ?? ""}:${poseEpoch}`,
      avoid: previousPoseRef.current,
    });
    return {
      status:
        characterState === "thinking"
          ? thinkingText
          : longTool && toolName
            ? computeStillStatus(toolName)
            : getWorkingIndicatorDisplayStatus({
                status,
                toolName,
                toolCallId,
              }),
      characterState,
    };
  }, [
    status,
    toolName,
    toolCallId,
    isReasoning,
    reasoningSeed,
    poseEpoch,
    thinkingText,
    longTool,
  ]);
  previousPoseRef.current = liveDisplay.characterState;
  // Dots have no text to read: a tool can replace them immediately.
  const held = useMinimumVisibleValue(
    liveDisplay,
    liveDisplay.characterState === "thinking" ? 0 : minimumVisibleMs,
    (a, b) => a.status === b.status && a.characterState === b.characterState,
  );
  // Short thinking shows as the mark alone; a stretch that lasts gets its
  // calm label. Engine-side compaction is named from the start: it is a
  // minutes-long wait.
  const dotsOnly =
    held.characterState === "thinking" && !held.status && !compacting;

  return (
    <div
      className={cn("working-indicator", className)}
      data-mode={dotsOnly ? "thinking" : "tool"}
    >
      <div className="indicator-stella">
        <StellaCharacter
          size={INDICATOR_MARK_SIZE_PX}
          state={held.characterState}
          eyeColor={INDICATOR_EYE_COLOR}
          paused={animationPaused}
        />
      </div>
      {dotsOnly ? null : (
        <SwapText
          text={compacting ? WORKING_INDICATOR_COMPACTING_TEXT : held.status}
          active={animationActive}
          animateInitial={false}
          className="working-status"
          shimmerGroup={CHAT_ACTIVITY_SHIMMER_GROUP}
          shimmerPriority={100}
        />
      )}
    </div>
  );
}
