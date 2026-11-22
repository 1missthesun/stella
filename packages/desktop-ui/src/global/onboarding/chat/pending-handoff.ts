import { uiState } from "@/platform/ui-state";

const PENDING_COMPOSER_KEY = "stella-onboarding-pending-composer";

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

const peekPendingComposerDraft = (): PendingComposerDraft | null => {
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
  uiState.removeItem(PENDING_COMPOSER_KEY);
};
