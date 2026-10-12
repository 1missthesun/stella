/**
 * SQLite FTS5 message index left on devices by the removed mobile recall
 * search. Nothing reads it; account cleanup still wipes and rebuilds it so a
 * signed-out account's rows never survive on disk.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type * as SQLite from "expo-sqlite";
import type { ChatMessage } from "../types";
import {
  CHAT_TRANSCRIPT_MAX_LOADED,
  loadNewerChatMessages,
  loadOldestChatMessages,
} from "./offline-chat-storage";
import {
  finalizeAccountChatCleanup,
  loadAccountChatCleanupIntent,
  loadAccountChatCleanupProgress,
  markAccountChatIndexCleared,
} from "./chat-account-cleanup-state";

const DB_NAME = "stella-chat-index.db";

const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY NOT NULL,
  role TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER
);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  text,
  content='messages',
  content_rowid='rowid',
  tokenize='porter unicode61 remove_diacritics 2'
);

-- Keep the FTS index in sync with the content table (the canonical FTS5
-- external-content trigger pattern).
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text);
END;
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text) VALUES('delete', old.rowid, old.text);
END;
CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text) VALUES('delete', old.rowid, old.text);
  INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text);
END;

CREATE TABLE IF NOT EXISTS index_meta (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
`;
const TRANSCRIPT_BACKFILL_KEY = "canonical-transcript-backfill-v1";
const REBUILD_REQUIRED_KEY = "stella-mobile-chat-index-rebuild-required-v1";

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function openDb(): Promise<SQLite.SQLiteDatabase> {
  const SQLite = await import("expo-sqlite");
  const db = await SQLite.openDatabaseAsync(DB_NAME);
  await db.execAsync(SCHEMA_SQL);
  const tokenizer = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM index_meta WHERE key = 'recall-tokenizer'",
  );
  if (tokenizer?.value !== "porter-v1") {
    await db.withTransactionAsync(async () => {
      await db.execAsync(`DROP TABLE messages_fts;
        CREATE VIRTUAL TABLE messages_fts USING fts5(text, content='messages', content_rowid='rowid', tokenize='porter unicode61 remove_diacritics 2');
        INSERT INTO messages_fts(messages_fts) VALUES('rebuild');
        INSERT OR REPLACE INTO index_meta(key, value) VALUES('recall-tokenizer', 'porter-v1');`);
    });
  }
  return db;
}

function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = openDb().catch((error) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

/**
 * Serialize DB writes. The mount-time backfill and the debounced mirror both
 * open `withTransactionAsync` on the shared connection near mount; expo-sqlite
 * does not queue transactions, so two overlapping BEGINs would throw. Chaining
 * every write through a single promise guarantees one transaction runs at a
 * time. The chain is kept alive across individual failures.
 */
let writeQueue: Promise<unknown> = Promise.resolve();

