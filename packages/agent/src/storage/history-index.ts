/**
 * One index file per thread, a rebuildable cache: each query first adds the thread's entries since the last one.
 * `history_terms` holds each record's search stems as one `ascii` token each, so a phrase query finds exactly the
 * records `searchHistoryRecords` would match, and `history_records` keeps the token counts its ranking needs.
 */
import { Database, type SQLQueryBindings } from "bun:sqlite";
import { mkdir, readdir, rm, stat, utimes } from "node:fs/promises";
import path from "node:path";
import type { ConversationId, EntryRecord } from "@earendil-works/pi-durable";
import {
  agentHistoryKind,
  answerOwnHistoryWith,
  historyMessageText,
  historyQueryStatement,
  historyRecordTokens,
  historySearchPlan,
  OWN_READ_RECORDS_MAX,
  rankHistoryMatches,
  type HistoryRecord,
  type HistorySearchKind,
  type HistorySearchPlan,
  type OwnHistoryEngine,
  type OwnHistoryRow,
} from "@stella/contracts/history-search";
import { historyEntryEffect, type HistoryEntriesAfter, type OwnHistoryIndex } from "../stella/own-history.ts";

const FORMAT = 1;
const RESULT_MAX_BYTES = 1024 * 1024;
const UNUSED_FOR_MS = 30 * 24 * 60 * 60_000;
const SWEEP_EVERY_MS = 24 * 60 * 60_000;
/** Holds the place of a word that normalizes to nothing; no search stem can equal it. */
const EMPTY_STEM = "";

const SCHEMA = [
  `CREATE TABLE journal (
    seq INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    turn_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    role TEXT,
    hidden INTEGER NOT NULL DEFAULT 0,
    payload_json TEXT NOT NULL
  )`,
  `CREATE VIRTUAL TABLE journal_fts USING fts5(
    text, turn_id UNINDEXED, role UNINDEXED, created_at UNINDEXED, tokenize = 'porter unicode61'
  )`,
  "CREATE TABLE history_records (seq INTEGER PRIMARY KEY, kind TEXT NOT NULL, token_count INTEGER NOT NULL)",
  "CREATE VIRTUAL TABLE history_terms USING fts5(stems, tokenize = 'ascii', content = '', contentless_delete = 1)",
  "CREATE TABLE history_removed (seq INTEGER PRIMARY KEY)",
  "CREATE TABLE history_state (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), after INTEGER NOT NULL)",
  "INSERT INTO history_state (singleton, after) VALUES (1, 0)",
  `PRAGMA user_version = ${FORMAT}`,
];

const rebuildable = (error: unknown): boolean =>
  error instanceof Error && (error.name === "SQLiteError" || error.message.startsWith("history index format"));

const removeIndexFile = async (file: string): Promise<void> => {
  await Promise.all(["", "-wal", "-shm"].map((suffix) => rm(`${file}${suffix}`, { force: true })));
};

