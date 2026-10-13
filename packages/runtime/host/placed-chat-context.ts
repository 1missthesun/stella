/**
 * What a composer send carries besides its typed text, for a chat placed on
 * another host (the computer holding the chat, or the cloud): pasted text,
 * quoted text, selected Stella areas and activities, the active window. The
 * model reads it hidden, as it would here, and the sent message shows its
 * chips. Without it a placed send kept only the typed line.
 */
import type { RuntimeChatPayload } from "@stella/contracts/protocol";
import {
  TURN_CONTEXT_DISPLAY_MAX_CHARS,
  TURN_CONTEXT_TEXT_MAX_CHARS,
  type CloudTurnContext,
} from "@stella/contracts/turn-plane/turn-start";
import { buildChatPromptMessages } from "../kernel/chat-prompt-context.js";

export class PlacedChatTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlacedChatTooLargeError";
  }
}

const formatChars = (chars: number) => chars.toLocaleString("en-US");

export const placedChatContext = (
  payload: Pick<RuntimeChatPayload, "chatContext" | "selectedText">,
): CloudTurnContext | undefined => {
  const selectedText =
    (typeof payload.selectedText === "string" ? payload.selectedText : null) ??
    payload.chatContext?.selectedText ??
    null;
  if (!payload.chatContext && !selectedText?.trim()) return undefined;
  // The typed text stays out: the host running the turn reads it (and any
  // @model mention in it) from the prompt itself.
  const built = buildChatPromptMessages({
    userPrompt: "",
    selectedText,
    chatContext: payload.chatContext ?? null,
  });
  const text = (built.promptMessages ?? [])
    .map((message) => message.text)
    .filter((part) => part.trim())
    .join("\n\n");
  const display: Record<string, unknown> = {
    ...(built.appSelectionLabel ? { appSelectionLabel: built.appSelectionLabel } : {}),
    ...(built.appSelectionLabels?.length ? { appSelectionLabels: built.appSelectionLabels } : {}),
    ...(built.activityLabel ? { activityLabel: built.activityLabel } : {}),
    ...(built.quotedText ? { quotedText: built.quotedText } : {}),
    ...(built.pastedTexts?.length ? { pastedTexts: built.pastedTexts } : {}),
    ...(built.windowContextLabel ? { windowLabel: built.windowContextLabel } : {}),
    ...(built.browserUrl ? { browserUrl: built.browserUrl } : {}),
  };
  if (text.length > TURN_CONTEXT_TEXT_MAX_CHARS) {
    throw new PlacedChatTooLargeError(
      `The pasted or attached text is too long to send to where Stella runs (${formatChars(text.length)} characters; the limit is ${formatChars(TURN_CONTEXT_TEXT_MAX_CHARS)}). Attach it as a file instead.`,
    );
  }
  // Labels and previews only, so this one is trimmed, not refused.
  let shown = display;
  if (JSON.stringify(shown).length > TURN_CONTEXT_DISPLAY_MAX_CHARS) {
    const { windowLabel: _windowLabel, ...rest } = shown;
    shown = rest;
  }
  if (JSON.stringify(shown).length > TURN_CONTEXT_DISPLAY_MAX_CHARS) {
    shown = {
      ...shown,
      ...(built.pastedTexts?.length
        ? { pastedTexts: built.pastedTexts.map(({ lines, chars }) => ({ lines, chars })) }
        : {}),
      ...(built.quotedText ? { quotedText: built.quotedText.slice(0, 1_000) } : {}),
    };
  }
  const hasDisplay =
    Object.keys(shown).length > 0 &&
    JSON.stringify(shown).length <= TURN_CONTEXT_DISPLAY_MAX_CHARS;
  if (!text && !hasDisplay) return undefined;
  return {
    ...(text ? { text } : {}),
    ...(hasDisplay ? { display: shown } : {}),
  };
};
