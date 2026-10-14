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

const SAVED_PREFIX = "owner-identity:";
const readSaved = (accountKey: string): OwnerBootstrap | undefined =>
  recallHandoff<OwnerBootstrap>(`${SAVED_PREFIX}${accountKey}`);
const save = (accountKey: string, identity: OwnerBootstrap) =>
  rememberForHandoff(`${SAVED_PREFIX}${accountKey}`, identity);

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
  }, [accountKey, attempt, preferConversationId]);

  const current =
    state.key === accountKey
      ? state
      : { key: accountKey, identity: accountKey ? readSaved(accountKey) : undefined };
  return { identity: current.identity, error: current.error };
}

export const refreshOwnerIdentity = (accountKey: string): void => {
  inflight.delete(accountKey);
  for (const listener of refreshListeners) listener(accountKey);
};
