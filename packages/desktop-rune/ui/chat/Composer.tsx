import { chromeGlass, useGlassBackdrop } from "../shell/glass";
import { memo, useCallback, useEffect, useId, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { ChatContext } from "@/shared/types/electron";
import { useComposerModelPinned } from "@/features/chat/composer-model-pin-store";
import { useOptimisticStop } from "@/features/chat/hooks/use-optimistic-stop";
import { deriveComposerState, hasAttachedComposerChips } from "@/features/chat/composer-context";
import { attachPastedText, shouldAttachPastedText } from "@/features/chat/lib/paste-context";
import { PASTE_AS_ATTACHMENT_MIN_CHARS, PASTE_AS_ATTACHMENT_MIN_LINES } from "@stella/contracts/pasted-text";
import { findDelegatedModelMentions } from "@stella/contracts/model-mentions";
import { useDictation } from "@/features/dictation/hooks/use-dictation";
import { useDictationPaste } from "@/features/dictation/hooks/use-dictation-paste";
import { DictationCancelButton, DictationRecordingBar } from "./DictationRecordingBar";
import { applyComposerModelMention, findComposerModelMentionTrigger, type ComposerModelMentionMenuHandle, type ComposerModelMentionOption, type ComposerModelMentionTrigger } from "@/app/chat/ComposerModelMentionMenu";
import { ComposerModelMentionMenu } from "./ComposerModelMentionMenu";
import { MiniModelPicker } from "./MiniModelPicker";
import { useUiState } from "@/context/ui-state";
import { useStellaModelsSignIn } from "@/global/auth/hooks/use-stella-models-sign-in";
import { platformCapabilities } from "@/platform/capabilities";
import { useRealtimeVoiceVisible } from "@/shared/lib/realtime-voice-visibility";
import { useT } from "@/shared/i18n";
import type { InputKeyEvent } from "../../host/rune-jsx/props";
import { derive, fontSize, mixOklch, useTokens } from "../theme";
import { APP_TRACKING } from "../kit/compat";
import { ComposerContextRow } from "./ComposerContextRow";
import { ComposerLeadRow } from "./ComposerLeadRow";
import type { AssistantReplyPeekProps } from "./AssistantReplyPeek";
import { ComposerAddMenu } from "./ComposerAddMenu";
import { ComposerMicButton, ComposerRealtimeVoiceButton, ComposerSubmitButton, ComposerTextarea } from "./ComposerPrimitives";
import { ScreenshotPreviewOverlay, useScreenshotPreview } from "./ScreenshotPreview";
import { BrowserAttachmentTray } from "./BrowserAttachmentTray";
import { panelSurface } from "./surfaces";
import { attachPathsToContext } from "./attach-paths";
import { rune } from "./engine";

const MemoComposerMicButton = memo(ComposerMicButton);
const MemoComposerSubmitButton = memo(ComposerSubmitButton);

export const COMPOSER_MAX_W = 800;
export const MIN_COMPOSER_SHELL_HEIGHT = 46;
const EXPANDED_RADIUS = 20;
const SHELL_SPRING = { dur: 0.35, bounce: 0 };
const LINE = fontSize.md * 1.5;
const PILL_INPUT_PAD_X = 4;
export const COMPOSER_NARROW_W = 600;
export const COMPOSER_PAD_TOP = 4;
export const COMPOSER_GAP = 8;
const COMPOSER_PAD_X = 24;

/** `.composer-shell` / `.composer-context-peek-anchor` max-width: `min(50rem, 100% - 48px)` of the padded `.composer` column. */
export const composerShellMaxW = (composerW: number) => (composerW > 0 ? Math.min(COMPOSER_MAX_W, composerW - COMPOSER_PAD_X * 2 - 48) : COMPOSER_MAX_W);
const MENU_KEYS = ["ArrowUp", "ArrowDown", "Tab", "Escape", "Enter"];
const STOP_KEYS = ["Escape"];
const NO_KEYS: string[] = [];
const INPUT_MAX_H = 200;
const PASTE_AS_ATTACHMENT = { minChars: PASTE_AS_ATTACHMENT_MIN_CHARS, minLines: PASTE_AS_ATTACHMENT_MIN_LINES };

/** `.model-mention-inline` in the field: primary text on a 14% primary wash over the font's content area, 3pt corners. */
const useMentionMarks = (message: string, tokens: ReturnType<typeof useTokens>) => {
  const look = derive(tokens, "model-mention-inline", (k) => ({ color: k.c.primary, bg: mixOklch(k.c.primary, 14, "transparent") }));
  return findDelegatedModelMentions(message).map((mention) => ({ start: mention.start, end: mention.end, color: look.color, bg: look.bg, radius: 3, pad: 0, vpad: 0 }));
};

type ComposerProps = {
  message: string;
  setMessage: Dispatch<SetStateAction<string>>;
  chatContext: ChatContext | null;
  setChatContext: Dispatch<SetStateAction<ChatContext | null>>;
  selectedText: string | null;
  setSelectedText: Dispatch<SetStateAction<string | null>>;
  isStreaming: boolean;
  canSubmit: boolean;
  focusRequestId?: number;
  conversationId: string | null;
  onSend: () => void;
  onStop: () => void;
  isDragOver?: boolean;
  replyPeek?: AssistantReplyPeekProps | null;
  catchUp?: boolean;
  suggestionsActive?: boolean;
  /** `.chat-sidebar-composer` / `.chat-sidebar-form` (chat-sidebar.css); `sidebar-wide` is `.chat-panel-tab--wide`. */
  variant?: ComposerVariant;
};

export type ComposerVariant = "full" | "sidebar" | "sidebar-wide";

/** `.composer-shell`'s look: panel surface, primary-tinted border while focused, a glow ring on file drag. */
export const composerShellLook = (t: ReturnType<typeof useTokens>) =>
  derive(t, "composer-shell", (k) => ({
    ...panelSurface(k),
    focusBorder: mixOklch(k.c.primary, 18, k.c.border),
    dragBorder: mixOklch(k.c.primary, 42, k.c.border),
    dragRing: [
      { x: 0, y: 0, blur: 0, spread: 2, color: mixOklch(k.c.primary, 38, "transparent") },
      { x: 0, y: 0, blur: 0, spread: 6, color: mixOklch(k.c.primary, 10, "transparent") },
    ],
    dictationRule: mixOklch(k.c.border, 50, "transparent"),
  }));

/**
 * desktop-ui's `updateComposerTextareaExpansion`: the field expands once its text would take more
 * than one line in the pill layout, measured by a hidden copy at the pill field's width.
 */
function usePillExpansion(message: string) {
  const [pillFieldW, setPillFieldW] = useState(0);
  const [pillTextH, setPillTextH] = useState(0);
  const expanded = message.length > 0 && pillFieldW > 0 && pillTextH > LINE + 0.5;
  const measure =
    pillFieldW > 0 && message.length > 0 ? (
      <text absolute={{ left: 0, top: 0 }} w={pillFieldW - PILL_INPUT_PAD_X * 2} size={fontSize.md} lineHeight={LINE} tracking={APP_TRACKING} hidden inert onLayout={(r) => setPillTextH(r.h)}>
        {message.endsWith("\n") ? `${message} ` : message}
      </text>
    ) : null;
  return { expanded, measure, notePillFieldW: setPillFieldW };
}

function ComposerImpl({
  message,
  setMessage,
  chatContext,
  setChatContext,
  selectedText,
  setSelectedText,
  isStreaming,
  canSubmit,
  focusRequestId,
  conversationId,
  onSend,
  onStop,
  isDragOver = false,
  replyPeek,
  catchUp = false,
  suggestionsActive: suggestionsRequested = true,
  variant = "full",
}: ComposerProps) {
  const sidebar = variant !== "full";
  const suggestionsActive = suggestionsRequested && !sidebar;
  const t = useT();
  const tokens = useTokens();
  const glassBackdrop = useGlassBackdrop();
  const { state: uiState } = useUiState();
  const voiceVisible = useRealtimeVoiceVisible() && !sidebar;
  const inputId = `composer-input:${useId()}`;
  const modelMentionMenuRef = useRef<ComposerModelMentionMenuHandle | null>(null);
  const [modelMentionTrigger, setModelMentionTrigger] = useState<ComposerModelMentionTrigger | null>(null);
  const [focused, setFocused] = useState(false);
  const [composerW, setComposerW] = useState(0);
  const caretRef = useRef<number | null>(null);
  const valueRef = useRef(message);
  valueRef.current = message;
  const { canStop, requestStop } = useOptimisticStop(isStreaming, onStop);
  const { screenshot: previewScreenshot, previewIndex: previewScreenshotIndex, setPreviewIndex: setPreviewScreenshotIndex } = useScreenshotPreview(chatContext);
  const pill = usePillExpansion(message);

  const onSendRef = useRef(onSend);
  onSendRef.current = onSend;
  const focusInput = useCallback(() => void rune().focus(inputId), [inputId]);

  const dictation = useDictation({
    setMessage,
    onTranscriptCommitted: focusInput,
    onCommit: () => onSendRef.current(),
  });

  const submitComposer = () => {
    if (!canSubmit && !dictation.isRecording && !dictation.isTranscribing) return;
    if (dictation.isRecording || dictation.isTranscribing) {
      dictation.commitAndSend();
      return;
    }
    onSend();
  };

  const composerState = deriveComposerState({ message, chatContext, selectedText, conversationId, requireConversationId: !sidebar });
  const placeholder = t(composerState.placeholderKey);
  const dictationInFlight = dictation.isRecording || dictation.isTranscribing;
  const canSubmitWithDictation = canSubmit || dictationInFlight;
  useDictationPaste({ active: dictationInFlight, setMessage, setChatContext });
  const hasText = message.trim().length > 0;
  const dictationBelow = dictation.isRecordingVisible;
  const dictationOwnsControls = dictationBelow && dictation.showControls;
  const modelPinned = useComposerModelPinned() && !sidebar;
  const isExpanded = pill.expanded || dictation.isRecordingVisible || modelPinned;

  useEffect(() => {
    if (!focusRequestId || dictation.isRecording) return;
    focusInput();
  }, [dictation.isRecording, focusInput, focusRequestId]);

  useEffect(() => {
    if (!suggestionsActive || !message) setModelMentionTrigger(null);
  }, [message, suggestionsActive]);

  const refreshModelMentionTrigger = useCallback(
    (value: string, caret: number | null) => {
      if (!suggestionsActive) {
        setModelMentionTrigger(null);
        return;
      }
      setModelMentionTrigger(findComposerModelMentionTrigger(value, caret));
    },
    [suggestionsActive],
  );

  const askToSignInForStella = useStellaModelsSignIn();
  const selectModelMention = useCallback(
    (option: ComposerModelMentionOption) => {
      if (!modelMentionTrigger) return;
      const next = applyComposerModelMention(message, modelMentionTrigger, option.value);
      setMessage(next.value);
      setModelMentionTrigger(null);
      if (option.value === "stella" && askToSignInForStella(() => undefined)) return;
      void rune().focus(inputId);
      void rune().input.select(inputId, next.caret, next.caret);
    },
    [askToSignInForStella, inputId, message, modelMentionTrigger, setMessage],
  );

  const hasAttachedChips = hasAttachedComposerChips(chatContext, selectedText);
  const showRealtimeVoice = voiceVisible && Boolean(conversationId) && !hasText && !hasAttachedChips && !dictationInFlight;
  const toggleRealtimeVoice = useCallback(() => {
    window.electronAPI?.voice?.toggleRtc?.();
  }, []);

  const onKey = (event: InputKeyEvent) => {
    if (modelMentionTrigger && modelMentionMenuRef.current?.handleKeyDown({ key: event.key, preventDefault: () => {} } as never) === true) return;
    if (event.key === "Escape" && canStop && !modelMentionTrigger && !dictationInFlight) requestStop();
  };

  const onPaste = (paste: { files: string[]; image: string | null; text: string }) => {
    const paths = [...paste.files, ...(paste.image ? [paste.image] : [])];
    if (paths.length > 0) {
      void attachPathsToContext(paths, setChatContext, { inline: paste.image ? [paste.image] : [] });
      return;
    }
    if (paste.text && shouldAttachPastedText(paste.text)) attachPastedText(paste.text, setChatContext);
  };

  const look = composerShellLook(tokens);
  const mentionMarks = useMentionMarks(message, tokens);
  const narrow = composerW > 0 && composerW < COMPOSER_NARROW_W;
  const shellMaxW = variant === "sidebar" || (variant === "full" && narrow) ? undefined : composerShellMaxW(composerW);
  const column = sidebar
    ? { gap: 6, pt: 4, pb: 8, px: variant === "sidebar-wide" ? COMPOSER_PAD_X : window.innerWidth <= COMPOSER_NARROW_W ? 6 : 12 }
    : { gap: COMPOSER_GAP, pt: COMPOSER_PAD_TOP, pb: 10, px: narrow ? 8 : COMPOSER_PAD_X };
  const radius = isExpanded || hasAttachedChips ? EXPANDED_RADIUS : MIN_COMPOSER_SHELL_HEIGHT / 2;
  const addMenu = <ComposerAddMenu title={t("app.chat.composer.add")} setChatContext={setChatContext} />;
  const hiddenFileInput = <ComposerAddMenu setChatContext={setChatContext} buttonHidden />;
  const field = (
    <box key="field" grow={1} minW={0} w={isExpanded ? "full" : undefined} selfAlign={isExpanded ? "stretch" : "center"} onLayout={isExpanded ? undefined : (r) => pill.notePillFieldW(r.w)}>
      {pill.measure}
      <ComposerTextarea
        id={inputId}
        value={message}
        placeholder={placeholder}
        disabled={!conversationId && !platformCapabilities.website}
        minH={isExpanded ? 36 : sidebar ? 26 : 28}
        pt={isExpanded ? 10 : sidebar ? 2 : 3.5}
        pb={isExpanded ? 2 : sidebar ? 2 : 3.5}
        px={isExpanded ? 16 : PILL_INPUT_PAD_X}
        maxH={INPUT_MAX_H}
        marks={mentionMarks}
        pasteAsEvent={PASTE_AS_ATTACHMENT}
        keys={modelMentionTrigger ? MENU_KEYS : canStop && !dictationInFlight ? STOP_KEYS : NO_KEYS}
        onKey={onKey}
        onInput={(value) => {
          valueRef.current = value;
          setMessage(value);
          refreshModelMentionTrigger(value, caretRef.current ?? value.length);
        }}
        onSelection={(sel) => {
          caretRef.current = sel.start;
          refreshModelMentionTrigger(valueRef.current, sel.start);
        }}
        onSubmit={() => {
          if (modelMentionTrigger) return;
          submitComposer();
        }}
        onPaste={onPaste}
        onFocus={(isFocused) => {
          if (isFocused) dictation.prewarm();
          else setModelMentionTrigger(null);
        }}
      />
    </box>
  );
  const rightControls = (
    <row key="right" shrink={false} align="center" gap={8}>
      {modelPinned ? <MiniModelPicker /> : null}
      {dictationOwnsControls ? null : (
        <>
          <row align="center" gap={2}>
            {dictation.isTranscribing ? <DictationCancelButton onClick={dictation.cancel} /> : null}
            <MemoComposerMicButton
              isTranscribing={dictation.isTranscribing}
              disabled={dictation.isTranscribing}
              onPress={dictation.toggle}
              onHover={(inside) => inside && dictation.prewarm()}
              onFocus={(isFocused) => isFocused && dictation.prewarm()}
              title={dictation.error ? t("app.chat.composer.dictationError", { error: dictation.error }) : undefined}
            />
            {showRealtimeVoice ? <ComposerRealtimeVoiceButton active={Boolean(uiState.isVoiceRtcActive)} onPress={toggleRealtimeVoice} /> : null}
          </row>
          {showRealtimeVoice ? null : <MemoComposerSubmitButton disabled={!canSubmitWithDictation} animated onPress={submitComposer} />}
        </>
      )}
    </row>
  );

  return (
    <col w="full" shrink={false} align="center" justify="end" {...column} onLayout={(r) => setComposerW(r.w)}>
      <ComposerLeadRow replyPeek={replyPeek} catchUpConversationId={catchUp && !sidebar ? conversationId : null} maxW={shellMaxW} />
      <col
        w="full"
        maxW={shellMaxW}
        minH={MIN_COMPOSER_SHELL_HEIGHT}
        pad={1}
        radius={radius}
        clip={radius}
        {...(sidebar
          ? { gradient: look.gradient, border: isDragOver ? look.dragBorder : focused ? look.focusBorder : look.border, shadows: isDragOver ? [...look.shadows, ...look.dragRing] : look.shadows }
          : { fx: chromeGlass(tokens).composer, onBackdrop: glassBackdrop, border: isDragOver ? look.dragBorder : undefined, shadows: isDragOver ? [...tokens.shadow.md, ...look.dragRing] : tokens.shadow.md })}
        motion={SHELL_SPRING}
        layout={SHELL_SPRING.dur}
        onFocusWithin={setFocused}
      >
        {hasAttachedChips ? (
          <row w="full" wrap pt={8} px={14}>
            <ComposerContextRow chatContext={chatContext} selectedText={selectedText} setChatContext={setChatContext} setSelectedText={setSelectedText} onPreviewScreenshot={setPreviewScreenshotIndex} />
          </row>
        ) : null}
        <BrowserAttachmentTray />
        <col w="full" gap={isExpanded ? 8 : 0} role="form" label="chat-composer">
          <row w="full" align="center" gap={8} minH={isExpanded ? undefined : 44} py={isExpanded ? 0 : 6} px={isExpanded ? 0 : sidebar ? 6 : 8}>
            {isExpanded ? hiddenFileInput : <box key="add">{addMenu}</box>}
            {field}
            {isExpanded ? null : hiddenFileInput}
            {isExpanded ? null : rightControls}
          </row>
          {isExpanded ? (
            <row w="full" align="center" justify="between" pt={2} px={8} pb={6}>
              <row align="center" gap={4}>
                {addMenu}
              </row>
              {rightControls}
            </row>
          ) : null}
          {isExpanded && dictationBelow ? (
            <row w="full" align="center" gap={8} pt={6 + 1} px={12} pb={8} borderSides={[1, 0, 0, 0]} border={look.dictationRule}>
              <DictationRecordingBar
                readLevel={dictation.readLevel}
                elapsedMs={dictation.elapsedMs}
                onCancel={dictation.cancel}
                onConfirm={dictation.toggle}
                onSend={dictation.commitAndSend}
                showControls={dictation.showControls}
              />
            </row>
          ) : null}
        </col>
      </col>
      {previewScreenshot && previewScreenshotIndex !== null ? <ScreenshotPreviewOverlay screenshot={previewScreenshot} index={previewScreenshotIndex} onClose={() => setPreviewScreenshotIndex(null)} /> : null}
      {modelMentionTrigger && suggestionsActive ? (
        <ComposerModelMentionMenu ref={modelMentionMenuRef} trigger={modelMentionTrigger} anchorTo={`${inputId}-box`} onSelect={selectModelMention} onDismiss={() => setModelMentionTrigger(null)} />
      ) : null}
    </col>
  );
}

export const Composer = memo(ComposerImpl);
