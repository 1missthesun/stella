import { useEffect, useMemo, useSyncExternalStore } from "react";
import * as Crypto from "expo-crypto";
import type { JournalRecord } from "@stella/contracts/conversation-protocol";
import {
  applySafeguardEvent,
  emptySafeguardFold,
  parseSafeguardCard,
  safeguardEventOfRecord,
  safeguardNotice,
  type SafeguardAction,
  type SafeguardNotice,
} from "@stella/contracts/safeguard-block";
import { getBackendClient } from "./backend";
import type { JournalView } from "./journal-index";

/** Turn outcomes and choices on a block, the only records the card reads. */
export const SAFEGUARD_RECORDS: JournalView = {
  id: "safeguard-records",
  test: (record) =>
    record.kind === "turn"
      ? record.phase === "completed" || record.phase === "failed"
      : record.kind === "card" && parseSafeguardCard(record.card) !== null,
};

/** What the chat's safety-block card shows; it sits in the message list where the stopped reply would be. */
export type SafeguardCardState = {
  notice: SafeguardNotice;
  pending?: SafeguardAction;
  problem?: string;
  choose(action: SafeguardAction): void;
};

let cards = new Map<string, SafeguardCardState>();
const listeners = new Set<() => void>();

const setCard = (conversationId: string, state: SafeguardCardState | null) => {
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

const show = (conversationId: string, notice: SafeguardNotice) => {
  const choose = (action: SafeguardAction) => {
    if (cards.get(conversationId)?.pending) return;
    setCard(conversationId, { notice, pending: action, choose });
    void getBackendClient()
      .call("safeguards.resolve", { conversationId, action, requestId: Crypto.randomUUID() })
      .catch((error: unknown) => {
        if (cards.get(conversationId)?.notice !== notice) return;
        setCard(conversationId, {
          notice,
          problem: `That didn't go through: ${error instanceof Error ? error.message : String(error)}`,
          choose,
        });
      });
  };
  setCard(conversationId, { notice, choose });
};

/**
 * The chat's safety-block card: a reply the model's safety system stopped,
 * wherever it ran, with the ways to carry on. It goes once the journal
 * records a choice or a reply.
 */
export function useSafeguardNotice(
  conversationId: string | null | undefined,
  records: readonly JournalRecord[],
): void {
  const key = useMemo(() => {
    let fold = emptySafeguardFold();
    for (const record of records) {
      const event = safeguardEventOfRecord(record);
      if (event) fold = applySafeguardEvent(fold, event);
    }
    return JSON.stringify(safeguardNotice(fold));
  }, [records]);
  useEffect(() => {
    if (!conversationId) return;
    const notice = JSON.parse(key) as SafeguardNotice | null;
    if (notice) show(conversationId, notice);
    else setCard(conversationId, null);
  }, [conversationId, key]);
}
