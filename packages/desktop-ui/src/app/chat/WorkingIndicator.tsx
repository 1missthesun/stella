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
  pickWorkingIndicatorToolPose,
  INLINE_WORKING_INDICATOR_MIN_VISIBLE_MS,
  WORKING_INDICATOR_COMPACTING_TEXT,
  WORKING_INDICATOR_LONG_THINKING_MS,
  WORKING_INDICATOR_LONG_TOOL_MS,
  WORKING_INDICATOR_POSE_ROTATE_MS,
  WORKING_INDICATOR_THINKING_LABEL_MS,
  type WorkingIndicatorCharacterState,
} from "@/features/chat/working-indicator-state";
import "./indicators.css";

const INDICATOR_MARK_SIZE_PX = 24;

const INDICATOR_EYE_COLOR = "var(--surface-base)";

interface WorkingIndicatorProps {
  status?: string;
  toolName?: string;
  toolCallId?: string;
  compacting?: boolean;
  isReasoning?: boolean;
  reasoningSeed?: string;
  className?: string;
  animationActive?: boolean;
  minimumVisibleMs?: number;
}

const STRETCH_MARKS_MS = [
  WORKING_INDICATOR_THINKING_LABEL_MS,
  WORKING_INDICATOR_LONG_THINKING_MS,
  WORKING_INDICATOR_LONG_TOOL_MS,
];

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

  const liveDisplay = useMemo(() => {
    const seed = `${toolCallId ?? reasoningSeed ?? ""}:${poseEpoch}`;
    const basePose = getWorkingIndicatorCharacterState({
      toolName,
      isReasoning,
      seed,
      avoid: previousPoseRef.current,
    });
    const reasoning = basePose === "thinking";
    const characterState =
      reasoning && (thinkingText || compacting)
        ? pickWorkingIndicatorToolPose(seed, previousPoseRef.current)
        : basePose;
    return {
      reasoning,
      status:
        reasoning
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
    compacting,
    longTool,
  ]);
  previousPoseRef.current = liveDisplay.characterState;
  const held = useMinimumVisibleValue(
    liveDisplay,
    liveDisplay.reasoning ? 0 : minimumVisibleMs,
    (a, b) => a.status === b.status && a.characterState === b.characterState,
  );
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
