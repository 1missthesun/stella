import { CANONICAL_PROMPTS, type CanonicalPrompts } from "../cloud-prompt.js";
import { BACKFILL_BATCH_RECORDS } from "../conversation-types.js";
import type { ChatTurnRequest } from "./types.js";
import { json } from "./support.js";
import { OrchestratorTurnQueue } from "./turn-queue.js";
import { JOURNAL_CHECKPOINT_KEY } from "./constants.js";

export abstract class OrchestratorJournalProbe extends OrchestratorTurnQueue {
  protected async loadCanonicalPromptsForTurn(
    signal?: AbortSignal,
  ): Promise<CanonicalPrompts> {
    signal?.throwIfAborted();
    return CANONICAL_PROMPTS;
  }

  protected async handleJournalProbe(url: URL): Promise<Response> {
    const requested = Number(url.searchParams.get("limit") ?? "50");
    const limit = Math.min(
      Number.isFinite(requested) && requested > 0 ? requested : 50,
      BACKFILL_BATCH_RECORDS,
    );
    const head = this.journal.head(this.live ? "running" : "idle");
    const beforeSeq = url.searchParams.get("beforeSeq");
    const to =
      beforeSeq !== null && Number.isFinite(Number(beforeSeq))
        ? Number(beforeSeq) - 1
        : head.headSeq;
    const from = Math.max(0, to - limit + 1);
    const range = await this.archive.readRange(from, to, limit);
    const meta = this.journal.meta();
    const queued = await this.ctx.storage.list<ChatTurnRequest>({
      prefix: "queued:",
    });
    return json({
      head,
      alarmAt: await this.ctx.storage.getAlarm(),
      queued: [...queued.values()].map((entry) => entry.turnId),
      sealed: this.purged(),
      indexSyncedSeq: meta.index_synced_seq,
      hot: this.journal.hotStats(),
      checkpoint: await this.ctx.storage
        .get<{ throughSeq: number; epoch: number; summary: string }>(
          JOURNAL_CHECKPOINT_KEY,
        )
        .then((stored) =>
          stored
            ? {
                throughSeq: stored.throughSeq,
                epoch: stored.epoch,
                summaryChars: stored.summary.length,
                summaryHead: stored.summary.slice(0, 240),
              }
            : null,
        ),
      inbox: this.journal.inboxSize(),
      databaseBytes: this.journal.databaseSize(),
      storedBytes: this.journal.storedBytes(),
      spillObjects: this.journal.allSpillKeys().length,
      purgePending: this.journal.purgePending(),
      complete: range.complete,
      records: range.records,
    });
  }
}
