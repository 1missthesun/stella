import { useEffect, useState } from "react";
import type { ConversationFocusRoot } from "@stella/contracts/reply-refs";

export type ConversationFocus = {
  conversationId: string;
  root: ConversationFocusRoot;
  title?: string;
};

type Listener = (focus: ConversationFocus | null) => void;

let current: ConversationFocus | null = null;
const listeners = new Set<Listener>();

const emit = () => {
  for (const listener of listeners) listener(current);
};

export const openConversationFocus = (focus: ConversationFocus): void => {
  if (
    current &&
    current.conversationId === focus.conversationId &&
    focusRootKey(current.root) === focusRootKey(focus.root)
  ) {
    if ((current.title ?? "") === (focus.title ?? "")) return;
  }
  current = focus;
  emit();
};

export const closeConversationFocus = (): void => {
  if (!current) return;
  current = null;
  emit();
};

export const subscribeToConversationFocus = (
  listener: Listener,
): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const focusRootKey = (root: ConversationFocusRoot): string =>
  root.kind === "message" ? `message:${root.id}` : `agent:${root.threadId}`;

export const useConversationFocus = (
  conversationId: string | null | undefined,
): ConversationFocus | null => {
  const [focus, setFocus] = useState<ConversationFocus | null>(() =>
    current && current.conversationId === conversationId ? current : null,
  );
  useEffect(() => {
    const sync = (next: ConversationFocus | null) => {
      setFocus(next && next.conversationId === conversationId ? next : null);
    };
    sync(current);
    return subscribeToConversationFocus(sync);
  }, [conversationId]);
  return focus;
};

