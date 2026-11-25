import { serverNow } from "@stella/contracts/server-clock";
import type { CloudBrowserInteractionSummary } from "./cloud-browser";

export function selectCurrentConversationBrowserInteraction(
  interactions: readonly CloudBrowserInteractionSummary[],
  conversationId: string | null | undefined,
  now = serverNow(),
): CloudBrowserInteractionSummary | null {
  if (!conversationId) return null;

  return (
    interactions
      .filter(
        (entry) =>
          entry.conversationId === conversationId && entry.expiresAt > now,
      )
      .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null
  );
}
