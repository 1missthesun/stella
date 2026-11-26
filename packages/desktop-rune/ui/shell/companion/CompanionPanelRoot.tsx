import { useCallback, useEffect, useRef, useState } from "react";
import {
  COMPANION_MARK_BOTTOM_INSET,
  COMPANION_MARK_SIDE_INSET,
  COMPANION_MARK_SIZE,
  COMPANION_MARK_TOP_INSET,
  type CompanionEdgeH,
  type CompanionEdgeV,
  type CompanionLayout,
} from "@stella/contracts/desktop/companion";
import { useUiState } from "@/context/ui-state";
import type { ChatContext } from "@/shared/types/electron";
import { useComposerMessage, useComposerMessageStore } from "@/features/chat/hooks/use-composer-message-state";
import { useDictation } from "@/features/dictation/hooks/use-dictation";
import { setReadAloudEnabled } from "@/features/voice/services/read-aloud/read-aloud-pref";
import { useRealtimeVoiceVisible } from "@/shared/lib/realtime-voice-visibility";
import { useT } from "@/shared/i18n";
import { useCompanionBubbles } from "@/shell/companion/use-companion-bubbles";
import { Icon, Icons, WorkingDots, type IconData } from "../../kit";
import { fontSize, look, mixOklch, useTokens } from "../../theme";
import { panelSurface } from "../../chat/surfaces";
import { useWindowKeys } from "../window-keys";
import { useAuxWindow } from "../aux-window";
import { CompanionComposer } from "./CompanionComposer";
import { useCompanionState, useCompanionWindow, useMarkPress, useReadAloudEnabled } from "./use-companion";

const ARC_RADIUS = 58;
const ARC_BUTTON = 36;
const HULL_SIZE = 208;
const STACK_WIDTH = 340;
const ARC_ANGLES_BY_EDGE: Record<CompanionEdgeH, readonly [number, number, number]> = { right: [240, 180, 120], left: [300, 0, 60] };
const STACK_SPRING = { dur: 0.22, bounce: 0 };

const arcOffset = (index: number, edgeH: CompanionEdgeH, edgeV: CompanionEdgeV) => {
  const angle = (ARC_ANGLES_BY_EDGE[edgeH][index] ?? 90) * (Math.PI / 180);
  const flipY = edgeV === "top" ? -1 : 1;
  return { x: Math.cos(angle) * ARC_RADIUS, y: -Math.sin(angle) * ARC_RADIUS * flipY };
};

const anchorOf = (edgeH: CompanionEdgeH, edgeV: CompanionEdgeV, layout: CompanionLayout | null, width: number, height: number) => {
  const centerFromSide = COMPANION_MARK_SIDE_INSET + COMPANION_MARK_SIZE / 2;
  return {
    x: layout ? layout.anchorX : edgeH === "right" ? width - centerFromSide : centerFromSide,
    y: layout ? layout.anchorY : edgeV === "bottom" ? height - COMPANION_MARK_BOTTOM_INSET : COMPANION_MARK_TOP_INSET + COMPANION_MARK_SIZE,
  };
};

