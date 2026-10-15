import { useMemo, useRef, type CSSProperties } from "react";
import { COMPANION_MARK_SIZE } from "@stella/contracts/desktop/companion";
import { useUiState } from "@/context/ui-state";
import { useT } from "@/shared/i18n";
import {
  StellaCharacter,
  type StellaCharacterState,
} from "@/ui/stella-character/StellaCharacter";
import type { StellaMarkHandle } from "@/ui/stella-character/rig";
import {
  useCompanionState,
  useVoiceSpeakingState,
} from "./use-companion-state";
import {
  useCompanionVisible,
  useCompanionWindow,
  useDocumentVisible,
} from "./use-companion-window";
import { useMarkPress } from "./use-mark-press";
import "./companion.css";

export function CompanionMarkRoot() {
  const t = useT();
  const api = window.electronAPI?.companion;
  const state = useCompanionState();
  const { layout, activity } = useCompanionWindow();
  const { state: uiState } = useUiState();
  const voiceActive = Boolean(uiState.isVoiceRtcActive);
  const voice = useVoiceSpeakingState(voiceActive);
  const documentVisible = useDocumentVisible();
  const companionVisible = useCompanionVisible();
  const markHandleRef = useRef<StellaMarkHandle | null>(null);

  const { dragging, handlers: pressHandlers } = useMarkPress(() =>
    markHandleRef.current?.sparkle(),
  );

  const markState = useMemo<StellaCharacterState>(() => {
    if (dragging) return "happy";
    if (activity.recording) return "listening";
    if (activity.transcribing) return "thinking";
    if (voiceActive) {
      if (voice.isSpeaking) return "speaking";
      if (voice.isUserSpeaking) return "listening";
      return "waking";
    }
    if (state.readAloudPlaying) return "speaking";
    if (state.isStreaming) return state.workState ?? "thinking";
    return "idle";
  }, [
    dragging,
    activity.recording,
    activity.transcribing,
    voiceActive,
    voice.isSpeaking,
    voice.isUserSpeaking,
    state.readAloudPlaying,
    state.isStreaming,
    state.workState,
  ]);

  const runningCount = state.runningAgentCount;
  const expanded = activity.expanded;

  return (
    <div
      className="companion-mark-root"
      style={
        layout
          ? ({
              "--companion-anchor-x": `${layout.anchorX}px`,
              "--companion-anchor-y": `${layout.anchorY}px`,
            } as CSSProperties)
          : undefined
      }
      data-hovered={activity.hovered || undefined}
      data-expanded={expanded || undefined}
      data-dragging={dragging || undefined}
      onMouseEnter={() => api?.setHovered(true)}
      onMouseLeave={() => api?.setHovered(false)}
    >
      <button
        type="button"
        className="companion-mark"
        aria-label={t(
          expanded ? "companion.mark.close" : "companion.mark.open",
        )}
        aria-expanded={expanded}
        {...pressHandlers}
      >
        <StellaCharacter
          size={COMPANION_MARK_SIZE}
          state={markState}
          shape="star"
          ink="aurora"
          glow
          eyeColor="var(--card)"
          followPointer={activity.hovered || expanded}
          paused={!documentVisible || !companionVisible}
          handleRef={markHandleRef}
        />
        {runningCount > 0 ? (
          <span
            className="companion-badge"
            title={t("companion.badge.running", { count: runningCount })}
            aria-label={t("companion.badge.running", { count: runningCount })}
          >
            {runningCount > 99 ? "99+" : runningCount}
          </span>
        ) : null}
      </button>
    </div>
  );
}
