import { useChatStorageMode } from "@/features/chat/services/chat-storage-preference";
import { useMemo } from "react";
import type { ReactNode } from "react";
import { useCloudConversationSession } from "@/global/auth/hooks/use-cloud-conversation-session";
import {
  ChatStoreContextProvider,
  LocalChatStoreProvider,
  useChatStore,
  type ChatStorageMode,
  type ChatStoreContextValue,
} from "./chat-store-context";

export { LocalChatStoreProvider, useChatStore };

export const ChatStoreProvider = ({ children }: { children: ReactNode }) => {
  const { isCloudConversationReady, isCloudConversationPaused } =
    useCloudConversationSession();

  const storageMode: ChatStorageMode = useChatStorageMode();
  const cloudFeaturesEnabled = storageMode === "cloud" && isCloudConversationReady;
  const cloudChatPaused =
    storageMode === "cloud" && !isCloudConversationReady && isCloudConversationPaused;
  const isLocalStorage = Boolean(window.electronAPI?.localChat);

  const value = useMemo<ChatStoreContextValue>(
    () => ({
      storageMode,
      isLocalStorage,
      cloudFeaturesEnabled,
      cloudChatPaused,
      isAuthenticated: isCloudConversationReady,
    }),
    [
      cloudChatPaused,
      storageMode,
      isLocalStorage,
      cloudFeaturesEnabled,
      isCloudConversationReady,
    ],
  );

  return (
    <ChatStoreContextProvider value={value}>
      {children}
    </ChatStoreContextProvider>
  );
};
