import { useEffect, useMemo, useRef, useState } from "react";
import {
  getRetainedThreadActivitySnapshot,
  subscribeToThreadActivity,
  type ThreadActivitySnapshot,
} from "@/features/chat/services/thread-activity-store";
import type { DesktopThreadActivityRecord } from "@/features/chat/thread-activity-types";
import { showToast } from "@/ui/toast";

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
  const lastErrorToastAtRef = useRef(0);
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
        if (!snapshot.error) return;
        const now = Date.now();
        if (now - lastErrorToastAtRef.current > 10_000) {
          lastErrorToastAtRef.current = now;
          showToast({
            title: "Couldn’t load activity",
            description:
              snapshot.error.message || "Stella will retry in a moment.",
            variant: "error",
          });
        }
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
