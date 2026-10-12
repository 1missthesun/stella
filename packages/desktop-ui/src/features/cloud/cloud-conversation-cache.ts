import { uiState } from "@/platform/ui-state";

const STORAGE_KEY_PREFIX = "stella:activeCloudConversationId:";
const MAX_ID_LENGTH = 64;
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

const storageKey = (accountScope: string): string =>
  `${STORAGE_KEY_PREFIX}${encodeURIComponent(accountScope)}`;

const validConversationId = (value: string | null): value is string =>
  Boolean(value && value.length <= MAX_ID_LENGTH && ID_PATTERN.test(value));

/**
 * Cloud selection is account-scoped. A UUID from the previous Better Auth
 * identity must never be treated as the active conversation for the next one.
 */
export const readActiveCloudConversationIdCache = (
  accountScope: string,
): string | null => {
  if (typeof window === "undefined") return null;
  const value = uiState.getItem(storageKey(accountScope));
  return validConversationId(value) ? value : null;
};

export const writeActiveCloudConversationIdCache = (
  accountScope: string,
  conversationId: string,
): void => {
  if (typeof window === "undefined" || !validConversationId(conversationId)) {
    return;
  }
  uiState.setItem(storageKey(accountScope), conversationId);
};

