import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useChatStore } from "@/context/chat-store-context";
import {
  subscribeToLocalActivityWindow,
  type LocalActivityWindowSnapshot,
} from "@/features/chat/services/local-activity-store";
import { notify, withdrawNotification } from "@/features/notifications/notification-store";
import { translateNow } from "@/shared/i18n/active-translator";
import type { EventRecord } from "@stella/contracts/local-chat";
import { localCacheRetryDelayMs } from "./local-cache-retry";

export const ACTIVITY_PAGE_SIZE = 500;

const EMPTY_ACTIVITIES: EventRecord[] = [];

const EMPTY_SNAPSHOT: LocalActivityWindowSnapshot = {
  window: { activities: EMPTY_ACTIVITIES },
  hasLoaded: false,
  error: null,
};

export type ConversationActivityFeed = {
  activities: EventRecord[];
  hasOlderActivity: boolean;
  isLoadingOlder: boolean;
  isInitialLoading: boolean;
  loadOlder: () => void;
};

export const useConversationActivity = (
  conversationId?: string,
): ConversationActivityFeed => {
  const { isLocalStorage } = useChatStore();
  const hasLocalCache = isLocalStorage;

  const visitKey = `${hasLocalCache ? "local-cache" : "no-cache"}:${conversationId ?? ""}`;
  const visitToken = useMemo(() => Symbol(visitKey), [visitKey]);

  const [limit, setLimit] = useState(ACTIVITY_PAGE_SIZE);
  const [pendingLimit, setPendingLimit] = useState<number | null>(null);

  useEffect(() => {
    setLimit(ACTIVITY_PAGE_SIZE);
    setPendingLimit(null);
  }, [visitToken]);

  const [snapshotState, setSnapshotState] = useState<{
    visitToken: symbol;
    snapshot: LocalActivityWindowSnapshot;
  }>({
    visitToken,
    snapshot: EMPTY_SNAPSHOT,
  });
  const [localRetryTick, setLocalRetryTick] = useState(0);
  const localRetryAttemptRef = useRef(0);

  useEffect(() => {
    localRetryAttemptRef.current = 0;
  }, [limit, visitToken]);

  useEffect(() => {
    if (!hasLocalCache || !conversationId) {
      setSnapshotState({
        visitToken,
        snapshot: {
          window: {
            activities: EMPTY_ACTIVITIES,
          },
          hasLoaded: true,
          error: null,
        },
      });
      return;
    }

    let cancelled = false;
    let retryTimer: number | null = null;
    const scheduleRetry = (): boolean => {
      if (cancelled) return false;
      if (retryTimer !== null) return true;
      const retryDelayMs = localCacheRetryDelayMs(localRetryAttemptRef.current);
      if (retryDelayMs === null) return false;
      localRetryAttemptRef.current += 1;
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        if (!cancelled) {
          setLocalRetryTick((current) => current + 1);
        }
      }, retryDelayMs);
      return true;
    };
    const unsubscribe = subscribeToLocalActivityWindow(
      { conversationId, limit },
      (snapshot) => {
        if (cancelled) return;
        if (retryTimer !== null) {
          window.clearTimeout(retryTimer);
          retryTimer = null;
        }
        setSnapshotState({ visitToken, snapshot });
        const noticeId = `load-failed:chatActivity:${conversationId}`;
        if (!snapshot.error) {
          if (snapshot.hasLoaded) {
            localRetryAttemptRef.current = 0;
            withdrawNotification(noticeId);
          }
          return;
        }
        const willRetry = scheduleRetry();
        notify({
          id: noticeId,
          kind: "problem",
          title: translateNow("shell.notifications.loadFailed.chatActivity"),
          detail: translateNow(
            willRetry
              ? "shell.notifications.loadFailed.retrying"
              : "shell.notifications.loadFailed.stopped",
          ),
        });
      },
    );
    return () => {
      cancelled = true;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
      }
      unsubscribe();
    };
  }, [conversationId, hasLocalCache, limit, localRetryTick, visitToken]);

  const activeSnapshot =
    snapshotState.visitToken === visitToken
      ? snapshotState.snapshot
      : EMPTY_SNAPSHOT;

  const activities = activeSnapshot.window.activities;

  const hasOlderActivity =
    activeSnapshot.hasLoaded && activities.length >= limit;

  const isLoadingOlder =
    pendingLimit !== null && activities.length < pendingLimit;

  useEffect(() => {
    if (pendingLimit === null) return;
    if (activities.length >= pendingLimit) {
      setPendingLimit(null);
      return;
    }
    if (activeSnapshot.hasLoaded && !hasOlderActivity) {
      setPendingLimit(null);
    }
  }, [
    activeSnapshot.hasLoaded,
    activities.length,
    hasOlderActivity,
    pendingLimit,
  ]);

  const loadOlder = useCallback(() => {
    if (!conversationId || !hasLocalCache) return;
    if (!hasOlderActivity) return;
    if (pendingLimit !== null) return;
    const next = limit + ACTIVITY_PAGE_SIZE;
    setPendingLimit(next);
    startTransition(() => {
      setLimit(next);
    });
  }, [conversationId, hasLocalCache, hasOlderActivity, limit, pendingLimit]);

  const isInitialLoading =
    Boolean(conversationId) &&
    hasLocalCache &&
    !activeSnapshot.hasLoaded &&
    activities.length === 0;

  return {
    activities,
    hasOlderActivity,
    isLoadingOlder,
    isInitialLoading,
    loadOlder,
  };
};
