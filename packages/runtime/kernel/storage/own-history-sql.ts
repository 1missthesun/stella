import { Database, type SQLQueryBindings } from "bun:sqlite";
import { agentHistoryKind, historyMessageText, readOnlyHistoryQuery } from "@stella/contracts/history-search";
import type { OwnHistorySql } from "@stella/contracts/history-search";

const RESULT_MAX_BYTES = 1024 * 1024;

export const ownHistorySql: OwnHistorySql = (rows, query, params) => {
  const statement = readOnlyHistoryQuery(query);
  const db = new Database(":memory:");
  try {
    db.run(`CREATE TABLE journal (
      seq INTEGER PRIMARY KEY,
      kind TEXT NOT NULL,
      turn_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      role TEXT,
      hidden INTEGER NOT NULL DEFAULT 0,
      payload_json TEXT NOT NULL
    )`);
    db.run(`CREATE VIRTUAL TABLE journal_fts USING fts5(
      text, turn_id UNINDEXED, role UNINDEXED, created_at UNINDEXED, tokenize = 'porter unicode61'
    )`);
    const insertRow = db.prepare(
      "INSERT INTO journal (seq, kind, turn_id, created_at, role, payload_json) VALUES (?, ?, ?, ?, ?, ?)",
    );
    const insertText = db.prepare("INSERT INTO journal_fts (rowid, text, turn_id, role, created_at) VALUES (?, ?, ?, ?, ?)");
    db.transaction(() => {
      for (const row of rows) {
        insertRow.run(row.seq, row.kind, row.turnId, row.createdAtMs, row.role, JSON.stringify(row.payload));
        if (row.role === "toolResult") continue;
        const text = historyMessageText(row.payload).replace(/\s+/gu, " ").trim();
        const kind = agentHistoryKind(row.role, text);
        if (kind && text) insertText.run(row.seq, text, row.turnId, kind, row.createdAtMs);
      }
    })();
    const result = db.prepare(statement).all(...(params as SQLQueryBindings[])) as Record<string, unknown>[];
    const size = new TextEncoder().encode(JSON.stringify(result)).byteLength;
    if (size > RESULT_MAX_BYTES) {
      throw new Error(`history.sql result exceeds ${RESULT_MAX_BYTES} bytes; add a LIMIT or select fewer columns.`);
    }
    return result;
  } finally {
    db.close();
  }
};
