/**
 * Full-text index for a transcript stored in the same Durable Object SQLite.
 *
 * The FTS rowid is the transcript's own sequence number, so a MATCH joins
 * straight back to canonical rows, and deleting resident journal rows during
 * rollover does not disturb the index. The orchestrator queries it through
 * `history.search` and `history.sql` in its code tool.
 *
 * What it holds: what the user and Stella said, and the hidden prompts that
 * carry another agent's words to Stella (an agent's report, an agent's
 * message). Its `role` column names which. Tool calls, tool results, cards
 * and other hidden runtime context stay out.
 */

export const DEFAULT_TRANSCRIPT_SEARCH_TABLE = "journal_fts";

const INDEXED_TEXT_MAX_BYTES = 64 * 1024;

import { Buffer } from "node:buffer";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { historySearchKind } from "@stella/contracts/history-search";
import { PLAIN_BYTES_V1, SEALED_BYTES_V1 } from "./journal-crypto.js";

export type TranscriptSearchRow = Readonly<{
  seq: number;
  turnId: string;
  role: string;
  createdAt: number;
  hidden: boolean;
  spillKey: string | null;
  payload: unknown;
}>;

const tableIdentifier = (name: string): string => {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) {
    throw new Error(
      "Transcript search table names must be SQLite identifiers.",
    );
  }
  return name;
};

/**
 * `contentless`: the index keeps no copy of the text it indexed (only the
 * inverted index and the UNINDEXED columns), and rows are deleted by rowid.
 * The readable text then lives only in `<table>_text`. A contentful table
 * stores the indexed text a second time; under encryption that copy is the
 * keyed hash of every word (~25 bytes a word), several times the text.
 */
export const transcriptSearchDdl = (
  tableName = DEFAULT_TRANSCRIPT_SEARCH_TABLE,
  options: { contentless?: boolean } = {},
): string => {
  const table = tableIdentifier(tableName);
  return `CREATE VIRTUAL TABLE IF NOT EXISTS ${table} USING fts5(
    text,
    turn_id UNINDEXED,
    role UNINDEXED,
    created_at UNINDEXED,
    ${options.contentless ? "content = '', contentless_delete = 1, contentless_unindexed = 1," : ""}
    tokenize = 'porter unicode61'
  )`;
};

