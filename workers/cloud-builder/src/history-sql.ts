import { CLOUD_CODE_WORKER_VALUE_MAX_BYTES } from "./cloud-code-worker-executor.js";
import { utf8Length } from "./conversation-types.js";
import { readOnlyHistoryQuery } from "@stella/contracts/history-search";

export { historySearchOptions } from "@stella/contracts/history-search";

export const HISTORY_SQL_MAX_BYTES = 2 * 1024 * 1024;

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
