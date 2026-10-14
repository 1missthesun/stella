export type PendingComposerDraft = {
  text: string;
  send: boolean;
};

let pending: PendingComposerDraft | null = null;

export function setPendingComposerDraft(draft: PendingComposerDraft): void {
  const text = draft.text.trim();
  pending = text ? { text, send: draft.send } : null;
}

export function peekPendingComposerDraft(): PendingComposerDraft | null {
  return pending;
}

export function clearPendingComposerDraft(): void {
  pending = null;
}
