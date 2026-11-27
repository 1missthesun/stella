import { useEffect, useId, type Dispatch, type SetStateAction } from "react";
import type { ChatContext } from "@/shared/types/electron";
import type { useDictation } from "@/features/dictation/hooks/use-dictation";
import { useT } from "@/shared/i18n";
import { ComposerAddMenu } from "../../chat/ComposerAddMenu";
import { ComposerAttachmentTilesSection } from "../../chat/ComposerContextSections";
import { ComposerSubmitButton } from "../../chat/ComposerPrimitives";
import { ComposerShell } from "../../chat/ComposerShell";
import { DictationCancelButton, DictationRecordingBar } from "../../chat/DictationRecordingBar";

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
  onEscape: () => void;
  onHoldOpen: (hold: boolean) => void;
};

const hasAttachments = (context: ChatContext | null) => Boolean(context?.files?.length || context?.regionScreenshots?.length || context?.pastedTexts?.length);

/** desktop-ui's `CompanionComposer`: the chat composer's shell, popping in above the mark. */
export function CompanionComposer({ message, setMessage, attachments, setAttachments, dictation, focusRequestId, onSend, onEscape, onHoldOpen }: CompanionComposerProps) {
  const t = useT();
  const inputId = `companion-composer-input:${useId()}`;
  const attached = hasAttachments(attachments);
  const hasText = message.trim().length > 0;
  const dictationInFlight = dictation.isRecording || dictation.isTranscribing;
  const canSubmit = hasText || attached || dictationInFlight;
  const recording = dictation.isRecordingVisible;

  useEffect(() => {
    if (dictation.isRecording) return;
    const frame = setTimeout(() => void stella.engine.focus(inputId).catch(() => {}), 16);
    return () => clearTimeout(frame);
  }, [dictation.isRecording, focusRequestId, inputId]);

  const submit = () => {
    if (dictationInFlight) {
      dictation.commitAndSend();
      return;
    }
    if (!hasText && !attached) return;
    onSend();
  };

  return (
    <col w="full" origin={[0.5, 1]} enter={{ opacity: 0, y: 8, scale: 0.96, dur: 0.24, bounce: 0.3 }}>
      <ComposerShell
        bare
        inputId={inputId}
        value={message}
        onChange={setMessage}
        onSubmit={submit}
        placeholder={t("companion.composer.placeholder")}
        canSubmit={canSubmit}
        keys={["Escape"]}
        onKey={(e) => {
          if (e.key === "Escape") onEscape();
        }}
        header={
          attached ? (
            <row w="full" pt={8} px={8}>
              <ComposerAttachmentTilesSection variant="full" chatContext={attachments} setChatContext={setAttachments} />
            </row>
          ) : undefined
        }
        replace={
          recording ? (
            <row w="full" minH={44} py={6} px={8} align="center">
              <DictationRecordingBar readLevel={dictation.readLevel} elapsedMs={dictation.elapsedMs} onCancel={dictation.cancel} onConfirm={dictation.toggle} onSend={dictation.commitAndSend} showControls={dictation.showControls} />
            </row>
          ) : undefined
        }
        leading={
          <box onDrag={(d) => d.phase === "start" && onHoldOpen(true)}>
            <ComposerAddMenu title={t("app.chat.composer.add")} setChatContext={setAttachments} allowCapture={false} />
          </box>
        }
        trailing={
          <row align="center" gap={8}>
            {dictation.isTranscribing ? <DictationCancelButton onClick={dictation.cancel} /> : null}
            <ComposerSubmitButton disabled={!canSubmit} animated onPress={submit} />
          </row>
        }
      />
    </col>
  );
}
