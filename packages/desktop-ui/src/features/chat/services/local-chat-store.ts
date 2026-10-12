/**
 * Bootstrap helpers used before any conversation context exists. The chat
 * surfaces themselves read from `local-message-timeline-store.ts` /
 * `local-activity-store.ts` / `local-files-store.ts`.
 */
import type { ElectronLocalChatApi } from "@/shared/types/electron";

/**
 * Absent outside Electron (plain-browser `bun run dev`): chat persistence
 * lives in main-process SQLite, so conversation creation fails loudly — a
 * browser tab has no chat backend to create against.
 */
export const isLocalChatApiAvailable = () =>
  Boolean(window.electronAPI?.localChat);
const getLocalChatApi = (): ElectronLocalChatApi => {
  const api = window.electronAPI?.localChat;
  if (!api) {
    throw new Error(
      "[local-chat-store] Electron local chat API is unavailable.",
    );
  }
  return api;
};
export const getOrCreateLocalConversationId = async (): Promise<string> =>
  getLocalChatApi().getOrCreateDefaultConversationId();
