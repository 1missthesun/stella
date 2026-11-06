import { useSyncExternalStore } from "react";

export type FailedSendActions = { retry: () => void; remove: () => void };

const actions = new Map<string, FailedSendActions>();
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

export const registerFailedSend = (
  userMessageId: string,
  next: FailedSendActions,
) => {
  actions.set(userMessageId, next);
  emit();
};

export const clearFailedSend = (userMessageId: string) => {
  if (actions.delete(userMessageId)) emit();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useFailedSend = (
  userMessageId: string,
): FailedSendActions | undefined =>
  useSyncExternalStore(subscribe, () => actions.get(userMessageId));
