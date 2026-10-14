/**
 * Cold storage for pi-durable's transcript entries, the other half of what a
 * long-lived conversation keeps in its Durable Object.
 *
 * pi-durable (the harness the cloud orchestrator and its cloud agents run on)
 * shares this object's SQLite and never deletes an entry: its root
 * conversation mirrors the whole journal (`importJournal`) and every agent
 * conversation keeps its full transcript. A compaction only moves the head
 * marker, so the model never reads an entry below the latest marker's head
 * again. In Rahul's main chat those entries were 34 MB of the object's 98 MB
 * (2026-10-13) and grew every turn.
 *
 * Entries below a conversation's context (its latest head marker's `head`,
 * less a margin) move to R2 here, in the journal's own pattern: the manifest
 * row records the intent, the object is written, and only then are the rows
 * deleted, in one transaction with the manifest's commit. A crash leaves rows
 * resident and the range marked `uploading`; the next pass uploads it again.
 *
 * What is moved stays readable: `read()` serves it to the two readers of old
 * entries, an agent's own `history.*` and the clients' older-history page.
 * Objects are gzip JSONL, sealed under the conversation's key when it has one.
 */

import { Buffer } from "node:buffer";
import type { ConversationLogger } from "./conversation-types.js";

/** Entries kept below a context's head anyway, for scans that start there. */
const KEEP_BELOW_HEAD = 64;
/** Fewer prunable entries than this wait for a later pass. */
const MIN_ARCHIVE_ROWS = 128;
const OBJECT_MAX_ROWS = 2_000;
const OBJECT_MAX_BYTES = 8 * 1024 * 1024;
/** Objects one pass may write; a backlog drains over successive turns. */
const OBJECTS_PER_PASS = 4;
const R2_TIMEOUT_MS = 30_000;

const DDL = `CREATE TABLE IF NOT EXISTS pi_entry_archives (
   first_id        INTEGER PRIMARY KEY,
   last_id         INTEGER NOT NULL,
   conversation_id INTEGER NOT NULL,
   rows            INTEGER NOT NULL,
   bytes           INTEGER NOT NULL,
   r2_key          TEXT    NOT NULL,
   state           TEXT    NOT NULL,
   created_at      INTEGER NOT NULL
 )`;

type ArchiveRow = {
  first_id: number;
  last_id: number;
  conversation_id: number;
  rows: number;
  bytes: number;
  r2_key: string;
  state: string;
  created_at: number;
};

type EntryRow = {
  id: number;
  conversation_id: number;
  head: number | null;
  commit_seq: number;
  record: string;
};

/** An archived entry as pi-durable stored it: `record` is its EntryRecord. */
export type ArchivedPiEntry = { id: number; record: unknown };

export type PiEntrySealer = {
  sealBytes(plain: Uint8Array): Uint8Array;
  openBytes(sealed: Uint8Array): Uint8Array;
} | null;

const pad = (value: number): string => String(value).padStart(12, "0");

