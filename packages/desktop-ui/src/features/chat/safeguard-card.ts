import { useSyncExternalStore } from "react";
import type { SafeguardAction, SafeguardNotice } from "@stella/contracts/safeguard-block";

export type SafeguardCardState = {
  notice: SafeguardNotice;
  pending?: SafeguardAction;
  problem?: string;
  choose(action: SafeguardAction): void;
};

let cards = new Map<string, SafeguardCardState>();
const listeners = new Set<() => void>();

const set = (conversationId: string, state: SafeguardCardState | null) => {
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

export const useSafeguardCard = (conversationId: string | null | undefined): SafeguardCardState | null => {
  const snapshot = useSyncExternalStore(subscribe, () => cards, () => cards);
  return conversationId ? (snapshot.get(conversationId) ?? null) : null;
};

export const presentSafeguardBlock = (
  conversationId: string,
  notice: SafeguardNotice | null,
  resolve: (action: SafeguardAction) => Promise<unknown>,
) => {
  if (!notice) {
    set(conversationId, null);
    return;
  }
  const choose = (action: SafeguardAction) => {
    if (cards.get(conversationId)?.pending) return;
    set(conversationId, { notice, pending: action, choose });
    void resolve(action).catch((error: unknown) => {
      if (cards.get(conversationId)?.notice !== notice) return;
      set(conversationId, {
        notice,
        problem: `That didn't go through: ${error instanceof Error ? error.message : String(error)}`,
        choose,
      });
    });
  };
  set(conversationId, { notice, choose });
};
