import { useSyncExternalStore } from "react";
import {
  usageLimitNotice,
  type UsageLimitSummary,
} from "@stella/contracts/claude-usage-limit";
import { showToast } from "@/ui/toast";

/** One usage-limit card per chat, the same on desktop and web. */
export const usageLimitCardId = (conversationId: string) => `claude-usage-limit:${conversationId}`;

/** What the chat's usage-limit card shows; it sits in the message list where the paused reply would be. */
export type UsageLimitCardState = {
  title: string;
  description?: string;
  resume?: () => void;
};

let cards = new Map<string, UsageLimitCardState>();
const listeners = new Set<() => void>();
let mountedSurfaces = 0;

const set = (conversationId: string, state: UsageLimitCardState | null) => {
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

export const useUsageLimitCard = (conversationId: string | null | undefined): UsageLimitCardState | null => {
  const snapshot = useSyncExternalStore(subscribe, () => cards, () => cards);
  return conversationId ? (snapshot.get(conversationId) ?? null) : null;
};

/** A chat timeline that shows the card; without one the pause falls back to a toast. */
export const registerUsageLimitCardSurface = (): (() => void) => {
  mountedSurfaces += 1;
  return () => {
    mountedSurfaces = Math.max(0, mountedSurfaces - 1);
  };
};

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
  const notice = usageLimitNotice(summary, resetTime);
  const press = () => {
    set(conversationId, { title: "Resuming…" });
    void resume().catch((error: unknown) => {
      set(conversationId, {
        title: notice.title,
        description: `Resume didn't go through: ${error instanceof Error ? error.message : String(error)}`,
        resume: press,
      });
    });
  };
  set(conversationId, {
    title: notice.title,
    ...(notice.description ? { description: notice.description } : {}),
    resume: press,
  });
  if (mountedSurfaces === 0) {
    showToast({
      title: notice.title,
      ...(notice.description ? { description: notice.description } : {}),
      variant: "default",
      duration: 10000,
      action: { label: "Resume", onClick: press },
    });
  }
};

export const presentUsageLimitResumed = (conversationId: string) => {
  set(conversationId, { title: usageLimitNotice("resumed", resetTime).title });
};

export const dismissUsageLimitCard = (conversationId: string) => set(conversationId, null);