const withTimeout = async <T>(work: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Archive storage timed out.")), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

const streamThrough = async (
  bytes: Uint8Array,
  transform: CompressionStream | DecompressionStream,
): Promise<Uint8Array> =>
  new Uint8Array(
    await new Response(new Blob([bytes]).stream().pipeThrough(transform)).arrayBuffer(),
  );

export class PiEntryArchive {
  constructor(
    private readonly sql: SqlStorage,
    private readonly storage: DurableObjectStorage,
    private readonly bucket: R2Bucket,
    private readonly sealer: () => PiEntrySealer,
    private readonly log: ConversationLogger,
  ) {}

  private hasTable(name: string): boolean {
    return (
      this.sql
        .exec<{ count: number }>(
          `SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = ?`,
          name,
        )
        .one().count > 0
    );
  }

  /** Every object this conversation's pi entries were moved to, for the purge. */
  allKeys(): string[] {
    if (!this.hasTable("pi_entry_archives")) return [];
    return this.sql
      .exec<{ r2_key: string }>(`SELECT r2_key FROM pi_entry_archives`)
      .toArray()
      .map((row) => row.r2_key);
  }

  /**
   * Move what no context reads any more. `stop()` is checked between objects:
   * a purge or a tombstone ends the pass. Returns the entries moved.
   */
  async prune(prefix: string, stop: () => boolean, now: number): Promise<number> {
    if (!this.hasTable("entries") || !this.hasTable("conversations")) return 0;
    this.sql.exec(DDL);
    let moved = 0;
    let objects = 0;
    for (const pending of this.sql
      .exec<ArchiveRow>(`SELECT * FROM pi_entry_archives WHERE state = 'uploading' ORDER BY first_id`)
      .toArray()) {
      if (stop() || objects >= OBJECTS_PER_PASS) return moved;
      moved += await this.upload(pending);
      objects += 1;
    }
    for (const { conversationId, below } of this.prunable()) {
      for (;;) {
        if (stop() || objects >= OBJECTS_PER_PASS) return moved;
        const range = this.nextRange(conversationId, below, prefix, now);
        if (!range) break;
        moved += await this.upload(range);
        objects += 1;
      }
    }
    return moved;
  }

  /**
   * Per conversation, the entry id below which nothing is read: its latest
   * head marker's head, less a margin. Left alone: a conversation with a task
   * still going (a run may hold an older head), and one that another
   * conversation forks from (the fork reads the parent's entries).
   */
  private prunable(): Array<{ conversationId: number; below: number }> {
    const conversations = this.sql
      .exec<{ id: number; record: string }>(`SELECT id, record FROM conversations`)
      .toArray();
    const forked = new Set<number>();
    for (const row of conversations) {
      try {
        const parent = (JSON.parse(row.record) as { parent?: { conversationId?: unknown } }).parent;
        if (typeof parent?.conversationId === "number") forked.add(parent.conversationId);
      } catch {
        // Unreadable: treat nothing as forked from it; it is not pruned either.
        forked.add(row.id);
      }
    }
    const busy = new Set(
      this.hasTable("tasks")
        ? this.sql
            .exec<{ conversation_id: number }>(
              `SELECT DISTINCT conversation_id FROM tasks WHERE status != 'terminal'`,
            )
            .toArray()
            .map((row) => row.conversation_id)
        : [],
    );
    const out: Array<{ conversationId: number; below: number }> = [];
    for (const { id } of conversations) {
      if (forked.has(id) || busy.has(id)) continue;
      const marker = this.sql
        .exec<{ head: number }>(
          `SELECT head FROM entries WHERE conversation_id = ? AND head IS NOT NULL ORDER BY id DESC LIMIT 1`,
          id,
        )
        .toArray()[0];
      if (!marker || !Number.isSafeInteger(marker.head)) continue;
      const below = marker.head - KEEP_BELOW_HEAD;
      const count = this.sql
        .exec<{ count: number }>(
          `SELECT COUNT(*) AS count FROM entries WHERE conversation_id = ? AND id < ?`,
          id,
          below,
        )
        .one().count;
      if (count >= MIN_ARCHIVE_ROWS) out.push({ conversationId: id, below });
    }
    return out;
  }

  /** The next object's range of `conversationId` below `below`, recorded as intent. */
  private nextRange(
    conversationId: number,
    below: number,
    prefix: string,
    now: number,
  ): ArchiveRow | null {
    const sizes = this.sql
      .exec<{ id: number; bytes: number }>(
        `SELECT id, length(record) AS bytes FROM entries
          WHERE conversation_id = ? AND id < ? ORDER BY id LIMIT ?`,
        conversationId,
        below,
        OBJECT_MAX_ROWS,
      )
      .toArray();
    if (sizes.length === 0) return null;
    let bytes = 0;
    let rows = 0;
    let lastId = sizes[0]!.id;
    for (const row of sizes) {
      if (rows > 0 && bytes + row.bytes > OBJECT_MAX_BYTES) break;
      bytes += row.bytes;
      rows += 1;
      lastId = row.id;
    }
    const firstId = sizes[0]!.id;
    const range: ArchiveRow = {
      first_id: firstId,
      last_id: lastId,
      conversation_id: conversationId,
      rows,
      bytes,
      r2_key: `${prefix}/pi-entries/${conversationId}/${pad(firstId)}-${pad(lastId)}.jsonl.gz`,
      state: "uploading",
      created_at: now,
    };
    this.sql.exec(
      `INSERT INTO pi_entry_archives
         (first_id, last_id, conversation_id, rows, bytes, r2_key, state, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'uploading', ?)
       ON CONFLICT(first_id) DO UPDATE SET last_id = excluded.last_id,
         rows = excluded.rows, bytes = excluded.bytes, r2_key = excluded.r2_key`,
      range.first_id,
      range.last_id,
      range.conversation_id,
      range.rows,
      range.bytes,
      range.r2_key,
      range.created_at,
    );
    return range;
  }

  /** Phase 2 and 3: write the object, then drop the rows with the commit. */
  private async upload(range: ArchiveRow): Promise<number> {
    const rows = this.sql
      .exec<EntryRow>(
        `SELECT id, conversation_id, head, commit_seq, record FROM entries
          WHERE conversation_id = ? AND id >= ? AND id <= ? ORDER BY id`,
        range.conversation_id,
        range.first_id,
        range.last_id,
      )
      .toArray();
    if (rows.length === 0) {
      // Already committed by a pass whose manifest update never landed.
      this.sql.exec(
        `UPDATE pi_entry_archives SET state = 'committed' WHERE first_id = ?`,
        range.first_id,
      );
      return 0;
    }
    let text = "";
    for (const row of rows) text += `${JSON.stringify(row)}\n`;
    const packed = await streamThrough(new TextEncoder().encode(text), new CompressionStream("gzip"));
    const sealer = this.sealer();
    const body = sealer ? sealer.sealBytes(packed) : packed;
    await withTimeout(
      this.bucket.put(range.r2_key, body, {
        customMetadata: { sealed: sealer ? "1" : "0", rows: String(rows.length) },
      }),
      R2_TIMEOUT_MS,
    );
    this.storage.transactionSync(() => {
      this.sql.exec(
        `DELETE FROM entries WHERE conversation_id = ? AND id >= ? AND id <= ?`,
        range.conversation_id,
        range.first_id,
        range.last_id,
      );
      this.sql.exec(
        `UPDATE pi_entry_archives SET state = 'committed', rows = ? WHERE first_id = ?`,
        rows.length,
        range.first_id,
      );
    });
    this.log("info", "pi_entries_archived", {
      piConversationId: range.conversation_id,
      firstId: range.first_id,
      lastId: range.last_id,
      rows: rows.length,
      bytes: range.bytes,
      objectBytes: body.byteLength,
    });
    return rows.length;
  }

  /** Whether `conversationId` has archived entries below `beforeId` (any, if omitted). */
  hasArchived(conversationId: number, beforeId?: number): boolean {
    if (!this.hasTable("pi_entry_archives")) return false;
    return (
      this.sql
        .exec<{ count: number }>(
          `SELECT COUNT(*) AS count FROM pi_entry_archives
            WHERE conversation_id = ? AND state = 'committed' AND first_id < ?`,
          conversationId,
          beforeId ?? Number.MAX_SAFE_INTEGER,
        )
        .one().count > 0
    );
  }

  /**
   * Archived entries of `conversationId`, oldest first: all of them, or the
   * newest `limit` below `beforeId`. `hasOlder` says whether more lie below.
   */
  async read(
    conversationId: number,
    options: { beforeId?: number; limit?: number } = {},
  ): Promise<{ entries: ArchivedPiEntry[]; hasOlder: boolean }> {
    if (!this.hasTable("pi_entry_archives")) return { entries: [], hasOlder: false };
    const before = options.beforeId ?? Number.MAX_SAFE_INTEGER;
    const objects = this.sql
      .exec<ArchiveRow>(
        `SELECT * FROM pi_entry_archives
          WHERE conversation_id = ? AND state = 'committed' AND first_id < ?
          ORDER BY first_id DESC`,
        conversationId,
        before,
      )
      .toArray();
    const limit = options.limit ?? Number.MAX_SAFE_INTEGER;
    const collected: ArchivedPiEntry[][] = [];
    let count = 0;
    let index = 0;
    for (; index < objects.length && count < limit; index += 1) {
      const rows = (await this.readObject(objects[index]!)).filter((row) => row.id < before);
      collected.unshift(rows);
      count += rows.length;
    }
    let entries = collected.flat();
    let hasOlder = index < objects.length;
    if (entries.length > limit) {
      entries = entries.slice(entries.length - limit);
      hasOlder = true;
    }
    return { entries, hasOlder };
  }

  private async readObject(object: ArchiveRow): Promise<ArchivedPiEntry[]> {
    const stored = await withTimeout(this.bucket.get(object.r2_key), R2_TIMEOUT_MS);
    if (!stored) {
      this.log("error", "pi_entries_archive_missing", { r2Key: object.r2_key });
      return [];
    }
    let bytes: Uint8Array = new Uint8Array(await stored.arrayBuffer());
    if (stored.customMetadata?.sealed === "1") {
      const sealer = this.sealer();
      if (!sealer) throw new Error("Journal encryption key unavailable.");
      bytes = sealer.openBytes(bytes);
    }
    const text = Buffer.from(
      await streamThrough(bytes, new DecompressionStream("gzip")),
    ).toString("utf8");
    const out: ArchivedPiEntry[] = [];
    for (const line of text.split("\n")) {
      if (!line) continue;
      try {
        const row = JSON.parse(line) as EntryRow;
        out.push({ id: row.id, record: JSON.parse(row.record) });
      } catch {
        // A corrupt line costs that entry, not the read.
      }
    }
    return out;
  }
}
