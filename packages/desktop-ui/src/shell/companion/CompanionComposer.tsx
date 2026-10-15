import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { ChatContext } from "@/shared/types/electron";
import { ComposerAddMenu } from "@/app/chat/ComposerAddMenu";
import { ComposerAttachmentTilesSection } from "@/app/chat/ComposerContextSections";
import {
  ComposerStopButton,
  ComposerSubmitButton,
  ComposerTextarea,
} from "@/features/chat/ComposerPrimitives";
import { handleComposerPaste } from "@/features/chat/lib/paste-context";
import {
  DictationCancelButton,
  DictationRecordingBar,
} from "@/features/dictation/components/DictationRecordingBar";
import type { useDictation } from "@/features/dictation/hooks/use-dictation";
import {
  updateComposerTextareaExpansion,
  useAnimatedComposerShell,
} from "@/shared/hooks/use-animated-composer-shell";
import { useT } from "@/shared/i18n";
import "@/app/chat/full-shell.composer.css";
import "@/features/chat/composer-primitives.css";

type Dictation = ReturnType<typeof useDictation>;

type CompanionComposerProps = {
  message: string;
  setMessage: Dispatch<SetStateAction<string>>;
  attachments: ChatContext | null;
  setAttachments: Dispatch<SetStateAction<ChatContext | null>>;
  dictation: Dictation;
  isStreaming: boolean;
  focusRequestId: number;
  onSend: () => void;
  onStop: () => void;
  onEscape: () => void;
  /** The + menu or its file picker is about to take focus from the panel. */
  onHoldOpen: (hold: boolean) => void;
};

const hasAttachments = (context: ChatContext | null) =>
  Boolean(
    context?.files?.length ||
      context?.regionScreenshots?.length ||
      context?.pastedTexts?.length,
  );

// Same shell, form and auto-grow as the main chat composer (Composer.tsx), so
// the pill grows into the multi-line layout with the same padding, radius and
// max height.
export function CompanionComposer({
  message,
  setMessage,
  attachments,
  setAttachments,
  dictation,
  isStreaming,
  focusRequestId,
  onSend,
  onStop,
  onEscape,
  onHoldOpen,
}: CompanionComposerProps) {
  const t = useT();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const shellContentRef = useRef<HTMLDivElement | null>(null);
  const [textExpanded, setTextExpanded] = useState(false);
  const attached = hasAttachments(attachments);
  const hasText = message.trim().length > 0;
  const dictationInFlight = dictation.isRecording || dictation.isTranscribing;
  const canSubmit = hasText || attached || dictationInFlight;
  const recording = dictation.isRecordingVisible;

  useAnimatedComposerShell({ shellRef, contentRef: shellContentRef, formRef });

  useEffect(() => {
    if (dictation.isRecording) return;
    const raf = requestAnimationFrame(() => textareaRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [dictation.isRecording, focusRequestId]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      updateComposerTextareaExpansion(textareaRef.current, setTextExpanded);
    });
    return () => cancelAnimationFrame(raf);
  }, [message]);

  const submit = () => {
    if (dictationInFlight) {
      dictation.commitAndSend();
      return;
    }
    if (!hasText && !attached) return;
    onSend();
  };

  const addMenu = (className: string) => (
    <ComposerAddMenu
      className={className}
      title={t("app.chat.composer.add")}
      setChatContext={setAttachments}
      allowCapture={false}
    />
  );

  return (
    <div
      ref={shellRef}
      className="composer-shell companion-composer"
      data-recording={recording || undefined}
      data-testid="companion-composer"
    >
      <div ref={shellContentRef} className="composer-shell-content">
        {attached && (
          <div className="composer-attached-strip">
            <div className="composer-context-actions">
              <ComposerAttachmentTilesSection
                variant="full"
                chatContext={attachments}
                setChatContext={setAttachments}
              />
            </div>
          </div>
        )}
        <form
          ref={formRef}
          className={`composer-form${textExpanded && !recording ? " expanded" : ""}`}
          aria-busy={isStreaming}
          onPointerDownCapture={(event) => {
            onHoldOpen(
              event.target instanceof Element &&
                event.target.closest(".composer-add-button") !== null,
            );
          }}
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          {recording ? (
            <DictationRecordingBar
              readLevel={dictation.readLevel}
              elapsedMs={dictation.elapsedMs}
              onCancel={dictation.cancel}
              onConfirm={dictation.toggle}
              onSend={dictation.commitAndSend}
              showControls={dictation.showControls}
            />
          ) : (
            <>
              {addMenu("composer-add-button")}
              <ComposerTextarea
                ref={textareaRef}
                className="composer-input"
                value={message}
                rows={1}
                placeholder={t("companion.composer.placeholder")}
                onChange={(event) => {
                  setMessage(event.target.value);
                  requestAnimationFrame(() => {
                    updateComposerTextareaExpansion(
                      textareaRef.current,
                      setTextExpanded,
                    );
                  });
                }}
                onPaste={(event) => {
                  handleComposerPaste(event, setAttachments);
                }}
                onKeyDown={(event) => {
                  if (
                    event.nativeEvent.isComposing ||
                    event.nativeEvent.keyCode === 229
                  ) {
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    onEscape();
                    return;
                  }
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    submit();
                  }
                }}
              />
              <div className="composer-toolbar">
                <div className="composer-toolbar-left">
                  {addMenu("composer-add-button composer-add-button--toolbar")}
                </div>
                <div className="composer-toolbar-right">
                  {dictation.isTranscribing && (
                    <DictationCancelButton onClick={dictation.cancel} />
                  )}
                  {isStreaming ? (
                    <ComposerStopButton
                      className="composer-stop"
                      onClick={onStop}
                      title={t("app.chat.composer.stop")}
                      aria-label={t("app.chat.composer.stop")}
                    />
                  ) : (
                    <ComposerSubmitButton
                      className="composer-submit"
                      disabled={!canSubmit}
                      animated
                    />
                  )}
                </div>
              </div>
            </>
          )}
        </form>
      </div>
    </div>
  );
}
