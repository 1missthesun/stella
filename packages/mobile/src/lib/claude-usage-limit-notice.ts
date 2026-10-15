import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
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

/** What the chat's usage-limit card shows; it sits in the message list where the paused reply would be. */
export type UsageLimitCardState = {
  title: string;
  description?: string;
  resume?: () => void;
};

let cards = new Map<string, UsageLimitCardState>();
const listeners = new Set<() => void>();

const setCard = (conversationId: string, state: UsageLimitCardState | null) => {
  const next = new Map(cards);
  if (state) next.set(conversationId, state);
  else if (!next.delete(conversationId)) return;
  cards = next;
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const dismissUsageLimitCard = (conversationId: string) => setCard(conversationId, null);

export const useUsageLimitCard = (conversationId: string | null | undefined): UsageLimitCardState | null => {
  const snapshot = useSyncExternalStore(subscribe, () => cards, () => cards);
  return conversationId ? (snapshot.get(conversationId) ?? null) : null;
};

const showPaused = (conversationId: string, summary: UsageLimitSummary) => {
  const notice = usageLimitNotice(summary, resetTime);
  const press = () => {
    setCard(conversationId, { title: "Resuming…" });
    void getBackendClient()
      .call("usageLimits.resume", { conversationId, requestId: Crypto.randomUUID() })
      .catch((error: unknown) => {
        setCard(conversationId, {
          title: notice.title,
          description: `Resume didn't go through: ${error instanceof Error ? error.message : String(error)}`,
          resume: press,
        });
      });
  };
  setCard(conversationId, {
    title: notice.title,
    ...(notice.description ? { description: notice.description } : {}),
    resume: press,
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
    if (state.summary) {
      showPaused(conversationId, state.summary);
      return;
    }
    dismissUsageLimitCard(conversationId);
    if (!state.resumed || Date.now() - state.latestAt > USAGE_LIMIT_PAUSE_STALE_MS) return;
    setCard(conversationId, { title: usageLimitNotice("resumed", resetTime).title });
    const timer = setTimeout(() => dismissUsageLimitCard(conversationId), RESUMED_VISIBLE_MS);
    return () => clearTimeout(timer);
  }, [conversationId, state]);
}
