import type { PickedAttachment } from "./chat-attachments";

export type PendingShare = {
  text?: string;
  attachments?: PickedAttachment[];
};

let pending: PendingShare | null = null;
const listeners = new Set<() => void>();

export function setPendingShare(share: PendingShare) {
  pending = share;
  for (const listener of listeners) listener();
}

export function consumePendingShare(): PendingShare | null {
  const out = pending;
  pending = null;
  return out;
}

export function subscribePendingShare(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