function enqueueWrite<T>(work: () => Promise<T>): Promise<T> {
  const run = writeQueue.then(work, work);
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

let backfilled = false;
let backfillGeneration = 0;
let rebuildPhase: "idle" | "intent" | "rebuilding" | "failed" = "idle";
let rebuildPromise: Promise<void> | null = null;
let rebuildMarkerQueue: Promise<unknown> = Promise.resolve();
let rebuildIntentSequence = 0;

function enqueueRebuildMarkerOperation<T>(work: () => Promise<T>): Promise<T> {
  const run = rebuildMarkerQueue.then(work, work);
  rebuildMarkerQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function readRebuildIntent(): Promise<string | null> {
  return enqueueRebuildMarkerOperation(() =>
    AsyncStorage.getItem(REBUILD_REQUIRED_KEY),
  );
}

function persistRebuildIntent(): Promise<string> {
  const token = `${Date.now()}-${++rebuildIntentSequence}`;
  return enqueueRebuildMarkerOperation(async () => {
    await AsyncStorage.setItem(REBUILD_REQUIRED_KEY, token);
    return token;
  });
}

function clearRebuildIntent(expectedToken: string): Promise<boolean> {
  return enqueueRebuildMarkerOperation(async () => {
    if ((await AsyncStorage.getItem(REBUILD_REQUIRED_KEY)) !== expectedToken) {
      return false;
    }
    await AsyncStorage.removeItem(REBUILD_REQUIRED_KEY);
    return true;
  });
}

const deleteIndexContents = async (
  db: SQLite.SQLiteDatabase,
): Promise<void> => {
  await enqueueWrite(() =>
    db.execAsync("DELETE FROM messages; DELETE FROM index_meta;"),
  );
};

async function recoverAccountCleanupIndex(
  db: SQLite.SQLiteDatabase,
): Promise<void> {
  const token = await loadAccountChatCleanupIntent();
  if (!token) return;
  rebuildPhase = "rebuilding";
  backfilled = false;
  const progress = await loadAccountChatCleanupProgress(token);
  try {
    let cleanupRebuildIntent: string | null = null;
    if (!progress.indexCleared) {
      // Keep recall blocked across a kill before the cross-store owner can
      // record this store's completion.
      cleanupRebuildIntent = await persistRebuildIntent();
      await deleteIndexContents(db);
      await markAccountChatIndexCleared(token);
    }
    const current = await loadAccountChatCleanupProgress(token);
    if (!current.canonicalCleared) {
      throw new Error("Canonical chat account cleanup is still pending");
    }
    if (cleanupRebuildIntent) {
      await clearRebuildIntent(cleanupRebuildIntent);
    }
    if (!(await finalizeAccountChatCleanup(token))) {
      throw new Error("Chat account cleanup did not finalize");
    }
    rebuildPhase = "idle";
  } catch (error) {
    rebuildPhase = "failed";
    throw error;
  }
}

/**
 * Upsert messages into the index. Only rows whose text/role actually changed
 * touch the FTS index (the conflict WHERE guard skips no-op rewrites, so
 * streaming the same reply many times doesn't re-index on every chunk).
 */
async function indexMessageRows(messages: ChatMessage[]): Promise<void> {
  const rows = messages.filter(
    (message) =>
      typeof message.text === "string" && message.text.trim().length > 0,
  );
  if (rows.length === 0) return;
  const generation = backfillGeneration;
  const db = await getDb();
  if (generation !== backfillGeneration) return;
  await enqueueWrite(() =>
    db.withTransactionAsync(async () => {
      if (generation !== backfillGeneration) return;
      for (const message of rows) {
        const canonicalId = message.canonicalId?.trim();
        if (canonicalId && canonicalId !== message.id) {
          // Canonical transcript persistence replaces a separately loaded
          // desktop twin with the stable local bubble. Mirror that identity
          // collapse here or recall would retain the removed twin forever.
          await db.runAsync("DELETE FROM messages WHERE id = ?", canonicalId);
        }
        await db.runAsync(
          `INSERT INTO messages(id, role, text, created_at) VALUES(?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             role = excluded.role,
             text = excluded.text,
             created_at = excluded.created_at
           WHERE messages.text <> excluded.text
              OR messages.role <> excluded.role`,
          message.id,
          message.role,
          message.text.trim(),
          typeof message.createdAt === "number" ? message.createdAt : null,
        );
      }
    }),
  );
}

/**
 * Open the DB and backfill canonical history oldest-first in bounded pages.
 * The durable completion marker is written only after the final page; a kill
 * mid-scan retries harmlessly through idempotent upserts on the next mount.
 */
async function initializeMessageIndex(): Promise<void> {
  const db = await getDb();
  await recoverAccountCleanupIndex(db);
  if (backfilled) return;
  backfilled = true;
  const generation = backfillGeneration;
  let recoveringDurableRebuild = false;
  let durableRebuildIntent: string | null = null;
  try {
    durableRebuildIntent = await readRebuildIntent();
    if (durableRebuildIntent) {
      recoveringDurableRebuild = true;
      rebuildPhase = "rebuilding";
      await deleteIndexContents(db);
      if (generation !== backfillGeneration) return;
    }
    const marker = await db.getFirstAsync<{ value: string }>(
      "SELECT value FROM index_meta WHERE key = ?",
      TRANSCRIPT_BACKFILL_KEY,
    );
    if (marker?.value === "done") return;
    let page = await loadOldestChatMessages(
      "cloud",
      CHAT_TRANSCRIPT_MAX_LOADED,
    );
    while (true) {
      if (generation !== backfillGeneration) return;
      if (page.messages.length > 0) {
        await indexMessageRows(page.messages);
      }
      if (generation !== backfillGeneration) return;
      if (!page.hasNewer || !page.newestCursor) break;
      page = await loadNewerChatMessages(
        "cloud",
        page.newestCursor,
        CHAT_TRANSCRIPT_MAX_LOADED,
      );
    }
    if (generation !== backfillGeneration) return;
    const completionCommitted = await enqueueWrite(async () => {
      if (generation !== backfillGeneration) return false;
      await db.runAsync(
        `INSERT INTO index_meta(key, value) VALUES(?, 'done')
         ON CONFLICT(key) DO UPDATE SET value = 'done'`,
        TRANSCRIPT_BACKFILL_KEY,
      );
      return true;
    });
    if (!completionCommitted || generation !== backfillGeneration) return;
    if (durableRebuildIntent) {
      await clearRebuildIntent(durableRebuildIntent);
    }
    if (generation !== backfillGeneration) return;
    if (recoveringDurableRebuild && generation === backfillGeneration) {
      rebuildPhase = "idle";
    }
  } catch (error) {
    // Leave the durable marker absent and the in-process latch open so a later
    // persistence retry or mount can complete the canonical backfill.
    if (generation === backfillGeneration) backfilled = false;
    if (recoveringDurableRebuild && generation === backfillGeneration) {
      rebuildPhase = "failed";
    }
    throw error;
  }
}

/** Idempotent variant owned only by durable cross-store account recovery. */
export async function ensureMessageIndexRebuildIntent(): Promise<void> {
  if (rebuildPhase === "intent") return;
  backfillGeneration += 1;
  backfilled = false;
  rebuildPhase = "intent";
  try {
    await persistRebuildIntent();
  } catch (error) {
    rebuildPhase = "failed";
    throw error;
  }
  await getDb()
    .then(deleteIndexContents)
    .catch(() => {});
}

/** Unblock and rebuild the derived index from the canonical transcript. */
export function rebuildMessageIndex(): Promise<void> {
  if (rebuildPromise) return rebuildPromise;
  rebuildPhase = "rebuilding";
  backfilled = false;
  const generation = backfillGeneration;
  const run = (async () => {
    try {
      await initializeMessageIndex();
      if (generation === backfillGeneration) {
        rebuildPhase = "idle";
      }
    } catch (error) {
      if (generation === backfillGeneration) {
        rebuildPhase = "failed";
      }
      throw error;
    }
  })().finally(() => {
    if (rebuildPromise === run) rebuildPromise = null;
  });
  rebuildPromise = run;
  return run;
}

/** Test/account-maintenance helper: wipe index rows and rebuild metadata. */
export async function clearMessageIndex(): Promise<void> {
  if (rebuildPromise) await rebuildPromise.catch(() => {});
  backfillGeneration += 1;
  backfilled = false;
  rebuildPhase = "rebuilding";
  const [markerResult, databaseResult] = await Promise.allSettled([
    persistRebuildIntent(),
    getDb().then(deleteIndexContents),
  ]);
  if (databaseResult.status === "fulfilled") {
    // Database deletion is authoritative for account-data cleanup. A failed
    // marker write cannot preserve stale recall rows once this has committed;
    // a failed marker removal merely causes a harmless empty rebuild later.
    if (markerResult.status === "fulfilled") {
      await clearRebuildIntent(markerResult.value).catch(() => {});
    }
    rebuildPhase = "idle";
    return;
  }
  // Keep recall blocked when stale account rows could still exist. A durable
  // marker (when available) makes the next process initialization retry.
  rebuildPhase = "failed";
  if (markerResult.status === "rejected") throw markerResult.reason;
  throw databaseResult.reason;
}
