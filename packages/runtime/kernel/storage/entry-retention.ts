import type { SqliteDatabase } from "./shared.js";

export const LEGACY_RUN_EVENT_ENTRY_TYPE = "run_event";
export const LEGACY_RUN_EVENT_SWEEP_BATCH = 5_000;

type Transaction = <T>(work: () => T) => T;

export type LegacyRunEventBatchResult = {
  deleted: number;
  resumeFrom: string | null;
};

const immediateTransaction =
  (db: SqliteDatabase): Transaction =>
  (work) => {
    db.exec("BEGIN IMMEDIATE;");
    try {
      const result = work();
      db.exec("COMMIT;");
      return result;
    } catch (error) {
      try {
        db.exec("ROLLBACK;");
      } catch {
        /* the transaction may already be gone */
      }
      throw error;
    }
  };

export const deleteLegacyRunEventBatch = (
  db: SqliteDatabase,
  options: {
    batchSize?: number;
    fromConversationId?: string | null;
    transaction?: Transaction;
  } = {},
): LegacyRunEventBatchResult => {
  const batchSize = Math.max(
    1,
    Math.floor(options.batchSize ?? LEGACY_RUN_EVENT_SWEEP_BATCH),
  );
  const transaction = options.transaction ?? immediateTransaction(db);
  return transaction(() => {
    const firstConversation = db.prepare(
      `SELECT conversation_id AS conversationId FROM entry
       ORDER BY conversation_id ASC LIMIT 1`,
    );
    const nextConversation = db.prepare(
      `SELECT conversation_id AS conversationId FROM entry
       WHERE conversation_id > ?
       ORDER BY conversation_id ASC LIMIT 1`,
    );
    const selectRows = db.prepare(
      `SELECT rowid AS id FROM entry
       WHERE conversation_id = ? AND type = ?
       LIMIT ?`,
    );
    const readConversation = (row: unknown): string | null => {
      const value = (row as { conversationId?: unknown } | undefined)
        ?.conversationId;
      return typeof value === "string" ? value : null;
    };

    let conversationId =
      typeof options.fromConversationId === "string"
        ? options.fromConversationId
        : readConversation(firstConversation.get());
    const rowIds: number[] = [];
    while (conversationId !== null) {
      const remaining = batchSize - rowIds.length;
      const rows = selectRows.all(
        conversationId,
        LEGACY_RUN_EVENT_ENTRY_TYPE,
        remaining,
      ) as Array<{ id: number }>;
      for (const row of rows) rowIds.push(row.id);
      if (rows.length === remaining) break;
      conversationId = readConversation(nextConversation.get(conversationId));
    }
    if (rowIds.length > 0) {
      db.prepare(
        "DELETE FROM entry WHERE rowid IN (SELECT value FROM json_each(?))",
      ).run(JSON.stringify(rowIds));
    }
    return { deleted: rowIds.length, resumeFrom: conversationId };
  });
};

