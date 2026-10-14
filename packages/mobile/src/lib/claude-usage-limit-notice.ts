import { useEffect, useMemo, useRef } from "react";
import type { JournalRecord } from "@stella/contracts/conversation-protocol";
import { CLAUDE_USAGE_LIMIT_RESUMED_TEXT } from "@stella/contracts/claude-usage-limit";
import { dismissComposerNotice, showComposerNotice } from "./composer-notice";
import type { JournalView } from "./journal-index";

const STALE_MS = 15 * 60_000;
const RESUMED_VISIBLE_MS = 8_000;

const resetTime = (until: number): string => {
  const at = new Date(until);
  const time = at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (at.toDateString() === new Date().toDateString()) return time;
  const far = until - Date.now() > 6 * 24 * 60 * 60 * 1000;
  return `${at.toLocaleDateString(undefined, { weekday: "short", ...(far ? { month: "short", day: "numeric" } : {}) })} ${time}`;
};

/** Usage-limit cards, the only records the notice reads. */
export const USAGE_LIMIT_CARDS: JournalView = {
  id: "usage-limit-cards",
  test: (record) => record.kind === "card" && record.card.type === "usage-limit",
};

export function useClaudeUsageLimitNotice(
  conversationId: string | null | undefined,
  records: readonly JournalRecord[],
): void {
  const shown = useRef<number | null>(null);
  const latest = useMemo(() => {
    for (let index = records.length - 1; index >= 0; index -= 1) {
      const record = records[index]!;
      if (record.kind === "card" && record.card.type === "usage-limit") return record;
    }
    return undefined;
  }, [records]);
  useEffect(() => {
    if (!conversationId || !latest || latest.card.type !== "usage-limit") return;
    if (shown.current === latest.seq) return;
    shown.current = latest.seq;
    const id = `claude-usage-limit:${conversationId}`;
    const card = latest.card;
    const now = Date.now();
    if (card.state === "held") {
      if (card.until !== undefined && card.until < now - STALE_MS) return;
      showComposerNotice({
        id,
        conversationId,
        kind: "limit",
        title: "Claude usage limit reached",
        description:
          card.until !== undefined
            ? `It resets at ${resetTime(card.until)}. Stella is holding the work that hit it and continues it automatically then.`
            : "Stella is holding the work that hit it and continues it automatically once the limit resets.",
      });
      return;
    }
    dismissComposerNotice(id);
    if (now - latest.createdAtMs > STALE_MS) return;
    showComposerNotice({ id, conversationId, kind: "limit", title: CLAUDE_USAGE_LIMIT_RESUMED_TEXT });
    const timer = setTimeout(() => dismissComposerNotice(id), RESUMED_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [conversationId, latest]);
}
