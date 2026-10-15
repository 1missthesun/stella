import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
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
import { WorkingDots } from "@/ui/working-dots";
import {
  useComposerMessage,
  useComposerMessageStore,
} from "@/features/chat/hooks/use-composer-message-state";
import { useDictation } from "@/features/dictation/hooks/use-dictation";
import { setReadAloudEnabled } from "@/features/voice/services/read-aloud/read-aloud-pref";
import { useRealtimeVoiceVisible } from "@/shared/lib/realtime-voice-visibility";
import { useT } from "@/shared/i18n";
import { useDictationToggleBridge } from "@/shell/root-chrome/use-dictation-toggle-bridge";
import { AudioLines, Mic, Volume2 } from "@/ui/icons";
import { CompanionComposer } from "./CompanionComposer";
import { useCompanionBubbles } from "./use-companion-bubbles";
import { useCompanionState, useReadAloudEnabled } from "./use-companion-state";
import { useCompanionWindow } from "./use-companion-window";
import { useMarkPress } from "./use-mark-press";
import "./companion.css";

// Seats the buttons in the star's valleys with an even ~10px gap to its
// outline (measured from the rendered mark).
const ARC_RADIUS = 58;
const ARC_ANGLES_BY_EDGE: Record<
  CompanionEdgeH,
  readonly [number, number, number]
> = {
  right: [240, 180, 120],
  left: [300, 0, 60],
};

const arcButtonStyle = (
  index: number,
  edgeH: CompanionEdgeH,
  edgeV: CompanionEdgeV,
): CSSProperties => {
  const angle = (ARC_ANGLES_BY_EDGE[edgeH][index] ?? 90) * (Math.PI / 180);
  const flipY = edgeV === "top" ? -1 : 1;
  return {
    "--arc-x": `${Math.cos(angle) * ARC_RADIUS}px`,
    "--arc-y": `${-Math.sin(angle) * ARC_RADIUS * flipY}px`,
    "--arc-i": index,
  } as CSSProperties;
};

const anchorVars = (
  edgeH: CompanionEdgeH,
  edgeV: CompanionEdgeV,
  layout: CompanionLayout | null,
): CSSProperties => {
  const half = COMPANION_MARK_SIZE / 2;
  const centerFromSide = COMPANION_MARK_SIDE_INSET + half;
  return {
    "--companion-anchor-x": layout
      ? `${layout.anchorX}px`
      : edgeH === "right"
        ? `calc(100% - ${centerFromSide}px)`
        : `${centerFromSide}px`,
    "--companion-anchor-y": layout
      ? `${layout.anchorY}px`
      : edgeV === "bottom"
        ? `calc(100% - ${COMPANION_MARK_BOTTOM_INSET}px)`
        : `${COMPANION_MARK_TOP_INSET + COMPANION_MARK_SIZE}px`,
    "--companion-mark-size": `${COMPANION_MARK_SIZE}px`,
  } as CSSProperties;
};

