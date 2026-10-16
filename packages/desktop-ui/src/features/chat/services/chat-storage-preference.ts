import { uiState } from "@/platform/ui-state";
import { useSyncExternalStore } from "react";

const KEY = "stella:chat-storage-mode";
const EVENT = "stella:chat-storage-changed";
// Set while chats are local only because there is no account yet; signing in asks what to do with them.
const SIGNED_OUT_KEY = "stella:chat-storage-signed-out";
export const isPrivateConversationId = (id: string | null | undefined) =>
  Boolean(id?.startsWith("local_"));
export const getChatStorageMode = (): "cloud" | "local" =>
  typeof window !== "undefined" &&
  window.electronAPI?.localChat &&
  uiState.getItem(KEY) === "local"
    ? "local"
    : "cloud";
const subscribe = (listener: () => void) => {
  window.addEventListener(EVENT, listener);
  const stopExternal = uiState.onExternalChange(listener);
  return () => {
    window.removeEventListener(EVENT, listener);
    stopExternal();
  };
};
export const useChatStorageMode = () =>
  useSyncExternalStore(subscribe, getChatStorageMode, () => "cloud" as const);
export const setChatStorageMode = async (mode: "cloud" | "local") => {
  await window.electronAPI?.system.setCloudSyncEnabled({
    enabled: mode === "cloud",
  });
  uiState.setItem(KEY, mode);
  window.dispatchEvent(new Event(EVENT));
};
export const createPrivateConversation = async () => {
  const id = `local_${crypto.randomUUID()}`;
  await window.electronAPI!.localChat.setActiveConversationId({
    conversationId: id,
  });
  return id;
};
export const selectPrivateConversation = async (requested: string | null) => {
  const cached =
    await window.electronAPI!.localChat.getOrCreateDefaultConversationId();
  const id = isPrivateConversationId(requested)
    ? requested
    : isPrivateConversationId(cached)
      ? cached
      : null;
  if (!id) return createPrivateConversation();
  await window.electronAPI!.localChat.setActiveConversationId({
    conversationId: id,
  });
  return id;
};

const hasLocalChat = () =>
  typeof window !== "undefined" && Boolean(window.electronAPI?.localChat);

/** No account: keep chats on this computer. A local choice the user made stays theirs. */
export const enterSignedOutLocalMode = () => {
  if (!hasLocalChat() || uiState.getItem(KEY) === "local") return;
  uiState.setItem(SIGNED_OUT_KEY, "1");
  uiState.setItem(KEY, "local");
  window.dispatchEvent(new Event(EVENT));
};

export const isSignedOutLocalMode = () =>
  getChatStorageMode() === "local" && uiState.getItem(SIGNED_OUT_KEY) === "1";

export const useSignedOutLocalMode = () =>
  useSyncExternalStore(subscribe, isSignedOutLocalMode, () => false);

/** After sign-in: keep chats on this computer for good, or go back to synced chats. */
export const settleSignedOutLocalMode = async (mode: "cloud" | "local") => {
  uiState.removeItem(SIGNED_OUT_KEY);
  await setChatStorageMode(mode);
};

// The local chat the user chose to sync at sign-in, copied once the account's chat is open.
const SYNC_PENDING_KEY = "stella:chat-storage-sync-pending";
export const pendingLocalChatSync = () => uiState.getItem(SYNC_PENDING_KEY);
export const markLocalChatSync = (localConversationId: string) =>
  uiState.setItem(SYNC_PENDING_KEY, localConversationId);
export const clearLocalChatSync = () => uiState.removeItem(SYNC_PENDING_KEY);
