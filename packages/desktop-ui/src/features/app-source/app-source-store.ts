import { useSyncExternalStore } from "react";
import type {
  AppSourceActionResult,
  AppSourceCommit,
  AppSourceDraftOffer,
  AppSourceState,
  AppSourceWaiting,
} from "@stella/contracts/desktop/app-source";
import { isStellaDraft } from "@stella/contracts/desktop/app-source";

let snapshot: AppSourceState | null = null;
let started = false;
const listeners = new Set<() => void>();

const emit = (next: AppSourceState) => {
  snapshot = next;
  for (const listener of listeners) listener();
};

const start = () => {
  const api = window.electronAPI?.appSource;
  if (started || !api) return;
  started = true;
  api.onState(emit);
  void api
    .getState()
    .then((next) => {
      if (next) emit(next);
    })
    .catch(() => {});
};

const subscribe = (listener: () => void) => {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useAppSourceState = () =>
  useSyncExternalStore(subscribe, () => snapshot);

export const appSourceApi = () => window.electronAPI?.appSource ?? null;

let pending: string | null = null;
const pendingListeners = new Set<() => void>();
const setPending = (next: string | null) => {
  pending = next;
  for (const listener of pendingListeners) listener();
};
const subscribePending = (listener: () => void) => {
  pendingListeners.add(listener);
  return () => {
    pendingListeners.delete(listener);
  };
};

export const usePendingAppSourceAction = () =>
  useSyncExternalStore(subscribePending, () => pending);

export const runAppSourceAction = async (
  key: string,
  action: () => Promise<AppSourceActionResult>,
): Promise<AppSourceActionResult> => {
  setPending(key);
  try {
    return await action();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    setPending(null);
  }
};

type MergeOffer = Extract<AppSourceWaiting, { kind: "version" | "other-computer" }>;

export type AgentChange =
  | { kind: "draft"; offer: AppSourceDraftOffer }
  | { kind: "merge"; offer: MergeOffer }
  | { kind: "applied"; commit: AppSourceCommit };

const draftOffers = (state: AppSourceState) =>
  [...state.waiting, ...state.skipped].filter(
    (offer): offer is AppSourceDraftOffer =>
      offer.kind === "draft" && !isStellaDraft(offer.name),
  );

export const agentChange = (
  state: AppSourceState,
  agentId: string,
): AgentChange | null => {
  const offer = draftOffers(state).find((entry) => entry.agentId === agentId);
  if (offer) return { kind: "draft", offer };
  const merge = state.waiting.find(
    (entry): entry is MergeOffer =>
      (entry.kind === "version" || entry.kind === "other-computer") && entry.agentId === agentId,
  );
  if (merge) return { kind: "merge", offer: merge };
  const commit = state.recent.find((entry) => entry.agentId === agentId);
  return commit ? { kind: "applied", commit } : null;
};

export const versionOffer = (state: AppSourceState) =>
  state.waiting.find(
    (offer): offer is Extract<AppSourceWaiting, { kind: "version" }> =>
      offer.kind === "version",
  ) ?? null;

const EMPTY_AGENTS: ReadonlySet<string> = new Set();
const relayedAgents = new Map<string, ReadonlySet<string>>();
const relayedListeners = new Set<() => void>();
const subscribeRelayed = (listener: () => void) => {
  relayedListeners.add(listener);
  return () => {
    relayedListeners.delete(listener);
  };
};

/** Agents whose completion is a row in the conversation's loaded messages: their change shows on that row. */
export const publishRelayedAgents = (conversationId: string, agentIds: string[]) => {
  const known = relayedAgents.get(conversationId) ?? EMPTY_AGENTS;
  if (known.size === agentIds.length && agentIds.every((id) => known.has(id))) return;
  relayedAgents.set(conversationId, new Set(agentIds));
  for (const listener of relayedListeners) listener();
};

export const useRelayedAgents = (conversationId: string | null) =>
  useSyncExternalStore(subscribeRelayed, () =>
    conversationId ? (relayedAgents.get(conversationId) ?? EMPTY_AGENTS) : EMPTY_AGENTS,
  );
