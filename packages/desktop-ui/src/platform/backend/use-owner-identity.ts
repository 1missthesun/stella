import { useEffect, useState } from "react";
import type { ConversationCalls } from "@stella/contracts/backend/conversations";
import type { BackendRequestError } from "@stella/contracts/backend/client";
import { backendClient } from "./backend-client";
import { recallHandoff, rememberForHandoff } from "./window-handoff";

const RETRY_DELAYS_MS = [500, 1_000, 2_000, 5_000, 10_000];

export type OwnerBootstrap =
  ConversationCalls["conversations.bootstrap"]["result"];

const inflight = new Map<string, Promise<OwnerBootstrap>>();
const refreshListeners = new Set<(accountKey: string) => void>();

/** The last answer per key starts the next window (`window-handoff.ts`). */
const SAVED_PREFIX = "owner-identity:";
const readSaved = (accountKey: string): OwnerBootstrap | undefined =>
  recallHandoff<OwnerBootstrap>(`${SAVED_PREFIX}${accountKey}`);
const save = (accountKey: string, identity: OwnerBootstrap) =>
  rememberForHandoff(`${SAVED_PREFIX}${accountKey}`, identity);

/**
 * The backend's answer to "who am I": the owner id it verified from the
 * current token, the owner generation that fences stale work, and the
 * account's main conversation (the one chat every client opens). Asked once
 * per `accountKey` (change the key when the account or session changes).
 * The answer is also the identity proof: a result whose `ownerId` is not the
 * expected one means the token still belongs to another account.
 * `preferConversationId` is only a hint for the server's first pin.
 */
export function useOwnerIdentity(
  accountKey: string | null,
  preferConversationId: string | null,
): {
  identity: OwnerBootstrap | undefined;
  error: BackendRequestError | undefined;
} {
  const [state, setState] = useState<{
    key: string | null;
    identity?: OwnerBootstrap;
    error?: BackendRequestError;
  }>({ key: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!accountKey) return;
    const listener = (key: string) => {
      if (key === accountKey) setAttempt((value) => value + 1);
    };
    refreshListeners.add(listener);
    return () => {
      refreshListeners.delete(listener);
    };
  }, [accountKey]);

  useEffect(() => {
    if (!accountKey) return;
    let canceled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let request = inflight.get(accountKey);
    if (!request) {
      request = backendClient.call(
        "conversations.bootstrap",
        preferConversationId ? { preferConversationId } : {},
      );
      inflight.set(accountKey, request);
    }
    request
      .then((identity) => {
        save(accountKey, identity);
        if (!canceled) setState({ key: accountKey, identity });
      })
      .catch((error: BackendRequestError) => {
        inflight.delete(accountKey);
        if (canceled) return;
        setState((current) => {
          const known =
            current.key === accountKey ? current.identity : readSaved(accountKey);
          return known
            ? { key: accountKey, identity: known }
            : { key: accountKey, error };
        });
        if (error.retryable !== false) {
          const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]!;
          retryTimer = setTimeout(() => setAttempt((value) => value + 1), delay);
        }
      });
    return () => {
      canceled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
    // The hint only matters to the first request for a key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountKey, attempt]);

  const current =
    state.key === accountKey
      ? state
      : { key: accountKey, identity: accountKey ? readSaved(accountKey) : undefined };
  return { identity: current.identity, error: current.error };
}

/**
 * Ask again, e.g. when the main conversation was deleted: the server re-pins
 * a live one. Every mounted reader for the key picks up the new answer.
 */
export const refreshOwnerIdentity = (accountKey: string): void => {
  inflight.delete(accountKey);
  for (const listener of refreshListeners) listener(accountKey);
};
