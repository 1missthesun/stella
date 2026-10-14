import type { DispatchSummary } from "@stella/contracts/turn-plane/placement";

export type SubmittingPlacement = { conversationId: string; stopped: boolean };

export class ConversationPlacements {
  readonly #submitting = new Set<SubmittingPlacement>();
  readonly #placed = new Map<string, Set<string>>();

  submitting(conversationId: string): SubmittingPlacement {
    const entry: SubmittingPlacement = { conversationId, stopped: false };
    this.#submitting.add(entry);
    return entry;
  }

  submitted(entry: SubmittingPlacement, dispatchId?: string): void {
    this.#submitting.delete(entry);
    if (dispatchId) this.placed(entry.conversationId, dispatchId);
  }

  placed(conversationId: string, dispatchId: string): void {
    const ids = this.#placed.get(conversationId) ?? new Set<string>();
    ids.add(dispatchId);
    this.#placed.set(conversationId, ids);
  }

  placedIn(conversationId: string, except?: string): string[] {
    return [...(this.#placed.get(conversationId) ?? [])].filter((id) => id !== except);
  }

  ended(dispatchId: string): void {
    for (const [conversationId, ids] of this.#placed) {
      if (ids.delete(dispatchId) && ids.size === 0) this.#placed.delete(conversationId);
    }
  }

  stop(conversationId: string): string[] {
    for (const entry of this.#submitting) {
      if (entry.conversationId === conversationId) entry.stopped = true;
    }
    return this.placedIn(conversationId);
  }

  clear(): void {
    for (const entry of this.#submitting) entry.stopped = true;
    this.#submitting.clear();
    this.#placed.clear();
  }
}

const TERMINAL_DISPATCH_STATES = new Set(["completed", "failed", "canceled", "blocked"]);

export const isDispatchEnded = (status: Pick<DispatchSummary, "state"> | null | undefined): boolean =>
  !status || TERMINAL_DISPATCH_STATES.has(status.state);

export const isCloudHandedOff = (
  status: Pick<DispatchSummary, "placement" | "cloudTurnId"> | null | undefined,
): boolean =>
  Boolean(
    status &&
      status.placement === "cloud" &&
      typeof status.cloudTurnId === "string" &&
      status.cloudTurnId.trim(),
  );
