import { stellaUsageLimitOf } from "@stella/contracts/stella-usage-limit";
import type { JournalRecord } from "@stella/contracts/conversation-protocol";
import { presentStellaProviderError } from "@/features/chat/streaming/stella-provider-error-toast";
import {
  foldUsageLimitPauses,
  summarizeUsageLimitPauses,
  USAGE_LIMIT_PAUSE_STALE_MS,
  type ClaudeUsageLimitCard,
} from "@stella/contracts/claude-usage-limit";
import { backendClient } from "@/platform/backend/backend-client";
import {
  dismissUsageLimitCard,
  presentUsageLimitPaused,
  presentUsageLimitResumed,
} from "@/features/chat/usage-limit-card";

export const presentCloudUsageLimit = (
  text: string | null | undefined,
  conversationId: string | null,
): boolean => {
  if (!stellaUsageLimitOf(text)) return false;
  presentStellaProviderError(text ?? null, { conversationId });
  return true;
};

const presented = new Set<string>();
const RECENT_MS = 6 * 60 * 60 * 1000;

export const presentLatestTurnUsageLimit = (
  conversationId: string,
  records: readonly JournalRecord[],
): void => {
  let latest: JournalRecord | undefined;
  for (const record of records) {
    if (record.kind === "turn") latest = record;
  }
  if (!latest || latest.kind !== "turn" || latest.phase !== "failed") return;
  if (latest.createdAtMs < Date.now() - RECENT_MS) return;
  const key = `${conversationId}:${latest.seq}`;
  if (presented.has(key)) return;
  if (presentCloudUsageLimit(latest.notice, conversationId)) presented.add(key);
};

const shownPauses = new Map<string, string>();

/**
 * The web chat's usage-limit card: what a limit paused in this chat (from
 * its journal cards), with Resume. The desktop shows the same card from its
 * own chat host, which also sees this computer's held work.
 */
export const presentUsageLimitPauses = (
  conversationId: string,
  records: readonly JournalRecord[],
): void => {
  const cards: Array<{ card: ClaudeUsageLimitCard; createdAtMs: number }> = [];
  for (const record of records) {
    if (record.kind === "card" && record.card.type === "usage-limit") {
      cards.push({ card: record.card, createdAtMs: record.createdAtMs });
    }
  }
  if (cards.length === 0) return;
  const pauses = foldUsageLimitPauses(cards);
  const summary = summarizeUsageLimitPauses(pauses);
  const latest = cards.at(-1)!;
  const key = summary ? JSON.stringify(summary) : pauses.resumed ? `resumed:${latest.createdAtMs}` : "none";
  if (shownPauses.get(conversationId) === key) return;
  shownPauses.set(conversationId, key);
  if (summary) {
    presentUsageLimitPaused(conversationId, summary, () =>
      backendClient.call("usageLimits.resume", { conversationId, requestId: crypto.randomUUID() }),
    );
    return;
  }
  if (pauses.resumed && Date.now() - latest.createdAtMs < USAGE_LIMIT_PAUSE_STALE_MS) {
    presentUsageLimitResumed(conversationId);
    return;
  }
  dismissUsageLimitCard(conversationId);
};
