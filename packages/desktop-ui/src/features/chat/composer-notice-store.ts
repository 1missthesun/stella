import { useSyncExternalStore } from "react";
import { showToast, type ToastOptions } from "@/ui/toast";

export type ComposerNoticeKind = "sign-in" | "upgrade" | "limit" | "provider";

export type ComposerNoticeAction = {
  label: string;
  onClick: () => void;
};

export type ComposerNotice = {
  id: string;
  conversationId: string | null;
  kind: ComposerNoticeKind;
  title: string;
  description?: string;
  action?: ComposerNoticeAction;
  secondaryAction?: ComposerNoticeAction;
  claudeSignIn?: { email?: string };
};

export type ComposerNoticeInput = Omit<ComposerNotice, "id"> & {
  id?: string;
};

let notices: ComposerNotice[] = [];
const listeners = new Set<() => void>();
let mountedSurfaces = 0;
let nextId = 0;

const emitChange = () => {
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => notices;

export const showComposerNotice = (input: ComposerNoticeInput): string => {
  const id = input.id ?? `composer-notice-${++nextId}`;
  const next: ComposerNotice = { ...input, id };
  notices = [
    ...notices.filter((entry) => entry.conversationId !== input.conversationId),
    next,
  ];
  emitChange();
  return id;
};

export const dismissComposerNotice = (id: string): void => {
  if (!notices.some((entry) => entry.id === id)) return;
  notices = notices.filter((entry) => entry.id !== id);
  emitChange();
};

export const clearComposerNotices = (
  conversationId: string | null | undefined,
  keep?: (notice: ComposerNotice) => boolean,
): void => {
  const remaining = notices.filter(
    (entry) =>
      keep?.(entry) ||
      (entry.conversationId !== null &&
        entry.conversationId !== (conversationId ?? null)),
  );
  if (remaining.length === notices.length) return;
  notices = remaining;
  emitChange();
};

export const selectComposerNotice = (
  entries: readonly ComposerNotice[],
  conversationId: string | null | undefined,
): ComposerNotice | null => {
  const scoped = conversationId
    ? entries.find((entry) => entry.conversationId === conversationId)
    : undefined;
  if (scoped) return scoped;
  return entries.find((entry) => entry.conversationId === null) ?? null;
};

export const useComposerNotice = (
  conversationId: string | null | undefined,
): ComposerNotice | null => {
  const entries = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return selectComposerNotice(entries, conversationId);
};

export const registerComposerNoticeSurface = (): (() => void) => {
  mountedSurfaces += 1;
  return () => {
    mountedSurfaces = Math.max(0, mountedSurfaces - 1);
  };
};

export const hasComposerNoticeSurface = (): boolean => mountedSurfaces > 0;

export const presentComposerNotice = (
  notice: ComposerNoticeInput,
  fallback?: ToastOptions,
): void => {
  if (hasComposerNoticeSurface()) {
    showComposerNotice(notice);
    return;
  }
  showToast(
    fallback ?? {
      title: notice.title,
      description: notice.description,
      variant: "error",
      duration: 8000,
      action: notice.action,
      secondaryAction: notice.secondaryAction,
    },
  );
};
