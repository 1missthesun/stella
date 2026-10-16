import { uiState } from "@/platform/ui-state";
import { useSyncExternalStore } from "react";

const KEY = "stella:chat-storage-mode";
const EVENT = "stella:chat-storage-changed";
// Set while chats are local only because there is no account yet; signing in asks what to do with them.
const SIGNED_OUT_KEY = "stella:chat-storage-signed-out";
// Set when the user kept signed-out work on this computer; memory stays local until chats sync again.
const MEMORY_KEPT_LOCAL_KEY = "stella:memory-kept-local";
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
  if (mode === "cloud") uiState.removeItem(MEMORY_KEPT_LOCAL_KEY);
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
  if (mode === "local") uiState.setItem(MEMORY_KEPT_LOCAL_KEY, "1");
  await setChatStorageMode(mode);
};

/** Memory files stay on this computer until the signed-out keep-or-sync choice says sync. */
export const isMemorySyncHeld = () =>
  isSignedOutLocalMode() || uiState.getItem(MEMORY_KEPT_LOCAL_KEY) === "1";

export const useMemorySyncHeld = () =>
  useSyncExternalStore(subscribe, isMemorySyncHeld, () => false);

// The local chat the user chose to sync at sign-in, copied once the account's chat is open.
const SYNC_PENDING_KEY = "stella:chat-storage-sync-pending";
export const pendingLocalChatSync = () => uiState.getItem(SYNC_PENDING_KEY);
export const markLocalChatSync = (localConversationId: string) =>
  uiState.setItem(SYNC_PENDING_KEY, localConversationId);
export const clearLocalChatSync = () => uiState.removeItem(SYNC_PENDING_KEY);
