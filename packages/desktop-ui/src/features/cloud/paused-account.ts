import { useSyncExternalStore } from "react";
import { uiState } from "@/platform/ui-state";
import { pendingPrompts } from "./conversation-outbox";
import { cloudConversationCacheClient } from "./cloud-conversation-cache-client";

/**
 * While an account's session has ended on its own, its chat stays on screen
 * from this computer's copy, and new messages wait here until that same
 * account signs back in. Everything is keyed by account scope, so another
 * account never reads it.
 */

const GENERATION_PREFIX = "stella:cloudOwnerGeneration:";
const OUTBOX_PREFIX = "stella:paused-outbox:";
const ACTIVE_CONVERSATION_PREFIX = "stella:activeCloudConversationId:";
const LAST_ACCOUNT_SCOPE_KEY = "stella:lastAccountScope";
const SIGNED_OUT_SCOPE = "signed-out";
const MAX_WAITING = 20;
const MAX_TEXT = 8_000;

const scopeKey = (prefix: string, accountScope: string) =>
  `${prefix}${encodeURIComponent(accountScope)}`;

export const isAccountScope = (scope: string | null | undefined): scope is string =>
  Boolean(scope?.startsWith("account:"));

export const rememberOwnerGeneration = (
  accountScope: string,
  ownerGeneration: string,
): void => {
  if (!isAccountScope(accountScope) || !ownerGeneration) return;
  const key = scopeKey(GENERATION_PREFIX, accountScope);
  if (uiState.getItem(key) !== ownerGeneration) uiState.setItem(key, ownerGeneration);
};

export const readOwnerGeneration = (accountScope: string): string | null =>
  isAccountScope(accountScope)
    ? uiState.getItem(scopeKey(GENERATION_PREFIX, accountScope))
    : null;

export type WaitingMessage = { id: string; text: string; createdAtMs: number };

const EMPTY: readonly WaitingMessage[] = Object.freeze([]);
const snapshots = new Map<string, readonly WaitingMessage[]>();
const listeners = new Set<() => void>();
const OUTBOX_EVENT = "stella:paused-outbox-changed";

const parseWaiting = (raw: string | null): readonly WaitingMessage[] => {
  if (!raw) return EMPTY;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return EMPTY;
    const messages = parsed.filter(
      (entry): entry is WaitingMessage =>
        Boolean(entry) &&
        typeof entry.id === "string" &&
        typeof entry.text === "string" &&
        typeof entry.createdAtMs === "number",
    );
    return messages.length ? Object.freeze(messages) : EMPTY;
  } catch {
    return EMPTY;
  }
};

const emit = () => {
  snapshots.clear();
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  const stopExternal = uiState.onExternalChange(emit);
  return () => {
    listeners.delete(listener);
    stopExternal();
  };
};

export const waitingMessages = (
  accountScope: string | null,
): readonly WaitingMessage[] => {
  if (!isAccountScope(accountScope)) return EMPTY;
  const cached = snapshots.get(accountScope);
  if (cached) return cached;
  const next = parseWaiting(uiState.getItem(scopeKey(OUTBOX_PREFIX, accountScope)));
  snapshots.set(accountScope, next);
  return next;
};

const writeWaiting = (accountScope: string, messages: readonly WaitingMessage[]) => {
  const key = scopeKey(OUTBOX_PREFIX, accountScope);
  if (messages.length) uiState.setItem(key, JSON.stringify(messages));
  else uiState.removeItem(key);
  emit();
  window.dispatchEvent(new Event(OUTBOX_EVENT));
};

export const addWaitingMessage = (accountScope: string, text: string): boolean => {
  const trimmed = text.trim().slice(0, MAX_TEXT);
  if (!isAccountScope(accountScope) || !trimmed) return false;
  const current = waitingMessages(accountScope);
  if (current.length >= MAX_WAITING) return false;
  writeWaiting(accountScope, [
    ...current,
    { id: crypto.randomUUID(), text: trimmed, createdAtMs: Date.now() },
  ]);
  return true;
};

export const removeWaitingMessage = (accountScope: string, id: string): void => {
  const current = waitingMessages(accountScope);
  const next = current.filter((message) => message.id !== id);
  if (next.length !== current.length) writeWaiting(accountScope, next);
};

export const useWaitingMessages = (accountScope: string | null) =>
  useSyncExternalStore(
    subscribe,
    () => waitingMessages(accountScope),
    () => EMPTY,
  );

/** The account whose chat this computer last showed; read before another account's chat loads. */
export const lastAccountScope = (): string | null => {
  const value = uiState.getItem(LAST_ACCOUNT_SCOPE_KEY);
  return isAccountScope(value) ? value : null;
};

export const rememberAccountScope = (accountScope: string): void => {
  if (isAccountScope(accountScope) && lastAccountScope() !== accountScope) {
    uiState.setItem(LAST_ACCOUNT_SCOPE_KEY, accountScope);
  }
};

const removeScopedKeys = (keep: string | null) => {
  const keepSuffixes = keep ? new Set([encodeURIComponent(keep)]) : new Set<string>();
  for (const key of uiState.keys()) {
    for (const prefix of [GENERATION_PREFIX, OUTBOX_PREFIX, ACTIVE_CONVERSATION_PREFIX]) {
      if (!key.startsWith(prefix)) continue;
      const suffix = key.slice(prefix.length);
      if (!keepSuffixes.has(suffix) && decodeURIComponent(suffix).startsWith("account:")) {
        uiState.removeItem(key);
      }
    }
  }
};

/**
 * Removes every account's chat copy and waiting messages from this computer,
 * except `keep`. With no `keep`, also forgets which account was here.
 */
export const wipeAccountsFromThisComputer = async (
  keep: string | null,
): Promise<void> => {
  removeScopedKeys(keep);
  if (!keep || lastAccountScope() !== keep) uiState.removeItem(LAST_ACCOUNT_SCOPE_KEY);
  if (keep) rememberAccountScope(keep);
  emit();
  pendingPrompts.retainAccountScope(keep ?? SIGNED_OUT_SCOPE);
  await cloudConversationCacheClient.retainAccount(keep ?? SIGNED_OUT_SCOPE);
  if (!keep) await window.electronAPI?.system.forgetAccountHint?.();
};