/** Whether `tableName` exists as a contentless index (`transcriptSearchDdl`). */
export const isContentlessSearchTable = (
  sql: SqlStorage,
  tableName = DEFAULT_TRANSCRIPT_SEARCH_TABLE,
): boolean => {
  const row = sql
    .exec<{ sql: string | null }>(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?`,
      tableIdentifier(tableName),
    )
    .toArray()[0];
  return /contentless_delete\s*=\s*1/u.test(row?.sql ?? "");
};

/** What seals a side text: the conversation's key, or none (kept compressed only). */
export type SideTextSealer = {
  sealBytes(plain: Uint8Array): Uint8Array;
  openBytes(sealed: Uint8Array): Uint8Array;
} | null;

/**
 * A snippet's source text as stored in `<table>_text`: deflated, then sealed
 * under the conversation's key when it has one, as a BLOB. First byte 0x01 is
 * sealed, 0x00 plain. A TEXT value is the older form (`enc1.` ciphertext or
 * plaintext) and still reads.
 */
export const sealSideText = (sealer: SideTextSealer, text: string): Uint8Array => {
  const packed = deflateRawSync(Buffer.from(text, "utf8"));
  if (sealer) return sealer.sealBytes(packed);
  const plain = new Uint8Array(packed.byteLength + 1);
  plain[0] = PLAIN_BYTES_V1;
  plain.set(packed, 1);
  return plain;
};

export const openSideText = (
  sealer: SideTextSealer,
  stored: SqlStorageValue,
  legacy: (text: string) => string,
): string => {
  if (typeof stored === "string") return legacy(stored);
  if (!(stored instanceof ArrayBuffer)) return "";
  const bytes = new Uint8Array(stored);
  if (bytes[0] === SEALED_BYTES_V1) {
    if (!sealer) throw new Error("Journal encryption key unavailable.");
    return new TextDecoder().decode(inflateRawSync(sealer.openBytes(bytes)));
  }
  if (bytes[0] === PLAIN_BYTES_V1) return new TextDecoder().decode(inflateRawSync(bytes.subarray(1)));
  return "";
};

/** Text-only projection of an AgentMessage. Binary blocks and calls are noise. */
export const extractMessageText = (message: unknown): string => {
  if (!message || typeof message !== "object") return "";
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    const record = item as {
      type?: unknown;
      text?: unknown;
      content?: unknown;
    };
    if (record.type === "toolCall") continue;
    if (typeof record.text === "string") parts.push(record.text);
    else if (typeof record.content === "string") parts.push(record.content);
  }
  return parts.join("\n");
};

export const collapseWhitespace = (value: string): string =>
  value.replace(/\s+/gu, " ").trim();

const capUtf8 = (value: string, maxBytes: number): string => {
  const encoded = new TextEncoder().encode(value);
  if (encoded.byteLength <= maxBytes) return value;
  return new TextDecoder()
    .decode(encoded.slice(0, maxBytes))
    .replace(/\uFFFD$/u, "");
};

/**
 * Privacy codec for an index whose owner encrypts at rest: the FTS table
 * then holds keyed hash tokens instead of words, and the readable text a
 * snippet is built from lives encrypted in `<table>_text`. Without a codec
 * the index keeps its original plaintext form.
 */
export type TranscriptSearchCodec = {
  indexedText: (text: string) => string;
  encryptSideText: (text: string) => string | null;
  /**
   * The side text as a compressed (and, with a key, sealed) BLOB
   * (`sealSideText`). A contentless index requires it: the side text is
   * then the only copy of what was indexed.
   */
  sealSideText?: (text: string) => Uint8Array;
};

export const transcriptSearchTextDdl = (
  tableName = DEFAULT_TRANSCRIPT_SEARCH_TABLE,
): string =>
  `CREATE TABLE IF NOT EXISTS ${tableIdentifier(tableName)}_text (
     seq      INTEGER PRIMARY KEY,
     enc_text TEXT    NOT NULL
   )`;

export class TranscriptSearchIndex {
  private readonly table: string;

  constructor(
    private readonly sql: SqlStorage,
    tableName = DEFAULT_TRANSCRIPT_SEARCH_TABLE,
    private readonly codec: TranscriptSearchCodec | null = null,
  ) {
    this.table = tableIdentifier(tableName);
  }

  index(row: TranscriptSearchRow): void {
    this.remove(row.seq);
    const raw = extractMessageText(row.payload);
    const kind = historySearchKind(row.role, row.hidden, raw);
    if (!kind) return;
    const text = capUtf8(collapseWhitespace(raw), INDEXED_TEXT_MAX_BYTES);
    if (!text) return;
    this.sql.exec(
      `INSERT INTO ${this.table} (rowid, text, turn_id, role, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      row.seq,
      this.codec ? this.codec.indexedText(text) : text,
      row.turnId,
      kind,
      row.createdAt,
    );
    const encText = this.codec?.sealSideText
      ? this.codec.sealSideText(text)
      : this.codec?.encryptSideText(text);
    if (encText) {
      this.sql.exec(
        `INSERT INTO ${this.table}_text (seq, enc_text) VALUES (?, ?)
         ON CONFLICT(seq) DO UPDATE SET enc_text = excluded.enc_text`,
        row.seq,
        encText,
      );
    }
  }

  remove(seq: number): void {
    this.sql.exec(`DELETE FROM ${this.table} WHERE rowid = ?`, seq);
    if (this.codec) {
      this.sql.exec(`DELETE FROM ${this.table}_text WHERE seq = ?`, seq);
    }
  }

  count(): number {
    return this.sql
      .exec<{ count: number }>(`SELECT COUNT(*) AS count FROM ${this.table}`)
      .one().count;
  }
}
