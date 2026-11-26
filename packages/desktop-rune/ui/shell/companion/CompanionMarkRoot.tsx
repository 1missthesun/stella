import { useMemo, useRef } from "react";
import { COMPANION_MARK_SIZE } from "@stella/contracts/desktop/companion";
import { useUiState } from "@/context/ui-state";
import { useT, useTPlural } from "@/shared/i18n";
import type { StellaCharacterState, StellaMarkHandle } from "@/ui/stella-character/rig";
import { StellaCharacter } from "../../kit/StellaCharacter";
import { useTokens } from "../../theme";
import { useAuxWindow } from "../aux-window";
import { useCompanionState, useCompanionVisible, useCompanionWindow, useMarkPress, useVoiceSpeakingState } from "./use-companion";
import { CompanionBadge } from "./CompanionBadge";

const MARK_SPRING = { dur: 0.18, bounce: 0.35 };

/** desktop-ui's `CompanionMarkRoot`: the mark alone, standing on its anchor. */
export function CompanionMarkRoot() {
  const t = useT();
  const tPlural = useTPlural();
  const tokens = useTokens();
  const { api, snapshot } = useAuxWindow();
  const state = useCompanionState();
  const { layout, activity } = useCompanionWindow();
  const { state: uiState } = useUiState();
  const voiceActive = Boolean(uiState.isVoiceRtcActive);
  const voice = useVoiceSpeakingState(voiceActive);
  const companionVisible = useCompanionVisible();
  const markHandleRef = useRef<StellaMarkHandle | null>(null);
  const { dragging, onDrag, onContextMenu } = useMarkPress(() => markHandleRef.current?.sparkle());

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
  }, [dragging, activity.recording, activity.transcribing, voiceActive, voice.isSpeaking, voice.isUserSpeaking, state.readAloudPlaying, state.isStreaming, state.workState]);

  const expanded = activity.expanded;
  const { width, height } = snapshot.bounds;
  const anchorX = layout?.anchorX ?? width / 2;
  const anchorY = layout?.anchorY ?? height - 14;
  const scale = dragging ? 0.96 : activity.hovered ? 1.04 : 1;

  return (
    <box w="full" h="full" clip={0} onHover={(inside) => api?.companion.setHovered(inside)}>
      <box
        id="companion-mark"
        role="button"
        label={t(expanded ? "companion.mark.close" : "companion.mark.open")}
        expanded={expanded}
        focusable
        absolute={{ left: anchorX - COMPANION_MARK_SIZE / 2, top: anchorY - COMPANION_MARK_SIZE }}
        w={COMPANION_MARK_SIZE}
        h={COMPANION_MARK_SIZE}
        radius={COMPANION_MARK_SIZE / 2}
        cursor={dragging ? "grabbing" : "grab"}
        origin={[0.5, 1]}
        scale={scale}
        motion={MARK_SPRING}
        onDrag={onDrag}
        onContextMenu={onContextMenu}
      >
        <StellaCharacter size={COMPANION_MARK_SIZE} state={markState} shape="star" ink="aurora" glow eyeColor={tokens.c.card} followPointer={activity.hovered || expanded} paused={!companionVisible} handleRef={markHandleRef} />
        {state.runningAgentCount > 0 ? <CompanionBadge count={state.runningAgentCount} label={tPlural("companion.badge.running", state.runningAgentCount)} /> : null}
      </box>
    </box>
  );
}
