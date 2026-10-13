import { stellaUsageLimitOf } from "@stella/contracts/stella-usage-limit";
import type { JournalRecord } from "@stella/contracts/conversation-protocol";
import { presentStellaProviderError } from "@/features/chat/streaming/stella-provider-error-toast";

/**
 * Stella's usage limit (free allowance spent, plan limit reached) as the
 * cloud reports it: a refused send's message or a turn's terminal notice.
 * Pins the upgrade notice above the composer so the user has somewhere to
 * go; the inline reply row alone only says what happened.
 */
export const presentCloudUsageLimit = (
  text: string | null | undefined,
  conversationId: string | null,
): boolean => {
  if (!stellaUsageLimitOf(text)) return false;
  presentStellaProviderError(text ?? null, { conversationId });
  return true;
};

const presented = new Set<string>();
/** An old failure in history is not news; only a recent one gets the card. */
const RECENT_MS = 6 * 60 * 60 * 1000;

/**
 * The conversation's latest turn ended on the usage limit: present it once
 * per terminal record, so a dismissed notice stays dismissed and an older
 * turn's limit never reappears after an upgrade.
 */
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
