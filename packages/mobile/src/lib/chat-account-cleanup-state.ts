import AsyncStorage from "@react-native-async-storage/async-storage";

export const CHAT_ACCOUNT_CLEANUP_REQUIRED_KEY =
  "stella-mobile-chat-account-cleanup-required-v1";
export const CHAT_ACCOUNT_CANONICAL_CLEARED_KEY =
  "stella-mobile-chat-account-canonical-cleared-v1";

const cleanupToken = (): string =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

export async function loadAccountChatCleanupIntent(): Promise<string | null> {
  const value = await AsyncStorage.getItem(CHAT_ACCOUNT_CLEANUP_REQUIRED_KEY);
  return value?.trim() || null;
}

export async function loadAccountChatCleanupProgress(token: string): Promise<{
  canonicalCleared: boolean;
}> {
  const entries = await AsyncStorage.multiGet([
    CHAT_ACCOUNT_CLEANUP_REQUIRED_KEY,
    CHAT_ACCOUNT_CANONICAL_CLEARED_KEY,
  ]);
  const values = new Map(entries);
  return {
    canonicalCleared:
      values.get(CHAT_ACCOUNT_CLEANUP_REQUIRED_KEY) === token &&
      values.get(CHAT_ACCOUNT_CANONICAL_CLEARED_KEY) === token,
  };
}

export async function beginAccountChatCleanupIntent(): Promise<string> {
  const existing = await loadAccountChatCleanupIntent();
  if (existing) return existing;
  const token = cleanupToken();
  await AsyncStorage.setItem(CHAT_ACCOUNT_CLEANUP_REQUIRED_KEY, token);
  return token;
}

export async function markAccountCanonicalChatCleared(
  token: string,
): Promise<void> {
  if ((await loadAccountChatCleanupIntent()) !== token) return;
  await AsyncStorage.setItem(CHAT_ACCOUNT_CANONICAL_CLEARED_KEY, token);
}

export async function finalizeAccountChatCleanup(
  token: string,
): Promise<boolean> {
  if (!(await loadAccountChatCleanupProgress(token)).canonicalCleared) {
    return false;
  }
  await AsyncStorage.multiRemove([
    CHAT_ACCOUNT_CLEANUP_REQUIRED_KEY,
    CHAT_ACCOUNT_CANONICAL_CLEARED_KEY,
  ]);
  return true;
}
