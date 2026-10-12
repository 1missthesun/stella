/**
 * `history.sql(query, params)` in the orchestrator's code tool: one read-only
 * statement over this conversation's Durable Object SQLite (`journal`,
 * `journal_fts`, `turns`, ...).
 *
 * Two independent guards. The text must be a single SELECT/WITH statement
 * with no write or schema keyword outside literals and comments, and it runs
 * inside a transaction that is rolled back if the cursor reports a written
 * row. Rows stop at the code sandbox's own value cap rather than being
 * materialized and rejected afterwards.
 */

import { CLOUD_CODE_WORKER_VALUE_MAX_BYTES } from "./cloud-code-worker-executor.js";
import { utf8Length } from "./conversation-types.js";
import { DEFAULT_TRANSCRIPT_SEARCH_TABLE } from "./transcript-search.js";
import {
  historySearchKinds,
  historySearchLimit,
  historySearchMatch,
  readOnlyHistoryQuery,
  type HistorySearchHit,
  type HistorySearchOptions,
} from "@stella/contracts/history-search";

export {
  historySearchMatch,
  historySearchOptions,
  readOnlyHistoryQuery,
  type HistorySearchHit,
  type HistorySearchOptions,
} from "@stella/contracts/history-search";

export const runHistoryQuery = (
  storage: DurableObjectStorage,
  query: string,
  params: readonly SqlStorageValue[],
  maxBytes = CLOUD_CODE_WORKER_VALUE_MAX_BYTES,
): Record<string, SqlStorageValue>[] => {
  const statement = readOnlyHistoryQuery(query);
  return storage.transactionSync(() => {
    const cursor = storage.sql.exec(statement, ...params);
    const rows: Record<string, SqlStorageValue>[] = [];
    let bytes = 0;
    for (const row of cursor) {
      for (const [column, value] of Object.entries(row)) {
        if (value instanceof ArrayBuffer) {
          row[column] = `[${value.byteLength}-byte blob]`;
        }
      }
      bytes += utf8Length(JSON.stringify(row));
      if (bytes > maxBytes) {
        throw new Error(
          `history.sql result exceeds ${maxBytes} bytes; add a LIMIT or select fewer columns.`,
        );
      }
      rows.push(row);
    }
    // Throwing inside transactionSync rolls the statement back.
    if (cursor.rowsWritten > 0) {
      throw new Error("history.sql is read-only.");
    }
    return rows;
  });
};

/**
 * `history.search(text, options)`: matches from `journal_fts`, newest or
 * best first, each with its seq, kind, time and a snippet. The index outlives
 * rollover, so archived rows match too; `archived` says `history.read` is the
 * way to their full record.
 */
export const searchHistory = (
  storage: DurableObjectStorage,
  text: string,
  options: HistorySearchOptions = {},
): HistorySearchHit[] => {
  const match = historySearchMatch(text);
  if (!match) throw new Error("history.search needs at least one word to look for.");
  const kinds = historySearchKinds(options);
  const limit = historySearchLimit(options);
  const table = DEFAULT_TRANSCRIPT_SEARCH_TABLE;
  const where = [`${table} MATCH ?`];
  const params: SqlStorageValue[] = [match];
  if (kinds.length > 0) {
    where.push(`role IN (${kinds.map(() => "?").join(", ")})`);
    params.push(...kinds);
  }
  if (Number.isSafeInteger(options.beforeSeq)) {
    where.push("rowid < ?");
    params.push(options.beforeSeq as number);
  }
  const floor =
    storage.sql
      .exec<{ hot_min_seq: number }>("SELECT hot_min_seq FROM meta WHERE id = 0")
      .toArray()[0]?.hot_min_seq ?? 0;
  const rows = storage.sql
    .exec<{
      seq: number;
      kind: string;
      turn_id: string;
      created_at: number;
      snippet: string;
    }>(
      `SELECT rowid AS seq, role AS kind, turn_id, created_at,
              snippet(${table}, 0, '[', ']', '…', 32) AS snippet
         FROM ${table}
        WHERE ${where.join(" AND ")}
        ORDER BY ${options.order === "newest" ? "rowid DESC" : "rank"}
        LIMIT ?`,
      ...params,
      limit,
    )
    .toArray();
  return rows.map((row) => ({
    seq: row.seq,
    kind: row.kind,
    at: new Date(Number(row.created_at)).toISOString(),
    turnId: row.turn_id,
    snippet: row.snippet,
    archived: row.seq < floor,
  }));
};
