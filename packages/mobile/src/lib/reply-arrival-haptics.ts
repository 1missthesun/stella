import type { ChatMessage } from "../types";
import {
  hasToolCalls,
  type JournalRecord,
} from "@stella/contracts/conversation-protocol";
import type { ConversationState } from "./cloud-conversation-store";
import { cloudTurnActivity, journalTurnUnsuccessful } from "./cloud-journal-projection";
import type { JournalIndex } from "./journal-index";

export class ReplyArrivalHaptics {
  private pending = new Set<string>();

  arm(userMessageId: string): void {
    this.pending.add(userMessageId);
  }

  reset(): void {
    this.pending.clear();
  }

  observeConnection(
    snapshot: Pick<
      ConversationState,
      "status" | "epoch" | "records" | "headSeq"
    >,
  ): void {
    if (
      snapshot.status !== "live" ||
      snapshot.epoch === null ||
      (snapshot.records.at(-1)?.seq ?? -1) < snapshot.headSeq
    )
      this.reset();
  }

  take(messages: readonly ChatMessage[], index: JournalIndex): string[] {
    if (this.pending.size === 0) return [];
    const recordOf = (message: ChatMessage) =>
      message.sequence === undefined ? undefined : index.recordAt(message.sequence);
    const unsuccessful = (turnId: string) => journalTurnUnsuccessful(index, turnId);
    const arrived: string[] = [];
    for (const message of messages) {
      if (message.role !== "user" || !this.pending.has(message.id)) continue;
      const record = recordOf(message);
      if (message.stopped || (record && unsuccessful(record.turnId))) {
        this.pending.delete(message.id);
      }
    }
    for (const message of messages) {
      const requestId = message.requestId;
      if (
        message.role !== "assistant" ||
        !requestId ||
        !this.pending.has(requestId)
      )
        continue;
      const record = recordOf(message);
      if (!record || record.kind !== "message" || record.role !== "assistant")
        continue;
      if (
        message.stopped ||
        unsuccessful(record.turnId) ||
        record.payload.isError === true ||
        record.payload.stopReason === "error" ||
        record.payload.stopReason === "aborted"
      ) {
        this.pending.delete(requestId);
        continue;
      }
      if (
        record.hidden ||
        hasToolCalls(record.payload) ||
        !message.text.trim() ||
        !cloudTurnActivity(index.turn(record.turnId)?.records ?? [], record.turnId)
          .answerLanded
      )
        continue;
      this.pending.delete(requestId);
      arrived.push(requestId);
    }
    return arrived;
  }
}
