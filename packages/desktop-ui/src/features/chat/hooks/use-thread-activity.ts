import { useEffect, useMemo, useState } from "react";
import {
  getRetainedThreadActivitySnapshot,
  subscribeToThreadActivity,
  type ThreadActivitySnapshot,
} from "@/features/chat/services/thread-activity-store";
import type { DesktopThreadActivityRecord } from "@/features/chat/thread-activity-types";
import { notify, withdrawNotification } from "@/features/notifications/notification-store";
import { translateNow } from "@/shared/i18n/active-translator";

const EMPTY_RECORDS: DesktopThreadActivityRecord[] = [];
const EMPTY_SNAPSHOT: ThreadActivitySnapshot = {
  records: EMPTY_RECORDS,
  hasLoaded: false,
  error: null,
};
export const useThreadActivity = (
  conversationId?: string | null,
): {
  records: DesktopThreadActivityRecord[];
  isInitialLoading: boolean;
} => {
  const visitToken = useMemo(
    () => Symbol(conversationId ?? ""),
    [conversationId],
  );
  const retainedSnapshot = useMemo(
    () =>
      conversationId
        ? (getRetainedThreadActivitySnapshot(conversationId) ?? EMPTY_SNAPSHOT)
        : EMPTY_SNAPSHOT,
    [conversationId],
  );
  const [snapshotState, setSnapshotState] = useState<{
    visitToken: symbol;
    snapshot: ThreadActivitySnapshot;
  }>({ visitToken, snapshot: EMPTY_SNAPSHOT });
  useEffect(() => {
    if (!conversationId) {
      setSnapshotState({
        visitToken,
        snapshot: { records: EMPTY_RECORDS, hasLoaded: true, error: null },
      });
      return;
    }
    let cancelled = false;
    const unsubscribe = subscribeToThreadActivity(
      conversationId,
      (snapshot) => {
        if (cancelled) return;
        setSnapshotState({ visitToken, snapshot });
        const noticeId = `load-failed:activity:${conversationId}`;
        if (!snapshot.error) {
          withdrawNotification(noticeId);
          return;
        }
        notify({
          id: noticeId,
          kind: "problem",
          title: translateNow("shell.notifications.loadFailed.activity"),
          detail: translateNow("shell.notifications.loadFailed.retrying"),
        });
      },
    );
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [conversationId, visitToken]);
  const activeSnapshot =
    snapshotState.visitToken === visitToken
      ? snapshotState.snapshot
      : retainedSnapshot;
  return {
    records: activeSnapshot.records,
    isInitialLoading:
      Boolean(conversationId) &&
      !activeSnapshot.hasLoaded &&
      activeSnapshot.records.length === 0,
  };
};
