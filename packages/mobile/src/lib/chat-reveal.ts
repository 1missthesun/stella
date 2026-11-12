import { createContext, useContext } from "react";
import type { View } from "react-native";

/**
 * Lets a chat row ask the chat list to bring all of it into view, for rows
 * that grow when opened (an email summary list) and would otherwise spill
 * past the top bar or the composer.
 */
export type ChatReveal = (node: View | null) => void;

export const ChatRevealContext = createContext<ChatReveal | null>(null);

export const useChatReveal = (): ChatReveal | null =>
  useContext(ChatRevealContext);
