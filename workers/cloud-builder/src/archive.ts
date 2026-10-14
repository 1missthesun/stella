import {
  BACKFILL_BATCH_BYTES,
  BACKFILL_BATCH_RECORDS,
  DB_PRESSURE_AGGRESSIVE_BYTES,
  DB_PRESSURE_AGGRESSIVE_ROWS,
  DB_PRESSURE_EMERGENCY_BYTES,
  DB_PRESSURE_EMERGENCY_ROWS,
  CUT_SCAN_MAX_ROWS,
  HOT_MAX_BYTES,
  MAX_SEGMENTS_PER_READ,
  RESIDENT_CONTEXT_TOKENS,
  RESIDENT_ROLLOVER_TOKENS,
  utf8Length,
  type ConversationLogger,
  type JournalRange,
  type JournalRecord,
} from "./conversation-types.js";
import { sha256Hex } from "./hash.js";
import { PiEntryArchive, type ArchivedPiEntry } from "./pi-entry-archive.js";
import type {
  Journal,
  JournalRow,
  SegmentRow,
} from "./journal.js";

const SEGMENT_MAX_ROWS = 1_000;
const SEGMENT_MAX_BYTES = 8 * 1024 * 1024;
const SEGMENTS_PER_PASS = 4;
const CUT_BOUNDARY_CANDIDATES = 64;
const ARCHIVE_READ_ROWS = 500;
const PURGE_BATCH = 200;
const PURGE_MAX_FAILED_BATCHES = 3;
const R2_TIMEOUT_MS = 30_000;

const pad = (value: number): string => String(value).padStart(12, "0");

