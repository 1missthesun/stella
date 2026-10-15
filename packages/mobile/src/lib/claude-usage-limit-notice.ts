import { useEffect, useMemo, useRef } from "react";
import * as Crypto from "expo-crypto";
import type { JournalRecord } from "@stella/contracts/conversation-protocol";
import {
  foldUsageLimitPauses,
  summarizeUsageLimitPauses,
  usageLimitNotice,
  USAGE_LIMIT_PAUSE_STALE_MS,
  type ClaudeUsageLimitCard,
  type UsageLimitSummary,
} from "@stella/contracts/claude-usage-limit";
import { dismissComposerNotice, showComposerNotice } from "./composer-notice";
import { getBackendClient } from "./backend";
import type { JournalView } from "./journal-index";

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

const showPaused = (conversationId: string, id: string, summary: UsageLimitSummary) => {
  const notice = usageLimitNotice(summary, resetTime);
  const press = () => {
    showComposerNotice({ id, conversationId, kind: "limit", title: "Resuming…" });
    void getBackendClient()
      .call("usageLimits.resume", { conversationId, requestId: Crypto.randomUUID() })
      .catch((error: unknown) => {
        showComposerNotice({
          id,
          conversationId,
          kind: "limit",
          title: notice.title,
          description: `Resume didn't go through: ${error instanceof Error ? error.message : String(error)}`,
          action: { label: "Resume", onPress: press },
        });
      });
  };
  showComposerNotice({
    id,
    conversationId,
    kind: "limit",
    title: notice.title,
    ...(notice.description ? { description: notice.description } : {}),
    action: { label: "Resume", onPress: press },
  });
};

/**
 * The chat's usage-limit card: what a Claude usage limit paused (the reply
 * and tasks, wherever they run), with Resume; "Resumed" once it continued.
 */
export function useClaudeUsageLimitNotice(
  conversationId: string | null | undefined,
  records: readonly JournalRecord[],
): void {
  const shown = useRef<string | null>(null);
  const state = useMemo(() => {
    const cards: Array<{ card: ClaudeUsageLimitCard; createdAtMs: number }> = [];
    for (const record of records) {
      if (record.kind === "card" && record.card.type === "usage-limit") {
        cards.push({ card: record.card, createdAtMs: record.createdAtMs });
      }
    }
    if (cards.length === 0) return undefined;
    const pauses = foldUsageLimitPauses(cards);
    return { summary: summarizeUsageLimitPauses(pauses), resumed: pauses.resumed, latestAt: cards.at(-1)!.createdAtMs };
  }, [records]);
  useEffect(() => {
    if (!conversationId || !state) return;
    const key = state.summary ? JSON.stringify(state.summary) : state.resumed ? `resumed:${state.latestAt}` : "none";
    if (shown.current === key) return;
    shown.current = key;
    const id = `claude-usage-limit:${conversationId}`;
    if (state.summary) {
      showPaused(conversationId, id, state.summary);
      return;
    }
    dismissComposerNotice(id);
    if (!state.resumed || Date.now() - state.latestAt > USAGE_LIMIT_PAUSE_STALE_MS) return;
    showComposerNotice({ id, conversationId, kind: "limit", title: usageLimitNotice("resumed", resetTime).title });
    const timer = setTimeout(() => dismissComposerNotice(id), RESUMED_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [conversationId, state]);
}
