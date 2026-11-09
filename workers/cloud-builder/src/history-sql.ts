import { CLOUD_CODE_WORKER_VALUE_MAX_BYTES } from "./cloud-code-worker-executor.js";
import { utf8Length } from "./conversation-types.js";
import { historyQueryStatement } from "@stella/contracts/history-search";

export { historySearchOptions } from "@stella/contracts/history-search";

export const HISTORY_SQL_MAX_BYTES = 2 * 1024 * 1024;

const schemaFingerprint = (storage: DurableObjectStorage): string =>
  String(
    storage.sql
      .exec<{ schema: string | null }>(
        "SELECT group_concat(type || ':' || name || ':' || ifnull(sql, ''), char(10)) AS schema FROM sqlite_master",
      )
      .one().schema ?? "",
  );

export type HistorySpan = { fromSeq: number; toSeq: number };

class QueryAnswered extends Error {
  constructor(readonly rows: Record<string, SqlStorageValue>[]) {
    super("history.sql answered");
  }
}

/**
 * Runs the query as if the messages in `without` were not stored: they are
 * deleted inside the transaction and the transaction is then rolled back, so
 * no shape of SELECT can reach them and nothing is lost.
 */
export const runHistoryQueryWithout = (
  storage: DurableObjectStorage,
  without: readonly HistorySpan[],
  query: string,
  params: readonly SqlStorageValue[],
  maxBytes = CLOUD_CODE_WORKER_VALUE_MAX_BYTES,
): Record<string, SqlStorageValue>[] => {
  if (without.length === 0) return runHistoryQuery(storage, query, params, maxBytes);
  try {
    storage.transactionSync(() => {
      for (const span of without) {
        storage.sql.exec(
          `DELETE FROM journal WHERE kind = 'message' AND seq >= ? AND seq <= ?`,
          span.fromSeq,
          span.toSeq,
        );
      }
      throw new QueryAnswered(selectRows(storage, query, params, maxBytes));
    });
  } catch (error) {
    if (error instanceof QueryAnswered) return error.rows;
    throw error;
  }
  throw new Error("history.sql did not run.");
};

export const runHistoryQuery = (
  storage: DurableObjectStorage,
  query: string,
  params: readonly SqlStorageValue[],
  maxBytes = CLOUD_CODE_WORKER_VALUE_MAX_BYTES,
): Record<string, SqlStorageValue>[] =>
  storage.transactionSync(() => selectRows(storage, query, params, maxBytes));

/** Must run inside a transaction: a statement that writes throws, which rolls it back. */
const selectRows = (
  storage: DurableObjectStorage,
  query: string,
  params: readonly SqlStorageValue[],
  maxBytes: number,
): Record<string, SqlStorageValue>[] => {
  const statement = historyQueryStatement(query);
  const schemaBefore = schemaFingerprint(storage);
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
  if (cursor.rowsWritten > 0 || schemaFingerprint(storage) !== schemaBefore) {
    throw new Error("history.sql is read-only.");
  }
  return rows;
};
