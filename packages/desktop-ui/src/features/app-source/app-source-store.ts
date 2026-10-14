import { useSyncExternalStore } from "react";
import type {
  AppSourceActionResult,
  AppSourceCommit,
  AppSourceDraft,
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

export type AgentChange =
  | { kind: "ready"; draft: AppSourceDraft }
  | { kind: "stale"; draft: AppSourceDraft }
  | { kind: "applied"; commit: AppSourceCommit };

export const agentChange = (
  state: AppSourceState,
  agentId: string,
): AgentChange | null => {
  const mine = (draft: AppSourceDraft) =>
    draft.agentId === agentId && !isStellaDraft(draft.name);
  const ready = state.ready.find(mine);
  if (ready) return { kind: "ready", draft: ready };
  const stale = state.stale.find(mine);
  if (stale) return { kind: "stale", draft: stale };
  const commit = state.recent.find((entry) => entry.agentId === agentId);
  return commit ? { kind: "applied", commit } : null;
};

export const versionOffer = (state: AppSourceState) =>
  state.waiting.find(
    (offer): offer is Extract<AppSourceWaiting, { kind: "version" }> =>
      offer.kind === "version",
  ) ?? null;

export const updateProgress = (state: AppSourceState) => state.update ?? null;
