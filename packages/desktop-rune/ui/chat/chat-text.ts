import { createContext, useContext } from "react";
import { CHAT_TEXT } from "../kit";

/** `.chat-viewport-region`'s `--chat-text-*` metrics as an engine text look. */
export const CHAT_TEXT_LOOK = {
  size: CHAT_TEXT.size,
  weight: CHAT_TEXT.weight,
  lineHeight: Math.round(CHAT_TEXT.size * CHAT_TEXT.lineHeight * 100) / 100,
  tracking: 0,
};

/** One chat line: `--chat-text-size × --chat-text-line-height`. */
export const CHAT_LINE = CHAT_TEXT_LOOK.lineHeight;

/** `.chat-bubble-text`: no kerning, no ligatures. */
export const BUBBLE_FEATURES = "'kern' 0, 'liga' 0, 'clig' 0";

/** `--chat-text-color`: textStrong in the timeline, the bubble's text colour inside a bubble. */
export const ChatTextColor = createContext<string | null>(null);
export const useChatTextColor = (fallback: string) => useContext(ChatTextColor) ?? fallback;