const openIndex = (file: string): Database => {
  const db = new Database(file, { create: true });
  try {
    db.run("PRAGMA busy_timeout = 5000");
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA synchronous = NORMAL");
    const version = (db.query("PRAGMA user_version").get() as { user_version: number }).user_version;
    if (version === FORMAT) return db;
    if (version !== 0) throw new Error(`history index format ${version}`);
    db.transaction(() => {
      for (const sql of SCHEMA) db.run(sql);
    })();
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
};

const indexedAfter = (db: Database): number =>
  (db.query("SELECT after FROM history_state WHERE singleton = 1").get() as { after: number }).after;

const addEntries = (db: Database, entries: readonly EntryRecord[]): void => {
  if (entries.length === 0) return;
  const isRemoved = db.query<{ seq: number }, [number]>("SELECT seq FROM history_removed WHERE seq = ?");
  const markRemoved = db.query("INSERT OR IGNORE INTO history_removed (seq) VALUES (?)");
  const drops = [
    db.query("DELETE FROM journal WHERE seq = ?"),
    db.query("DELETE FROM journal_fts WHERE rowid = ?"),
    db.query("DELETE FROM history_records WHERE seq = ?"),
    db.query("DELETE FROM history_terms WHERE rowid = ?"),
  ];
  const insertRow = db.query(
    "INSERT OR REPLACE INTO journal (seq, kind, turn_id, created_at, role, payload_json) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const insertText = db.query(
    "INSERT INTO journal_fts (rowid, text, turn_id, role, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  const insertRecord = db.query("INSERT OR REPLACE INTO history_records (seq, kind, token_count) VALUES (?, ?, ?)");
  const insertStems = db.query("INSERT INTO history_terms (rowid, stems) VALUES (?, ?)");
  const setAfter = db.query("UPDATE history_state SET after = ? WHERE singleton = 1");
  const addRow = (row: OwnHistoryRow) => {
    if (isRemoved.get(row.seq)) return;
    insertRow.run(row.seq, row.kind, row.turnId, row.createdAtMs, row.role, JSON.stringify(row.payload));
    if (row.role === "toolResult") return;
    const text = historyMessageText(row.payload).replace(/\s+/gu, " ").trim();
    const kind = agentHistoryKind(row.role, text);
    if (!kind || !text) return;
    insertText.run(row.seq, text, row.turnId, kind, row.createdAtMs);
    const { tokens } = historyRecordTokens(text);
    insertRecord.run(row.seq, kind, tokens.length);
    insertStems.run(row.seq, tokens.map((token) => token || EMPTY_STEM).join(" "));
  };
  db.transaction(() => {
    for (const entry of entries) {
      const effect = historyEntryEffect(entry);
      for (const target of effect.removes ?? []) {
        markRemoved.run(target);
        for (const drop of drops) drop.run(target);
      }
      if (effect.row) addRow(effect.row);
    }
    setAfter.run(Number(entries[entries.length - 1]!.id));
  })();
};

/** Brings the index up to the thread's last entry: the entries after its mark, or all of them when the mark no longer matches. */
const catchUp = async (file: string, entriesAfter: HistoryEntriesAfter): Promise<Database> => {
  let db = openIndex(file);
  try {
    let after = indexedAfter(db);
    let page = await entriesAfter(after > 0 ? after - 1 : 0);
    if (after > 0 && Number(page.entries[0]?.id) !== after) {
      db.close();
      await removeIndexFile(file);
      db = openIndex(file);
      after = 0;
      page = await entriesAfter(0);
    }
    for (;;) {
      const fresh = page.entries.filter((entry) => Number(entry.id) > after);
      addEntries(db, fresh);
      if (fresh.length > 0) after = Number(fresh[fresh.length - 1]!.id);
      if (page.done) return db;
      page = await entriesAfter(after);
    }
  } catch (error) {
    db.close();
    throw error;
  }
};

const kindFilter = (plan: HistorySearchPlan): { sql: string; params: SQLQueryBindings[] } => {
  const clauses: string[] = [];
  const params: SQLQueryBindings[] = [];
  if (plan.kinds.size > 0) {
    clauses.push(`r.kind IN (${[...plan.kinds].map(() => "?").join(", ")})`);
    params.push(...plan.kinds);
  }
  if (plan.beforeSeq !== undefined) {
    clauses.push("r.seq < ?");
    params.push(plan.beforeSeq);
  }
  return { sql: clauses.length > 0 ? ` AND ${clauses.join(" AND ")}` : "", params };
};

const indexEngine = (db: Database): OwnHistoryEngine => ({
  search: (text, options) => {
    const plan = historySearchPlan(text, options);
    const filter = kindFilter(plan);
    const corpus = db
      .query(`SELECT COUNT(*) AS documents, COALESCE(SUM(r.token_count), 0) AS tokens FROM history_records r WHERE 1${filter.sql}`)
      .get(...filter.params) as { documents: number; tokens: number };
    const phrases = plan.terms.map((phrase) => `"${phrase.join(" ")}"`).join(" AND ");
    const found = db
      .query(
        `SELECT r.seq AS seq, r.kind AS kind, f.text AS text, f.turn_id AS turnId, f.created_at AS createdAtMs
         FROM history_terms t
         JOIN history_records r ON r.seq = t.rowid
         JOIN journal_fts f ON f.rowid = t.rowid
         WHERE history_terms MATCH ?${filter.sql}
         ORDER BY r.seq`,
      )
      .all(phrases, ...filter.params) as Array<{
      seq: number;
      kind: HistorySearchKind;
      text: string;
      turnId: string;
      createdAtMs: number;
    }>;
    const tokenized = found.map((record: HistoryRecord) => ({ record, ...historyRecordTokens(record.text) }));
    return rankHistoryMatches(plan, tokenized, corpus);
  },
  read: (fromSeq, toSeq) => {
    const rows = db
      .query(
        `SELECT seq, kind, turn_id, created_at, role, payload_json FROM journal
         WHERE seq >= ? AND seq <= ? ORDER BY seq LIMIT ?`,
      )
      .all(fromSeq, toSeq, OWN_READ_RECORDS_MAX + 1) as Array<{
      seq: number;
      kind: "message";
      turn_id: string;
      created_at: number;
      role: OwnHistoryRow["role"];
      payload_json: string;
    }>;
    const records: OwnHistoryRow[] = rows.slice(0, OWN_READ_RECORDS_MAX).map((row) => ({
      seq: row.seq,
      kind: row.kind,
      turnId: row.turn_id,
      createdAtMs: row.created_at,
      role: row.role,
      payload: JSON.parse(row.payload_json) as unknown,
    }));
    return { records, complete: rows.length <= OWN_READ_RECORDS_MAX };
  },
  sql: (query, params) => {
    const statement = historyQueryStatement(query);
    db.run("PRAGMA query_only = ON");
    let result: Record<string, unknown>[];
    try {
      const prepared = db.prepare(statement);
      try {
        result = prepared.all(...(params as SQLQueryBindings[])) as Record<string, unknown>[];
      } finally {
        prepared.finalize();
      }
    } finally {
      db.run("PRAGMA query_only = OFF");
    }
    const size = new TextEncoder().encode(JSON.stringify(result)).byteLength;
    if (size > RESULT_MAX_BYTES) {
      throw new Error(`history.sql result exceeds ${RESULT_MAX_BYTES} bytes; add a LIMIT or select fewer columns.`);
    }
    return result;
  },
});

export type HistoryIndexes = {
  /** The index of the threads stored in one conversation store, named by that store's file name. */
  forStore(storeFile: string): OwnHistoryIndex;
};

export const historyIndexes = (directory: string): HistoryIndexes => {
  const queues = new Map<string, Promise<unknown>>();
  let sweptAt = 0;

  const sweep = async () => {
    const now = Date.now();
    if (now - sweptAt < SWEEP_EVERY_MS) return;
    sweptAt = now;
    for (const name of await readdir(directory).catch(() => [] as string[])) {
      if (!name.endsWith(".sqlite")) continue;
      const file = path.join(directory, name);
      if (queues.has(file)) continue;
      const info = await stat(file).catch(() => undefined);
      if (info && now - info.mtimeMs > UNUSED_FOR_MS) await removeIndexFile(file);
    }
  };

  const answer = async (file: string, entriesAfter: HistoryEntriesAfter, args: Record<string, unknown>) => {
    await mkdir(directory, { recursive: true });
    let db: Database;
    try {
      db = await catchUp(file, entriesAfter);
    } catch (error) {
      if (!rebuildable(error)) throw error;
      await removeIndexFile(file);
      db = await catchUp(file, entriesAfter);
    }
    try {
      return answerOwnHistoryWith(indexEngine(db), args);
    } finally {
      db.close();
      const now = new Date();
      await utimes(file, now, now).catch(() => undefined);
    }
  };

  const queued = (file: string, run: () => Promise<unknown>): Promise<unknown> => {
    const previous = queues.get(file) ?? Promise.resolve();
    const next = previous.then(run, run);
    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    queues.set(file, settled);
    void settled.then(() => {
      if (queues.get(file) === settled) queues.delete(file);
    });
    return next;
  };

  return {
    forStore: (storeFile) => {
      const stem = storeFile.replace(/\.sqlite$/u, "");
      return (conversationId: ConversationId, entriesAfter, args) => {
        const file = path.join(directory, `${stem}.${Number(conversationId)}.sqlite`);
        const result = queued(file, () => answer(file, entriesAfter, args));
        void sweep().catch(() => undefined);
        return result;
      };
    },
  };
};
