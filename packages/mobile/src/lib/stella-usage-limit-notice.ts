import { useEffect, useMemo, useRef } from "react";
import type { JournalRecord } from "@stella/contracts/conversation-protocol";
import { stellaUsageLimitOf } from "@stella/contracts/stella-usage-limit";
import { showComposerNoticeForError } from "./composer-notice";

const RECENT_MS = 6 * 60 * 60 * 1000;

export function useStellaUsageLimitNotice(
  conversationId: string | null | undefined,
  records: readonly JournalRecord[],
): void {
  const shown = useRef<number | null>(null);
  const latest = useMemo(() => {
    for (let index = records.length - 1; index >= 0; index -= 1) {
      const record = records[index]!;
      if (record.kind === "turn") return record;
    }
    return undefined;
  }, [records]);
  useEffect(() => {
    if (!conversationId || !latest || latest.kind !== "turn") return;
    if (latest.phase !== "failed" || shown.current === latest.seq) return;
    if (Date.now() - latest.createdAtMs > RECENT_MS) return;
    if (!stellaUsageLimitOf(latest.notice)) return;
    shown.current = latest.seq;
    showComposerNoticeForError(latest.notice ?? "", conversationId);
  }, [conversationId, latest]);
}
