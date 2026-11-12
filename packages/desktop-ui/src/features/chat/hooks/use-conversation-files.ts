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
  subscribeToLocalFilesWindow,
  type LocalFilesWindowSnapshot,
} from "@/features/chat/services/local-files-store";
import { notify, withdrawNotification } from "@/features/notifications/notification-store";
import { translateNow } from "@/shared/i18n/active-translator";
import type { EventRecord } from "@stella/contracts/local-chat";
import { localCacheRetryDelayMs } from "./local-cache-retry";

export const FILES_PAGE_SIZE = 500;

const EMPTY_FILES: EventRecord[] = [];

const EMPTY_SNAPSHOT: LocalFilesWindowSnapshot = {
  window: { files: EMPTY_FILES },
  hasLoaded: false,
  error: null,
};

export type ConversationFilesFeed = {
  files: EventRecord[];
  hasOlderFiles: boolean;
  isLoadingOlder: boolean;
  isInitialLoading: boolean;
  loadOlder: () => void;
};

export const useConversationFiles = (
  conversationId?: string,
): ConversationFilesFeed => {
  const { isLocalStorage } = useChatStore();
  const hasLocalCache = isLocalStorage;

  const visitKey = `${hasLocalCache ? "local-cache" : "no-cache"}:${conversationId ?? ""}`;
  const visitToken = useMemo(() => Symbol(visitKey), [visitKey]);

  const [limit, setLimit] = useState(FILES_PAGE_SIZE);
  const [pendingLimit, setPendingLimit] = useState<number | null>(null);

  useEffect(() => {
    setLimit(FILES_PAGE_SIZE);
    setPendingLimit(null);
  }, [visitToken]);

  const [snapshotState, setSnapshotState] = useState<{
    visitToken: symbol;
    snapshot: LocalFilesWindowSnapshot;
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
          window: { files: EMPTY_FILES },
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
    const unsubscribe = subscribeToLocalFilesWindow(
      { conversationId, limit },
      (snapshot) => {
        if (cancelled) return;
        if (retryTimer !== null) {
          window.clearTimeout(retryTimer);
          retryTimer = null;
        }
        setSnapshotState({ visitToken, snapshot });
        const noticeId = `load-failed:files:${conversationId}`;
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
          title: translateNow("shell.notifications.loadFailed.files"),
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

  const files = activeSnapshot.window.files;

  const hasOlderFiles = activeSnapshot.hasLoaded && files.length >= limit;

  const isLoadingOlder = pendingLimit !== null && files.length < pendingLimit;

  useEffect(() => {
    if (pendingLimit === null) return;
    if (files.length >= pendingLimit) {
      setPendingLimit(null);
      return;
    }
    if (activeSnapshot.hasLoaded && !hasOlderFiles) {
      setPendingLimit(null);
    }
  }, [activeSnapshot.hasLoaded, files.length, hasOlderFiles, pendingLimit]);

  const loadOlder = useCallback(() => {
    if (!conversationId || !hasLocalCache) return;
    if (!hasOlderFiles) return;
    if (pendingLimit !== null) return;
    const next = limit + FILES_PAGE_SIZE;
    setPendingLimit(next);
    startTransition(() => {
      setLimit(next);
    });
  }, [conversationId, hasLocalCache, hasOlderFiles, limit, pendingLimit]);

  const isInitialLoading =
    Boolean(conversationId) &&
    hasLocalCache &&
    !activeSnapshot.hasLoaded &&
    files.length === 0;

  return {
    files,
    hasOlderFiles,
    isLoadingOlder,
    isInitialLoading,
    loadOlder,
  };
};