export function CompanionPanelRoot() {
  const t = useT();
  const api = window.electronAPI?.companion;
  const state = useCompanionState();
  const { layout, activity } = useCompanionWindow();
  const { state: uiState } = useUiState();
  const voiceActive = Boolean(uiState.isVoiceRtcActive);
  const readAloudEnabled = useReadAloudEnabled();

  const [expanded, setExpanded] = useState(false);
  const [bubblesHovered, setBubblesHovered] = useState(false);
  const [focusRequestId, setFocusRequestId] = useState(0);
  const hovered = activity.hovered;

  useDictationToggleBridge();

  const { store: messageStore, setMessage } = useComposerMessageStore();
  const message = useComposerMessage(messageStore);
  const collapseAfterSendRef = useRef(false);
  const [attachments, setAttachments] = useState<ChatContext | null>(null);
  const attachmentsRef = useRef(attachments);
  attachmentsRef.current = attachments;
  const holdOpenRef = useRef(false);
  // The + menu's file picker takes focus from the panel; that one blur must
  // not collapse the composer.
  const holdOpen = useCallback((hold: boolean) => {
    holdOpenRef.current = hold;
  }, []);

  const sendCurrent = useCallback(() => {
    const text = messageStore.getSnapshot().trim();
    const context = attachmentsRef.current;
    const files = context?.files ?? [];
    const regionScreenshots = context?.regionScreenshots ?? [];
    const pastedTexts = context?.pastedTexts ?? [];
    const attached =
      files.length + regionScreenshots.length + pastedTexts.length > 0;
    if (!text && !attached) return;
    api?.send({
      text,
      ...(attached
        ? { attachments: { files, regionScreenshots, pastedTexts } }
        : {}),
    });
    setMessage("");
    setAttachments(null);
    if (collapseAfterSendRef.current) {
      collapseAfterSendRef.current = false;
      setExpanded(false);
    }
  }, [api, messageStore, setMessage]);

  const dictation = useDictation({
    setMessage,
    commitOnShortcutStop: true,
    onCommit: sendCurrent,
  });
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
    return api.onSetExpanded(({ expanded: next }) => {
      if (!next) collapseAfterSendRef.current = false;
      setExpanded(next === true);
    });
  }, [api]);

  const { bubbles, visible: bubblesVisible } = useCompanionBubbles(
    state,
    hovered || expanded || bubblesHovered,
  );
  const wantsVisible = expanded || bubbles.length > 0 || dictationActive;

  useEffect(() => {
    api?.reportPanelStatus({
      expanded,
      recording: dictation.isRecording,
      transcribing: dictation.isTranscribing,
      wantsVisible,
    });
  }, [
    api,
    expanded,
    dictation.isRecording,
    dictation.isTranscribing,
    wantsVisible,
  ]);

  useEffect(() => {
    if (!expanded) return;
    api?.focus();
    setFocusRequestId((id) => id + 1);
  }, [api, expanded]);

  const focusedSinceExpandRef = useRef(false);
  useEffect(() => {
    if (expanded) focusedSinceExpandRef.current = document.hasFocus();
  }, [expanded]);
  useEffect(() => {
    const onFocus = () => {
      focusedSinceExpandRef.current = true;
      holdOpenRef.current = false;
    };
    const onBlur = () => {
      if (!focusedSinceExpandRef.current) return;
      if (holdOpenRef.current) {
        holdOpenRef.current = false;
        return;
      }
      if (!dictationActiveRef.current) {
        collapseAfterSendRef.current = false;
        setExpanded(false);
      }
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  const collapse = useCallback(() => {
    if (dictationActiveRef.current) dictation.cancel();
    collapseAfterSendRef.current = false;
    setExpanded(false);
  }, [dictation]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Escape first closes the composer's + menu, not the whole composer.
      if (
        event.target instanceof Element &&
        event.target.closest("[role='menu']")
      ) {
        return;
      }
      collapse();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [collapse]);

  const { dragging, handlers: markPressHandlers } = useMarkPress();

  const arcVisible = hovered || expanded;
  const showVoice = useRealtimeVoiceVisible();
  const toggleVoice = useCallback(() => {
    window.electronAPI?.voice?.toggleRtc?.();
  }, []);
  const toggleReadAloud = useCallback(() => {
    void setReadAloudEnabled(!readAloudEnabled);
  }, [readAloudEnabled]);

  const edgeH: CompanionEdgeH = layout?.edgeH ?? "right";
  const edgeV: CompanionEdgeV = layout?.edgeV ?? "bottom";

  return (
    <div
      className="companion-root"
      data-hovered={hovered || undefined}
      data-expanded={expanded || undefined}
      data-dragging={dragging || undefined}
      data-edge-h={edgeH}
      data-edge-v={edgeV}
      data-voice={showVoice || undefined}
      style={anchorVars(edgeH, edgeV, layout)}
    >
      <div className="companion-stack">
        {bubbles.length > 0 ? (
          <div
            className="companion-bubbles"
            data-visible={bubblesVisible || undefined}
            onMouseEnter={() => setBubblesHovered(true)}
            onMouseLeave={() => setBubblesHovered(false)}
          >
            {bubbles.map((bubble) => (
              <button
                key={bubble.key}
                type="button"
                className="companion-bubble"
                data-role={bubble.role}
                data-streaming={bubble.streaming || undefined}
                title={t("companion.bubble.openStella")}
                onClick={() => api?.openMain()}
              >
                {bubble.text ? (
                  <span className="companion-bubble__text">{bubble.text}</span>
                ) : (
                  <WorkingDots
                    className="companion-bubble__typing"
                    label={t("companion.bubble.typing")}
                  />
                )}
              </button>
            ))}
          </div>
        ) : null}

        {expanded ? (
          <CompanionComposer
            message={message}
            setMessage={setMessage}
            attachments={attachments}
            setAttachments={setAttachments}
            dictation={dictation}
            isStreaming={state.isStreaming}
            focusRequestId={focusRequestId}
            onSend={sendCurrent}
            onStop={() => api?.stop()}
            onEscape={collapse}
            onHoldOpen={holdOpen}
          />
        ) : null}
      </div>

      <div
        className="companion-hull"
        data-active={arcVisible || undefined}
        onMouseEnter={() => api?.setHovered(true)}
        onMouseLeave={() => api?.setHovered(false)}
      >
        <div
          className="companion-arc"
          data-visible={arcVisible || undefined}
          aria-hidden={!arcVisible}
        >
          <button
            type="button"
            className="companion-arc__button"
            style={arcButtonStyle(0, edgeH, edgeV)}
            aria-pressed={readAloudEnabled}
            data-live={state.readAloudPlaying || undefined}
            tabIndex={arcVisible ? 0 : -1}
            title={t(
              readAloudEnabled
                ? "companion.arc.readAloudOn"
                : "companion.arc.readAloudOff",
            )}
            aria-label={t(
              readAloudEnabled
                ? "companion.arc.readAloudOn"
                : "companion.arc.readAloudOff",
            )}
            onClick={toggleReadAloud}
          >
            <Volume2 size={17} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            className="companion-arc__button"
            style={arcButtonStyle(1, edgeH, edgeV)}
            aria-pressed={dictation.isRecording}
            data-live={dictation.isRecording || undefined}
            disabled={dictation.isTranscribing}
            tabIndex={arcVisible ? 0 : -1}
            title={t(
              dictation.isRecording
                ? "companion.arc.dictateStop"
                : "companion.arc.dictate",
            )}
            aria-label={t(
              dictation.isRecording
                ? "companion.arc.dictateStop"
                : "companion.arc.dictate",
            )}
            onClick={dictation.toggle}
            onPointerEnter={dictation.prewarm}
            onFocus={dictation.prewarm}
          >
            <Mic size={17} strokeWidth={1.75} />
          </button>
          {showVoice ? (
            <button
              type="button"
              className="companion-arc__button"
              style={arcButtonStyle(2, edgeH, edgeV)}
              aria-pressed={voiceActive}
              data-live={voiceActive || undefined}
              tabIndex={arcVisible ? 0 : -1}
              title={t(
                voiceActive ? "companion.arc.voiceStop" : "companion.arc.voice",
              )}
              aria-label={t(
                voiceActive ? "companion.arc.voiceStop" : "companion.arc.voice",
              )}
              onClick={toggleVoice}
            >
              <AudioLines size={17} strokeWidth={1.75} />
            </button>
          ) : null}
        </div>
        <button
          type="button"
          className="companion-mark-hit"
          aria-label={t(
            expanded ? "companion.mark.close" : "companion.mark.open",
          )}
          aria-expanded={expanded}
          tabIndex={-1}
          {...markPressHandlers}
        />
      </div>
    </div>
  );
}