function ArcButton({ index, edgeH, edgeV, visible, icon, label, pressed, live, disabled, onPress, onPressStart, onHoverStart }: {
  index: number;
  edgeH: CompanionEdgeH;
  edgeV: CompanionEdgeV;
  visible: boolean;
  icon: IconData;
  label: string;
  pressed: boolean;
  live: boolean;
  disabled?: boolean;
  onPress: () => void;
  onPressStart?: () => void;
  onHoverStart?: () => void;
}) {
  const tokens = useTokens();
  const surface = panelSurface(tokens);
  const [hovered, setHovered] = useState(false);
  const at = arcOffset(index, edgeH, edgeV);
  const hoverBorder = mixOklch(tokens.c.primary, 30, tokens.c.panelSurfaceBorder);
  return (
    <box
      role="button"
      label={label}
      title={label}
      checked={pressed}
      focusable={visible}
      absolute={{ left: HULL_SIZE / 2 - ARC_BUTTON / 2, top: HULL_SIZE / 2 - ARC_BUTTON / 2 }}
      w={ARC_BUTTON}
      h={ARC_BUTTON}
      radius={ARC_BUTTON / 2}
      center
      fill={pressed ? tokens.c.primary : undefined}
      gradient={pressed ? undefined : surface.gradient}
      border={pressed ? "#00000000" : hovered ? hoverBorder : tokens.c.panelSurfaceBorder}
      shadows={[...tokens.shadow.sm, ...surface.shadows]}
      inert={!visible}
      disabled={disabled}
      cursor={disabled ? "default" : "pointer"}
      x={visible ? at.x : 0}
      y={visible ? at.y : 0}
      scale={visible ? 1 : 0.5}
      opacity={visible ? (disabled ? 0.55 : 1) : 0}
      motion={{ dur: 0.26, bounce: 0.3 }}
      onHover={(inside) => {
        setHovered(inside);
        if (inside) onHoverStart?.();
      }}
      onDrag={onPressStart ? (d) => d.phase === "start" && onPressStart() : undefined}
      onPress={disabled ? undefined : onPress}
    >
      {live ? <box absolute={{ left: -1, top: -1, right: -1, bottom: -1 }} radius={ARC_BUTTON / 2} border={mixOklch(tokens.c.primary, 45, "transparent")} borderWidth={2} inert loop={{ kind: "opacity", period: 1.6, low: 0, high: 1 }} /> : null}
      <Icon icon={icon} size={17} strokeWidth={1.75} color={pressed ? tokens.c.primaryForeground : hovered ? tokens.c.textStrong : tokens.c.textBase} />
    </box>
  );
}

