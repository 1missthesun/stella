import type { ElectronLocalChatApi } from "@/shared/types/electron";

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
