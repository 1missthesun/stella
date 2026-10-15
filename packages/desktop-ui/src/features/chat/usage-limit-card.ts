import {
  usageLimitNotice,
  type UsageLimitSummary,
} from "@stella/contracts/claude-usage-limit";
import { presentComposerNotice, showComposerNotice, dismissComposerNotice } from "./composer-notice-store";

/** One usage-limit card per chat, the same on desktop and web. */
export const usageLimitCardId = (conversationId: string) => `claude-usage-limit:${conversationId}`;

const resetTime = (until: number) => {
  const at = new Date(until);
  const time = at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (at.toDateString() === new Date().toDateString()) return time;
  const far = until - Date.now() > 6 * 24 * 60 * 60 * 1000;
  return `${at.toLocaleDateString(undefined, { weekday: "short", ...(far ? { month: "short", day: "numeric" } : {}) })} ${time}`;
};

/**
 * Shows what a usage limit paused in a chat, with Resume. `resume` continues
 * it all; the card shows "Resumed" once it did (from `presentUsageLimitResumed`).
 */
export const presentUsageLimitPaused = (
  conversationId: string,
  summary: UsageLimitSummary,
  resume: () => Promise<unknown>,
) => {
  const id = usageLimitCardId(conversationId);
  const notice = usageLimitNotice(summary, resetTime);
  const press = () => {
    showComposerNotice({ id, conversationId, kind: "limit", title: "Resuming…" });
    void resume().catch((error: unknown) => {
      showComposerNotice({
        id,
        conversationId,
        kind: "limit",
        title: notice.title,
        description: `Resume didn't go through: ${error instanceof Error ? error.message : String(error)}`,
        action: { label: "Resume", onClick: press },
      });
    });
  };
  presentComposerNotice(
    {
      id,
      conversationId,
      kind: "limit",
      title: notice.title,
      ...(notice.description ? { description: notice.description } : {}),
      action: { label: "Resume", onClick: press },
    },
    {
      title: notice.title,
      ...(notice.description ? { description: notice.description } : {}),
      variant: "default",
      duration: 10000,
      action: { label: "Resume", onClick: press },
    },
  );
};

export const presentUsageLimitResumed = (conversationId: string) => {
  const notice = usageLimitNotice("resumed", resetTime);
  showComposerNotice({ id: usageLimitCardId(conversationId), conversationId, kind: "limit", title: notice.title });
};

export const dismissUsageLimitCard = (conversationId: string) => dismissComposerNotice(usageLimitCardId(conversationId));
