import { useEffect } from "react";
import { uiState } from "@/platform/ui-state";
import { submitPiWelcome } from "@/features/chat/pi/pi-chat-store";

const PENDING_WELCOME_KEY = "stella-onboarding-pending-welcome";
const PENDING_COMPOSER_KEY = "stella-onboarding-pending-composer";
const WELCOME_PARKED_EVENT = "stella:onboarding-welcome-parked";

export const setPendingDiscoveryWelcome = (message: string) => {
  const trimmed = message.trim();
  if (!trimmed) return;
  uiState.setItem(PENDING_WELCOME_KEY, trimmed);
  window.dispatchEvent(new Event(WELCOME_PARKED_EVENT));
};

export const takePendingDiscoveryWelcome = (): string | null => {
  const value = uiState.getItem(PENDING_WELCOME_KEY);
  if (value === null) return null;
  uiState.removeItem(PENDING_WELCOME_KEY);
  return value;
};

export type PendingComposerDraft = {
  text: string;
  send: boolean;
};

export const setPendingComposerDraft = (draft: PendingComposerDraft) => {
  const text = draft.text.trim();
  if (!text) return;
  uiState.setItem(
    PENDING_COMPOSER_KEY,
    JSON.stringify({ text, send: draft.send }),
  );
};

export const peekPendingComposerDraft = (): PendingComposerDraft | null => {
  const raw = uiState.getItem(PENDING_COMPOSER_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingComposerDraft>;
    if (typeof parsed?.text !== "string" || !parsed.text.trim()) {
      uiState.removeItem(PENDING_COMPOSER_KEY);
      return null;
    }
    return { text: parsed.text, send: parsed.send === true };
  } catch {
    uiState.removeItem(PENDING_COMPOSER_KEY);
    return null;
  }
};

export const takePendingComposerDraft = (): PendingComposerDraft | null => {
  const draft = peekPendingComposerDraft();
  if (draft) uiState.removeItem(PENDING_COMPOSER_KEY);
  return draft;
};

export const clearPendingHandoff = () => {
  uiState.removeItem(PENDING_WELCOME_KEY);
  uiState.removeItem(PENDING_COMPOSER_KEY);
};

export function usePendingDiscoveryWelcome(conversationId: string | null) {
  useEffect(() => {
    if (!conversationId) return;
    const deliver = () => {
      const message = takePendingDiscoveryWelcome();
      if (!message) return;
      void submitPiWelcome(conversationId, message).catch((error) => {
        console.error(
          "[onboarding-chat] Failed to persist the discovery greeting.",
          error,
        );
      });
    };
    deliver();
    window.addEventListener(WELCOME_PARKED_EVENT, deliver);
    return () => window.removeEventListener(WELCOME_PARKED_EVENT, deliver);
  }, [conversationId]);
}
