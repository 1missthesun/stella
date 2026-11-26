import { createContext, useContext } from "react";
import { CHAT_TEXT, CHAT_TEXT_COMPACT, type ChatText } from "../kit";

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

/** `.chat-conversation-surface--sidebar` (compact-conversation.css) vs the full chat timeline. */
export type ChatVariant = "full" | "sidebar";
export const ChatVariantContext = createContext<ChatVariant>("full");

export type ChatSurfaceLook = {
  text: typeof CHAT_TEXT_LOOK;
  line: number;
  markdown: ChatText;
  user: { radius: number; maxW: `${number}%`; py: number; px: number };
  assistant: { radius: number; maxW: `${number}%`; py: number; px: number };
};

const textLook = (text: ChatText) => ({ size: text.size, weight: text.weight, lineHeight: Math.round(text.size * text.lineHeight * 100) / 100, tracking: 0 });

const FULL_LOOK: ChatSurfaceLook = {
  text: CHAT_TEXT_LOOK,
  line: CHAT_LINE,
  markdown: CHAT_TEXT,
  user: { radius: 18, maxW: "85%", py: 5 + 1, px: 12 + 1 },
  assistant: { radius: 18, maxW: "85%", py: 8, px: 14 },
};

const SIDEBAR_LOOK: ChatSurfaceLook = {
  text: textLook(CHAT_TEXT_COMPACT),
  line: textLook(CHAT_TEXT_COMPACT).lineHeight,
  markdown: CHAT_TEXT_COMPACT,
  user: { radius: 14, maxW: "88%", py: 5 + 1, px: 12 + 1 },
  assistant: { radius: 14, maxW: "85%", py: 6, px: 12 },
};

export const useChatSurfaceLook = (): ChatSurfaceLook => (useContext(ChatVariantContext) === "sidebar" ? SIDEBAR_LOOK : FULL_LOOK);
