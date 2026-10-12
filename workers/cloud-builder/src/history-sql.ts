/**
 * `history.sql(query, params)` in the orchestrator's code tool: one read-only
 * statement over this conversation's Durable Object SQLite (`journal`,
 * `journal_fts`, `turns`, ...). Payloads are encrypted at rest, so
 * `payload_json` and the `journal_fts` text column hold ciphertext and
 * hashed tokens here; `history.search` and `history.read` (on the journal)
 * are the readable paths. `history.search` lives on `Journal` for the same
 * reason: only it holds the conversation's key.
 *
 * Two independent guards. The text must be a single SELECT/WITH statement
 * with no write or schema keyword outside literals and comments, and it runs
 * inside a transaction that is rolled back if the cursor reports a written
 * row. Rows stop at the code sandbox's own value cap rather than being
 * materialized and rejected afterwards.
 */

import { CLOUD_CODE_WORKER_VALUE_MAX_BYTES } from "./cloud-code-worker-executor.js";
import { utf8Length } from "./conversation-types.js";
import { readOnlyHistoryQuery } from "@stella/contracts/history-search";

export { historySearchOptions } from "@stella/contracts/history-search";

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