/** desktop-ui's `CompanionPanelRoot`: the arc of quick actions around the mark, the reply bubbles and the composer. */
export function CompanionPanelRoot() {
  const t = useT();
  const tokens = useTokens();
  const { api, snapshot } = useAuxWindow();
  const state = useCompanionState();
  const { layout, activity } = useCompanionWindow();
  const { state: uiState } = useUiState();
  const voiceActive = Boolean(uiState.isVoiceRtcActive);
  const readAloudEnabled = useReadAloudEnabled();

  const [expanded, setExpanded] = useState(false);
  const [bubblesHovered, setBubblesHovered] = useState(false);
  const [focusRequestId, setFocusRequestId] = useState(0);
  const hovered = activity.hovered;

  const { store: messageStore, setMessage } = useComposerMessageStore();
  const message = useComposerMessage(messageStore);
  const collapseAfterSendRef = useRef(false);
  const [attachments, setAttachments] = useState<ChatContext | null>(null);
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const holdOpenRef = useRef(false);
  const holdOpen = useCallback((hold: boolean) => {
    holdOpenRef.current = hold;
  }, []);

  const sendCurrent = useCallback(() => {
    const text = messageStore.getSnapshot().trim();
    const context = attachmentsRef.current;
    const files = context?.files ?? [];
    const regionScreenshots = context?.regionScreenshots ?? [];
    const pastedTexts = context?.pastedTexts ?? [];
    const attached = files.length + regionScreenshots.length + pastedTexts.length > 0;
    if (!text && !attached) return;
    api?.companion.send({ text, ...(attached ? { attachments: { files, regionScreenshots, pastedTexts } } : {}) });
    setMessage("");
    setAttachments(null);
    if (collapseAfterSendRef.current) {
      collapseAfterSendRef.current = false;
      setExpanded(false);
    }
  }, [api, messageStore, setMessage]);

  const dictation = useDictation({ setMessage, commitOnShortcutStop: true, onCommit: sendCurrent });
  const dictationActive = dictation.isRecording || dictation.isTranscribing;
  const dictationActiveRef = useRef(dictationActive);
  dictationActiveRef.current = dictationActive;

  useEffect(() => {
    if (!dictation.isRecording) return;
    setExpanded((prev) => {
      if (!prev) collapseAfterSendRef.current = true;
      return true;
    });
  }, [dictation.isRecording]);

  useEffect(() => {
    if (!api) return;
    return api.companion.onSetExpanded(({ expanded: next }) => {
      if (!next) collapseAfterSendRef.current = false;
      setExpanded(next === true);
    });
  }, [api]);

  const { bubbles, visible: bubblesVisible } = useCompanionBubbles(state, hovered || expanded || bubblesHovered);
  const wantsVisible = expanded || bubbles.length > 0 || dictationActive;

  useEffect(() => {
    api?.companion.reportPanelStatus({ expanded, recording: dictation.isRecording, transcribing: dictation.isTranscribing, wantsVisible });
  }, [api, expanded, dictation.isRecording, dictation.isTranscribing, wantsVisible]);

  useEffect(() => {
    if (!expanded) return;
    api?.companion.focus();
    setFocusRequestId((id) => id + 1);
  }, [api, expanded]);

  const focusedSinceExpandRef = useRef(false);
  useEffect(() => {
    if (expanded) focusedSinceExpandRef.current = stella.host?.isFocused(snapshot.id) ?? false;
  }, [expanded, snapshot.id]);
  useEffect(
    () =>
      stella.host?.onFocusChange(snapshot.id, (focused) => {
        if (focused) {
          focusedSinceExpandRef.current = true;
          holdOpenRef.current = false;
          return;
        }
        if (!focusedSinceExpandRef.current) return;
        if (holdOpenRef.current) {
          holdOpenRef.current = false;
          return;
        }
        if (!dictationActiveRef.current) {
          collapseAfterSendRef.current = false;
          setExpanded(false);
        }
      }),
    [snapshot.id],
  );

  const collapse = useCallback(() => {
    if (dictationActiveRef.current) dictation.cancel();
    collapseAfterSendRef.current = false;
    setExpanded(false);
  }, [dictation]);

  useWindowKeys(["escape"], collapse, true, snapshot.id);

  const { dragging, onDrag, onContextMenu } = useMarkPress();

  const arcVisible = hovered || expanded;
  const showVoice = useRealtimeVoiceVisible();
  const toggleVoice = useCallback(() => {
    api?.voice?.toggleRtc?.();
  }, [api]);
  const toggleReadAloud = useCallback(() => {
    void setReadAloudEnabled(!readAloudEnabled);
  }, [readAloudEnabled]);

  const edgeH: CompanionEdgeH = layout?.edgeH ?? "right";
  const edgeV: CompanionEdgeV = layout?.edgeV ?? "bottom";
  const { width, height } = snapshot.bounds;
  const anchor = anchorOf(edgeH, edgeV, layout, width, height);
  const lift = showVoice && (hovered || expanded) ? 120 : 98;
  const stackPlace = {
    ...(edgeH === "right" ? { right: 8 } : { left: 8 }),
    ...(edgeV === "bottom" ? { bottom: height - anchor.y + lift } : { top: anchor.y - COMPANION_MARK_SIZE + lift }),
  };
  const bubbleText = look(fontSize.md, 400, { lh: 1.4 });

  return (
    <box w="full" h="full" clip={0}>
      <col
        absolute={stackPlace}
        w={STACK_WIDTH}
        gap={10}
        justify={edgeV === "bottom" ? "end" : "start"}
        hidden={dragging}
        layout={STACK_SPRING.dur}
        raise={3}
      >
        {edgeV === "top" && expanded ? <CompanionComposer message={message} setMessage={setMessage} attachments={attachments} setAttachments={setAttachments} dictation={dictation} isStreaming={state.isStreaming} focusRequestId={focusRequestId} onSend={sendCurrent} onEscape={collapse} onHoldOpen={holdOpen} /> : null}
        {bubbles.length > 0 ? (
          <col gap={6} opacity={bubblesVisible ? 1 : 0} y={bubblesVisible ? 0 : 6} motion={{ dur: 0.28, bounce: 0 }} onHover={setBubblesHovered}>
            {bubbles.map((bubble) => (
              <box
                key={bubble.key}
                role="button"
                title={t("companion.bubble.openStella")}
                selfAlign={bubble.role === "user" ? "end" : "start"}
                maxW={STACK_WIDTH * 0.88}
                py={7 + 1}
                px={12 + 1}
                radius={18}
                border={bubble.role === "user" ? "#00000000" : tokens.c.border}
                fill={bubble.role === "user" ? tokens.c.chatUserBubbleFill : tokens.c.surfaceInset}
                shadows={tokens.shadow.sm}
                cursor="pointer"
                origin={bubble.role === "user" ? [1, 1] : [0, 1]}
                enter={{ opacity: 0, y: 8, scale: 0.96, dur: 0.3, bounce: 0 }}
                onPress={() => api?.companion.openMain()}
              >
                {bubble.text ? (
                  <text {...bubbleText} maxLines={6} color={bubble.role === "user" ? tokens.c.chatUserBubbleText : tokens.c.textStrong}>
                    {bubble.text}
                  </text>
                ) : (
                  <box h={bubbleText.lineHeight} center>
                    <WorkingDots color={tokens.c.textWeak} label={t("companion.bubble.typing")} />
                  </box>
                )}
              </box>
            ))}
          </col>
        ) : null}
        {edgeV === "bottom" && expanded ? <CompanionComposer message={message} setMessage={setMessage} attachments={attachments} setAttachments={setAttachments} dictation={dictation} isStreaming={state.isStreaming} focusRequestId={focusRequestId} onSend={sendCurrent} onEscape={collapse} onHoldOpen={holdOpen} /> : null}
      </col>

      <box
        absolute={{ left: anchor.x - HULL_SIZE / 2, top: anchor.y - COMPANION_MARK_SIZE / 2 - HULL_SIZE / 2 }}
        w={HULL_SIZE}
        h={HULL_SIZE}
        radius={HULL_SIZE / 2}
        inert={!arcVisible}
        onHover={(inside) => api?.companion.setHovered(inside)}
      >
        <ArcButton
          index={0}
          edgeH={edgeH}
          edgeV={edgeV}
          visible={arcVisible}
          icon={Icons.stella.Volume2}
          label={t(readAloudEnabled ? "companion.arc.readAloudOn" : "companion.arc.readAloudOff")}
          pressed={readAloudEnabled}
          live={state.readAloudPlaying}
          onPress={toggleReadAloud}
        />
        <ArcButton
          index={1}
          edgeH={edgeH}
          edgeV={edgeV}
          visible={arcVisible}
          icon={Icons.stella.Mic}
          label={t(dictation.isRecording ? "companion.arc.dictateStop" : "companion.arc.dictate")}
          pressed={dictation.isRecording}
          live={dictation.isRecording}
          disabled={dictation.isTranscribing}
          onPress={dictation.toggle}
          onPressStart={() => dictation.arm({ button: 0 })}
          onHoverStart={dictation.prewarm}
        />
        {showVoice ? (
          <ArcButton
            index={2}
            edgeH={edgeH}
            edgeV={edgeV}
            visible={arcVisible}
            icon={Icons.stella.AudioLines}
            label={t(voiceActive ? "companion.arc.voiceStop" : "companion.arc.voice")}
            pressed={voiceActive}
            live={voiceActive}
            onPress={toggleVoice}
          />
        ) : null}
      </box>
      <box
        role="button"
        label={t(expanded ? "companion.mark.close" : "companion.mark.open")}
        expanded={expanded}
        absolute={{ left: anchor.x - COMPANION_MARK_SIZE / 2, top: anchor.y - COMPANION_MARK_SIZE }}
        w={COMPANION_MARK_SIZE}
        h={COMPANION_MARK_SIZE}
        radius={COMPANION_MARK_SIZE / 2}
        raise={4}
        cursor={dragging ? "grabbing" : "grab"}
        onHover={(inside) => api?.companion.setHovered(inside)}
        onDrag={onDrag}
        onContextMenu={onContextMenu}
      />
    </box>
  );
}
