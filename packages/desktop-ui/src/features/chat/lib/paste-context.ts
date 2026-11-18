import type { ClipboardEvent, Dispatch, SetStateAction } from "react";
import type { ChatContext } from "@/shared/types/electron";
import {
  normalizePastedText,
  shouldAttachPastedText,
  type PastedTextDescriptor,
} from "@stella/contracts/pasted-text";
import { attachFilesToContext } from "./file-attach";

type SetChatContext = Dispatch<SetStateAction<ChatContext | null>>;

export {
  PASTED_TEXT_PREVIEW_MAX_CHARS,
  shouldAttachPastedText,
  toPastedTextDescriptor,
  type PastedTextDescriptor,
} from "@stella/contracts/pasted-text";

export const describePastedText = (descriptor: PastedTextDescriptor): string =>
  descriptor.lines > 1
    ? `${descriptor.lines.toLocaleString()} lines`
    : `${descriptor.chars.toLocaleString()} chars`;

export const pastedTextPreview = (descriptor: PastedTextDescriptor): string => {
  const text = descriptor.text ?? "";
  if (!text) return "";
  return descriptor.chars > text.length ? `${text}…` : text;
};

export const attachPastedText = (
  text: string,
  setChatContext: SetChatContext,
): void => {
  const trimmed = normalizePastedText(text);
  if (!trimmed) return;
  setChatContext((prev) => {
    const base: ChatContext = prev ?? { window: null };
    return {
      ...base,
      pastedTexts: [...(base.pastedTexts ?? []), trimmed],
    };
  });
};

export const handleComposerPaste = (
  event: ClipboardEvent<HTMLTextAreaElement>,
  setChatContext: SetChatContext,
): boolean => {
  const clipboard = event.clipboardData;
  if (!clipboard) return false;
  const files = Array.from(clipboard.files ?? []);
  if (files.length > 0) {
    event.preventDefault();
    void attachFilesToContext(files, setChatContext);
    return true;
  }
  const text = clipboard.getData("text/plain");
  if (!shouldAttachPastedText(text)) return false;
  event.preventDefault();
  attachPastedText(text, setChatContext);
  return true;
};
