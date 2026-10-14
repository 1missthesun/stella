import { stellaUsageLimitOf } from "@stella/contracts/stella-usage-limit";
import type { JournalRecord } from "@stella/contracts/conversation-protocol";
import { presentStellaProviderError } from "@/features/chat/streaming/stella-provider-error-toast";

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