const withTimeout = async <T>(work: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Archive storage timed out.")),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

export type SegmentHeader = {
  v: 1;
  conversationId: string;
  ownerId: string;
  epoch: number;
  firstSeq: number;
  lastSeq: number;
  rows: number;
  createdAt: number;
};

export class ConversationArchive {
  private ownerHashCache: { ownerId: string; hash: string } | null = null;

  private readonly inFlight = new Set<Promise<unknown>>();

  /**
   * Set by the purge, never cleared. The durable tombstone cannot carry this
   * fence on its own: `deleteAll()` destroys it, and the purge handler then
   * re-bootstraps an empty journal so the object can keep refusing requests —
   * which means `journal.isDeleted()` reads false again the moment the purge
   * returns. A request that was already in flight resumes against that empty
   * journal and writes an R2 object under the deleted conversation's prefix
   * that no manifest, queue or sweep has ever heard of. This flag is what stays
   * true across the wipe, for as long as the isolate lives.
   */
  private sealed = false;

  seal(): void {
    this.sealed = true;
  }

  constructor(
    private readonly bucket: R2Bucket | undefined,
    private readonly journal: Journal,
    private readonly log: ConversationLogger,
    private readonly checkpointSeq: () => Promise<number | undefined>,
    storage?: DurableObjectStorage,
  ) {
    this.piEntries =
      bucket && storage
        ? new PiEntryArchive(
            storage.sql,
            storage,
            bucket,
            () => this.journal.ensureCrypto(),
            log,
          )
        : null;
  }

  private readonly piEntries: PiEntryArchive | null;

  get available(): boolean {
    return this.bucket !== undefined;
  }

  private track<T>(work: Promise<T>): Promise<T> {
    const tracked = work.finally(() => {
      this.inFlight.delete(tracked);
    });
    this.inFlight.add(tracked);
    return tracked;
  }

  /**
   * Waits until no R2 write this object started is still running. Called by the
   * purge after the tombstone is set and before it snapshots the keys to
   * delete: the tombstone stops new writes from starting, this waits out the
   * ones that had already started, and together they make "the manifest names
   * every object" true rather than probable.
   *
   * Settled, not fulfilled: a write that failed still owes its key to the
   * manifest, and a rejection propagating from here would abandon the purge.
   * The pass limit bounds the wait — a tracked write that spawns another can
   * otherwise keep this loop alive, and the purge is holding an HTTP request
   * open.
   */
  async quiesce(): Promise<void> {
    for (let pass = 0; pass < 4 && this.inFlight.size > 0; pass += 1) {
      await Promise.allSettled([...this.inFlight]);
    }
  }

  private async prefix(): Promise<string | null> {
    const meta = this.journal.meta();
    if (!meta.owner_id || !meta.conversation_id) return null;
    if (this.ownerHashCache?.ownerId !== meta.owner_id) {
      this.ownerHashCache = {
        ownerId: meta.owner_id,
        hash: await sha256Hex(meta.owner_id),
      };
    }
    return `conversations/${this.ownerHashCache.hash}/${meta.conversation_id}`;
  }

  async writeSpill(
    writerKey: string,
    payloadJson: string,
  ): Promise<string | null> {
    if (!this.bucket) return null;
    if (this.sealed || this.journal.isDeleted()) return null;
    return this.track(this.spill(writerKey, payloadJson));
  }

  private async spill(
    writerKey: string,
    payloadJson: string,
  ): Promise<string | null> {
    const prefix = await this.prefix();
    if (!this.bucket || !prefix) return null;
    const key = `${prefix}/spill/${(await sha256Hex(writerKey)).slice(0, 32)}.json.gz`;
    const stored = this.journal.encodePayload(payloadJson);
    const body = await gzip([new TextEncoder().encode(stored)]);
    await withTimeout(this.bucket.put(key, body), R2_TIMEOUT_MS);
    this.journal.recordSpill(key, utf8Length(stored), Date.now());
    return key;
  }

  async readSpill(key: string): Promise<unknown | null> {
    if (!this.bucket) return null;
    const object = await withTimeout(this.bucket.get(key), R2_TIMEOUT_MS);
    if (!object) return null;
    const text = await new Response(
      object.body.pipeThrough(new DecompressionStream("gzip")),
    ).text();
    try {
      return JSON.parse(this.journal.decodePayload(text));
    } catch {
      return null;
    }
  }

  async maybeRollover(now: number): Promise<void> {
    if (!this.bucket) return;
    if (this.sealed || this.journal.isDeleted()) return;
    return this.track(
      (async () => {
        await this.rollover(now);
        await this.archivePiEntries(now);
      })(),
    );
  }

  private async archivePiEntries(now: number): Promise<void> {
    if (!this.piEntries) return;
    try {
      const prefix = await this.prefix();
      if (!prefix) return;
      await this.piEntries.prune(
        prefix,
        () => this.sealed || this.journal.isDeleted(),
        now,
      );
    } catch (error) {
      this.log("error", "pi_entries_archive_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  piEntryArchiveKeys(): string[] {
    return this.piEntries?.allKeys() ?? [];
  }

  async readPiEntries(
    piConversationId: number,
    options: { beforeId?: number; limit?: number } = {},
  ): Promise<{ entries: ArchivedPiEntry[]; hasOlder: boolean }> {
    if (!this.piEntries) return { entries: [], hasOlder: false };
    return await this.piEntries.read(piConversationId, options);
  }

  hasArchivedPiEntries(piConversationId: number, beforeId?: number): boolean {
    return this.piEntries?.hasArchived(piConversationId, beforeId) ?? false;
  }

  private async rollover(now: number): Promise<void> {
    try {
      await this.finishPendingSegment();
      if (this.sealed || this.journal.isDeleted()) return;
      const checkpoint = await this.checkpointSeq();
      if (this.sealed || this.journal.isDeleted()) return;
      const plan = this.residencyCeiling(checkpoint);
      if (!plan) return;
      for (let pass = 0; pass < SEGMENTS_PER_PASS; pass += 1) {
        const cutSeq = this.resolveCut(plan.ceiling, plan.reason !== "checkpoint");
        if (cutSeq === null) {
          if (pass === 0) {
            this.log("info", "rollover_no_boundary", {
              ceiling: plan.ceiling,
              reason: plan.reason,
              hotRows: plan.hot.rows,
              hotBytes: plan.hot.bytes,
              hotTokens: plan.hot.tokens,
            });
          }
          return;
        }
        const committed = await this.cut(cutSeq, now);
        if (!committed || this.sealed || this.journal.isDeleted()) return;
        if (committed >= cutSeq) return;
      }
    } catch (error) {
      this.log("error", "conversation_rollover_failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private residencyCeiling(checkpoint: number | undefined): {
    ceiling: number;
    reason: string;
    hot: { rows: number; bytes: number; tokens: number };
  } | null {
    const hot = this.journal.hotStats();
    const dbBytes = this.journal.databaseSize();
    if (dbBytes > DB_PRESSURE_AGGRESSIVE_BYTES) {
      const tier =
        dbBytes > DB_PRESSURE_EMERGENCY_BYTES ? "emergency" : "aggressive";
      this.log("error", "conversation_storage_pressure", {
        tier,
        databaseBytes: dbBytes,
        hotRows: hot.rows,
        checkpoint: checkpoint ?? null,
      });
      const desired = this.journal.desiredCutSeq(
        tier === "emergency"
          ? DB_PRESSURE_EMERGENCY_ROWS
          : DB_PRESSURE_AGGRESSIVE_ROWS,
        0,
      );
      return desired === null ? null : { ceiling: desired, reason: tier, hot };
    }
    const floor = this.journal.meta().hot_min_seq;
    const overBytes = hot.bytes > HOT_MAX_BYTES;
    let ceiling: number | null = null;
    let reason = "checkpoint";
    if (checkpoint !== undefined && checkpoint >= floor) ceiling = checkpoint;
    if (overBytes || (checkpoint === undefined && hot.tokens > RESIDENT_ROLLOVER_TOKENS)) {
      const windowCut = this.journal.seqBeforeContextTokens(
        RESIDENT_CONTEXT_TOKENS,
        CUT_SCAN_MAX_ROWS,
      );
      if (windowCut !== null && (ceiling === null || windowCut > ceiling)) {
        ceiling = windowCut;
        reason = overBytes ? "backstop" : "window";
        if (checkpoint !== undefined && windowCut > checkpoint) {
          this.log("error", "rollover_past_checkpoint", {
            checkpoint,
            ceiling: windowCut,
            hotBytes: hot.bytes,
            hotTokens: hot.tokens,
          });
        }
      }
    }
    if (ceiling === null || ceiling < floor) return null;
    return { ceiling, reason, hot };
  }

  private resolveCut(desired: number, belowContext: boolean): number | null {
    const latest = belowContext ? this.journal.latestTerminalTurn() : null;
    const ceiling =
      latest?.ctx_start_seq != null
        ? Math.min(desired, latest.ctx_start_seq - 1)
        : desired;
    const floor = this.journal.meta().hot_min_seq;
    if (ceiling < floor) return null;
    for (const candidate of this.journal.terminalTurnBoundariesAtOrBelow(
      ceiling,
      CUT_BOUNDARY_CANDIDATES,
    )) {
      if (candidate.last_seq < floor) return null;
      if (this.journal.isCutBoundary(candidate.last_seq)) {
        return candidate.last_seq;
      }
    }
    return null;
  }

  private async cut(cutSeq: number, now: number): Promise<number | null> {
    const meta = this.journal.meta();
    const prefix = await this.prefix();
    if (!this.bucket || !prefix) return null;
    if (this.sealed || this.journal.isDeleted()) return null;
    const firstSeq = meta.hot_min_seq;
    if (cutSeq < firstSeq) return null;
    const rows = this.journal.rowsForArchive(
      firstSeq,
      cutSeq,
      SEGMENT_MAX_ROWS,
    );
    if (rows.length === 0) return null;
    let bytes = 0;
    let lastSeq = rows[0]!.seq;
    let count = 0;
    for (const row of rows) {
      if (count > 0 && bytes + row.bytes > SEGMENT_MAX_BYTES) break;
      bytes += row.bytes;
      lastSeq = row.seq;
      count += 1;
    }
    while (lastSeq > firstSeq && !this.journal.isCutBoundary(lastSeq)) {
      lastSeq -= 1;
    }
    if (lastSeq < firstSeq || !this.journal.isCutBoundary(lastSeq)) return null;
    count = 0;
    bytes = 0;
    for (const row of rows) {
      if (row.seq > lastSeq) break;
      count += 1;
      bytes += row.bytes;
    }
    const key = `${prefix}/seg/${pad(firstSeq)}-${pad(lastSeq)}.jsonl.gz`;
    const header: SegmentHeader = {
      v: 1,
      conversationId: meta.conversation_id,
      ownerId: meta.owner_id,
      epoch: meta.epoch,
      firstSeq,
      lastSeq,
      rows: count,
      createdAt: now,
    };
    this.journal.insertSegment({
      first_seq: firstSeq,
      last_seq: lastSeq,
      rows: count,
      bytes,
      r2_key: key,
      state: "uploading",
      created_at: now,
    });
    await this.upload(key, header, firstSeq, lastSeq);
    this.journal.commitSegment(firstSeq, lastSeq);
    this.log("info", "conversation_segment_committed", {
      firstSeq,
      lastSeq,
      rows: count,
      bytes,
    });
    return lastSeq;
  }

  private async finishPendingSegment(): Promise<void> {
    const pending = this.journal.pendingSegment();
    if (!pending) return;
    const meta = this.journal.meta();
    await this.upload(
      pending.r2_key,
      {
        v: 1,
        conversationId: meta.conversation_id,
        ownerId: meta.owner_id,
        epoch: meta.epoch,
        firstSeq: pending.first_seq,
        lastSeq: pending.last_seq,
        rows: pending.rows,
        createdAt: pending.created_at,
      },
      pending.first_seq,
      pending.last_seq,
    );
    this.journal.commitSegment(pending.first_seq, pending.last_seq);
    this.log("info", "conversation_segment_recovered", {
      firstSeq: pending.first_seq,
      lastSeq: pending.last_seq,
    });
  }

  /**
   * Every column travels, `writer_key` included, so re-importing a segment is
   * a byte-identical no-op against the UNIQUE index.
   *
   * `contentEncoding` is deliberately NOT set: whether the R2 binding
   * transparently decodes a gzip-encoded body on `get()` is exactly the kind
   * of ambiguity that works in one runtime and not the next. The `.gz` suffix
   * carries the meaning and this module always decompresses explicitly.
   */
  private async upload(
    key: string,
    header: SegmentHeader,
    firstSeq: number,
    lastSeq: number,
  ): Promise<void> {
    if (!this.bucket) throw new Error("No conversation archive bucket bound.");
    const encoder = new TextEncoder();
    const chunks: Uint8Array[] = [
      encoder.encode(`${JSON.stringify(header)}\n`),
    ];
    let cursor = firstSeq;
    for (;;) {
      const batch = this.journal.rowsForArchive(
        cursor,
        lastSeq,
        ARCHIVE_READ_ROWS,
      );
      if (batch.length === 0) break;
      let text = "";
      for (const row of batch) text += `${JSON.stringify(row)}\n`;
      chunks.push(encoder.encode(text));
      cursor = batch[batch.length - 1]!.seq + 1;
      if (cursor > lastSeq) break;
    }
    const body = await gzip(chunks);
    await withTimeout(this.bucket.put(key, body), R2_TIMEOUT_MS);
  }

  async readRange(
    fromSeq: number,
    toSeq: number,
    limit: number,
  ): Promise<JournalRange> {
    const head = this.journal.head();
    const start = Math.max(0, fromSeq);
    const end = Math.min(toSeq, head.headSeq);
    if (end < start) return { records: [], complete: true };
    const maxRecords = Math.min(limit, BACKFILL_BATCH_RECORDS);
    const records: JournalRecord[] = [];
    let missingBelowSeq: number | undefined;
    let cursor = start;

    if (cursor < head.windowStartSeq) {
      const coldEnd = Math.min(end, head.windowStartSeq - 1);
      const segments = this.journal.segmentsCovering(
        cursor,
        coldEnd,
        MAX_SEGMENTS_PER_READ,
      );
      const lowestCovered = segments[0]?.first_seq;
      if (lowestCovered === undefined || lowestCovered > cursor) {
        missingBelowSeq = lowestCovered ?? head.windowStartSeq;
        cursor = missingBelowSeq;
      }
      for (const segment of segments) {
        if (records.length >= maxRecords) break;
        const rows = await this.readSegment(segment);
        for (const row of rows) {
          if (row.seq < cursor || row.seq > coldEnd) continue;
          if (records.length >= maxRecords) break;
          records.push(this.journal.rowToRecord(row));
          cursor = row.seq + 1;
        }
      }
      if (cursor <= coldEnd) {
        return {
          records,
          complete: false,
          ...(missingBelowSeq !== undefined ? { missingBelowSeq } : {}),
        };
      }
    }

    if (records.length < maxRecords && cursor <= end) {
      const resident = this.journal.readResident(
        Math.max(cursor, head.windowStartSeq),
        end,
        maxRecords - records.length,
        BACKFILL_BATCH_BYTES,
      );
      records.push(...resident.records);
      return {
        records,
        complete: resident.complete,
        ...(missingBelowSeq !== undefined ? { missingBelowSeq } : {}),
      };
    }

    return {
      records,
      complete: cursor > end,
      ...(missingBelowSeq !== undefined ? { missingBelowSeq } : {}),
    };
  }

  /**
   * Re-read the segments archived before agents' reports and messages were
   * searched, once, so their hidden prompts join the search index. Each
   * segment is remembered as done, so an interrupted pass resumes.
   */
  async reindexArchivedSearch(): Promise<void> {
    if (!this.bucket || this.sealed || this.journal.isDeleted()) return;
    const running = this.reindexing;
    if (running) return await running;
    const work = this.track(
      (async () => {
        for (const segment of await this.journal.searchReindexPending()) {
          if (this.sealed || this.journal.isDeleted()) return;
          const rows = await this.readSegment(segment);
          await this.journal.reindexArchivedSegment(segment.first_seq, rows);
        }
      })().finally(() => {
        this.reindexing = null;
      }),
    );
    this.reindexing = work;
    await work;
  }

  private reindexing: Promise<void> | null = null;

  private async readSegment(segment: SegmentRow): Promise<JournalRow[]> {
    if (!this.bucket) return [];
    const object = await withTimeout(
      this.bucket.get(segment.r2_key),
      R2_TIMEOUT_MS,
    );
    if (!object) {
      this.log("error", "conversation_segment_missing", {
        r2Key: segment.r2_key,
        firstSeq: segment.first_seq,
      });
      return [];
    }
    const text = await new Response(
      object.body.pipeThrough(new DecompressionStream("gzip")),
    ).text();
    const rows: JournalRow[] = [];
    let first = true;
    for (const line of text.split("\n")) {
      if (!line) continue;
      if (first) {
        first = false;
        continue;
      }
      try {
        rows.push(JSON.parse(line) as JournalRow);
      } catch {
        // A corrupt line degrades scrollback; it must not fail the read.
      }
    }
    return rows;
  }

  /**
   * Drains `purge_queue`, removing only keys R2 confirmed. The caller must not
   * call `deleteAll()` until this reports zero pending: `deleteAll()` destroys
   * the manifest, which is the only record of the keys, and the objects would
   * then be unreachable forever.
   *
   * The caller must also have tombstoned the conversation and awaited
   * `quiesce()` before it snapshotted those keys. A key that reaches the
   * manifest after the snapshot is a key this drain never sees, and the
   * `deleteAll()` behind it takes the last record of the object with it.
   */
  async drainPurge(): Promise<{ pending: number }> {
    if (!this.bucket) {
      for (;;) {
        const keys = this.journal.purgeBatch(PURGE_BATCH);
        if (keys.length === 0) break;
        this.journal.purgeDone(keys);
      }
      return { pending: this.journal.purgePending() };
    }
    let failures = 0;
    for (;;) {
      const keys = this.journal.purgeBatch(PURGE_BATCH);
      if (keys.length === 0) break;
      try {
        await withTimeout(this.bucket.delete(keys), R2_TIMEOUT_MS);
        this.journal.purgeDone(keys);
      } catch (error) {
        this.journal.purgeFailed(keys);
        this.log("error", "conversation_purge_delete_failed", {
          keys: keys.length,
          message: error instanceof Error ? error.message : String(error),
        });
        failures += 1;
        if (failures >= PURGE_MAX_FAILED_BATCHES) break;
      }
    }
    return { pending: this.journal.purgePending() };
  }
}

const gzip = async (chunks: Uint8Array[]): Promise<ArrayBuffer> => {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return await new Response(
    source.pipeThrough(new CompressionStream("gzip")),
  ).arrayBuffer();
};
