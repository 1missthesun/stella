import type { SqliteDatabase } from "./shared.js";

export const SCHEMA_VERSION = 11;

export const CORE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS conversation (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'chat',
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  next_seq INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversation_kind_status_updated
  ON conversation(kind, status, updated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS entry (
  conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  id TEXT NOT NULL,
  type TEXT NOT NULL,
  role TEXT NOT NULL,
  visible INTEGER NOT NULL DEFAULT 0,
  turn_seq INTEGER,
  device_id TEXT,
  request_id TEXT,
  target_device_id TEXT,
  run_id TEXT,
  agent_type TEXT,
  payload TEXT,
  channel_envelope TEXT,
  search_text TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, seq)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_entry_id ON entry(id);
CREATE INDEX IF NOT EXISTS idx_entry_conv_visible_seq
  ON entry(conversation_id, seq) WHERE visible = 1;
CREATE INDEX IF NOT EXISTS idx_entry_conv_type_seq
  ON entry(conversation_id, type, seq);
CREATE INDEX IF NOT EXISTS idx_entry_conv_turn_seq
  ON entry(conversation_id, turn_seq, seq);
CREATE INDEX IF NOT EXISTS idx_entry_created ON entry(created_at);
CREATE INDEX IF NOT EXISTS idx_entry_run
  ON entry(run_id) WHERE run_id IS NOT NULL;
`;

export const ENTRY_REF_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS entry_ref (
  conversation_id TEXT NOT NULL REFERENCES conversation(id) ON DELETE CASCADE,
  entry_seq INTEGER NOT NULL,
  target_kind TEXT NOT NULL CHECK (target_kind IN ('message', 'agent')),
  target_key TEXT NOT NULL,
  PRIMARY KEY (conversation_id, entry_seq, target_kind, target_key)
);
CREATE INDEX IF NOT EXISTS idx_entry_ref_target
  ON entry_ref(conversation_id, target_kind, target_key, entry_seq);
`;

/**
 * Covering index over the rows that carry `search_text` (visible
 * user/assistant messages: ~12k of prod's ~1.9M `entry` rows). `payload`
 * precedes `search_text`/`created_at` in `entry`, so any filter on those
 * columns that reads the table walks multi-MB payload overflow chains; this
 * partial index lets message-history queries by conversation and time skip
 * the table row.
 *
 * Deliberately NOT part of the core schema or a migration: building it is
 * one full `entry` scan (~6 s warm, ~15-20 s cold on the 13 GiB prod file)
 * under the write lock, which must not run at open (Electron main migrates
 * synchronously). `maintenance.ts` builds it in the detached idle window.
 * Queries must never depend on it (no `INDEXED BY`): without it they return
 * the same rows, only slower.
 */
export const SEARCH_TEXT_INDEX_NAME = "idx_entry_search_conv_created";
export const SEARCH_TEXT_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_entry_search_conv_created
  ON entry(conversation_id, created_at, seq, role, id, search_text)
  WHERE search_text IS NOT NULL;
`;

export const CLOUD_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS cloud_transcript_outbox (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('begin', 'finish')),
  conversation_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  owner_generation TEXT NOT NULL,
  local_turn_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  recovery_json TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  dead_lettered_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cloud_transcript_outbox_turn_kind
  ON cloud_transcript_outbox(conversation_id, device_id, local_turn_id, kind);
CREATE INDEX IF NOT EXISTS idx_cloud_transcript_outbox_created
  ON cloud_transcript_outbox(created_at, id);
CREATE INDEX IF NOT EXISTS idx_cloud_transcript_outbox_delivery
  ON cloud_transcript_outbox(dead_lettered_at, attempts, updated_at, created_at, id);

CREATE TABLE IF NOT EXISTS cloud_journal_outbox (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  conversation_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  owner_generation TEXT NOT NULL,
  append_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  dead_lettered_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cloud_journal_outbox_delivery
  ON cloud_journal_outbox(dead_lettered_at, sequence);

CREATE TABLE IF NOT EXISTS computer_agent_cloud_outbox (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('start', 'terminal', 'cancel')),
  thread_id TEXT NOT NULL,
  attempt_generation INTEGER NOT NULL,
  owner_scope TEXT,
  owner_generation TEXT,
  payload_json TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_computer_agent_cloud_outbox_delivery
  ON computer_agent_cloud_outbox(next_attempt_at, sequence);
CREATE INDEX IF NOT EXISTS idx_computer_agent_cloud_outbox_owner_delivery
  ON computer_agent_cloud_outbox(owner_scope, next_attempt_at, sequence);

CREATE TABLE IF NOT EXISTS computer_agent_cloud_thread_owners (
  thread_id TEXT PRIMARY KEY,
  owner_scope TEXT NOT NULL,
  owner_generation TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_computer_agent_cloud_thread_owners_scope
  ON computer_agent_cloud_thread_owners(owner_scope, updated_at);

CREATE TABLE IF NOT EXISTS computer_agent_cloud_retired_generations (
  thread_id TEXT NOT NULL,
  owner_scope TEXT NOT NULL,
  owner_generation TEXT NOT NULL,
  retired_at INTEGER NOT NULL,
  PRIMARY KEY (thread_id, owner_scope, owner_generation)
);
CREATE INDEX IF NOT EXISTS idx_computer_agent_cloud_retired_scope
  ON computer_agent_cloud_retired_generations(owner_scope, retired_at);

CREATE TABLE IF NOT EXISTS cloud_journal_admission_receipts (
  id TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cloud_journal_admission_receipts_created
  ON cloud_journal_admission_receipts(created_at, id);
`;

const applyCloudColumnBackfills = (db: SqliteDatabase): void => {
  const addColumn = (table: string, column: string) => {
    const name = column.split(" ")[0];
    const columns = db.prepare(`SELECT name FROM pragma_table_info(?)`).all(table) as Array<{ name: string }>;
    if (columns.length === 0 || columns.some((existing) => existing.name === name)) return;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column};`);
  };
  addColumn("cloud_transcript_outbox", "owner_generation TEXT");
  addColumn("cloud_transcript_outbox", "recovery_json TEXT");
  addColumn("cloud_transcript_outbox", "last_error TEXT");
  addColumn("cloud_transcript_outbox", "dead_lettered_at INTEGER");
  addColumn("cloud_journal_outbox", "owner_generation TEXT");
  addColumn("computer_agent_cloud_outbox", "owner_scope TEXT");
  addColumn("computer_agent_cloud_outbox", "owner_generation TEXT");
  addColumn("computer_agent_cloud_thread_owners", "owner_generation TEXT");
};

export const CLAUDE_SESSION_SYNC_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS claude_session_sync_sessions (
  thread_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  engine TEXT NOT NULL,
  config_dir TEXT,
  cwd TEXT NOT NULL,
  owner_scope TEXT NOT NULL,
  journal_cursor TEXT,
  journal_seq INTEGER,
  lease_epoch INTEGER,
  state TEXT NOT NULL DEFAULT 'active',
  dirty INTEGER NOT NULL DEFAULT 1,
  tag_dirty INTEGER NOT NULL DEFAULT 1,
  resume_pending INTEGER NOT NULL DEFAULT 0,
  reply_hashes_json TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (thread_id, session_id)
);
CREATE INDEX IF NOT EXISTS idx_claude_session_sync_sessions_drain
  ON claude_session_sync_sessions(owner_scope, dirty, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_claude_session_sync_sessions_resume
  ON claude_session_sync_sessions(thread_id, resume_pending, updated_at);

CREATE TABLE IF NOT EXISTS claude_session_sync_files (
  thread_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  path TEXT NOT NULL,
  generation INTEGER NOT NULL,
  acked_length INTEGER NOT NULL,
  acked_chain TEXT NOT NULL,
  content_sha256 TEXT,
  pending_end INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (thread_id, session_id, path)
);
`;

const DROP_AGENT_LOOP_SEARCH_INDEXES = [
  "DROP TABLE IF EXISTS thread_fts;",
  "DROP TABLE IF EXISTS durable_thread_summaries_fts;",
];
const DROP_ENTRY_SEARCH_INDEX_SQL = `
DROP TRIGGER IF EXISTS trg_entry_fts_insert;
DROP TRIGGER IF EXISTS trg_entry_fts_delete;
DROP TRIGGER IF EXISTS trg_entry_fts_update;
DROP TABLE IF EXISTS entry_fts;
DELETE FROM meta WHERE key IN ('fts_ready', 'maintenance.fts_rebuild_pending');
`;
const DROP_AGENT_LOOP_TABLES_SQL = `
DROP TABLE IF EXISTS thread_context;
DROP TABLE IF EXISTS thread_entry;
DROP TABLE IF EXISTS thread;
DROP TABLE IF EXISTS blob;
DROP TABLE IF EXISTS agent;
DROP TABLE IF EXISTS durable_thread_summaries;
DROP TABLE IF EXISTS run_admission;
DROP TABLE IF EXISTS run_task;
DROP TABLE IF EXISTS tool_intent;
DROP TABLE IF EXISTS cloud_agent_thread_controls;
DROP TABLE IF EXISTS cloud_agent_tool_operations;
DROP TABLE IF EXISTS voice_tool_call_receipts;
DROP TABLE IF EXISTS voice_transcript_inbox;
DROP TABLE IF EXISTS legacy_chat_cloud_import;
`;

const readUserVersion = (db: SqliteDatabase): number => {
  const row = db.prepare("PRAGMA user_version;").get() as
    | { user_version?: number }
    | undefined;
  return typeof row?.user_version === "number" ? row.user_version : 0;
};

type Migration = {
  version: number;
  apply: (db: SqliteDatabase) => void;
};

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    apply: (db) => {
      db.exec(CORE_SCHEMA_SQL);
      applyCloudColumnBackfills(db);
      db.exec(CLOUD_SCHEMA_SQL);
    },
  },
  {
    version: 2,
    apply: (db) => {
      db.exec(ENTRY_REF_SCHEMA_SQL);
    },
  },
  {
    version: 8,
    apply: (db) => {
      db.exec(CLAUDE_SESSION_SYNC_SCHEMA_SQL);
    },
  },
  {
    version: 10,
    apply: (db) => {
      for (const statement of DROP_AGENT_LOOP_SEARCH_INDEXES) db.exec(statement);
      db.exec(DROP_AGENT_LOOP_TABLES_SQL);
    },
  },
  {
    version: 11,
    apply: (db) => {
      db.exec(DROP_ENTRY_SEARCH_INDEX_SQL);
    },
  },
];

export const applyConnectionPragmas = (db: SqliteDatabase): void => {
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA temp_store = MEMORY;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA foreign_keys = ON;");
};

const MIGRATION_LOCK_ATTEMPTS = 12;
const MIGRATION_LOCK_RETRY_MS = 5_000;

const sleepSync = (ms: number) => {
  const buffer = new SharedArrayBuffer(4);
  Atomics.wait(new Int32Array(buffer), 0, 0, ms);
};

export const migrateDesktopDatabase = (db: SqliteDatabase): void => {
  applyConnectionPragmas(db);
  if (readUserVersion(db) >= SCHEMA_VERSION) return;

  let locked = false;
  for (let attempt = 0; attempt < MIGRATION_LOCK_ATTEMPTS; attempt += 1) {
    try {
      db.exec("BEGIN EXCLUSIVE;");
      locked = true;
      break;
    } catch (error) {
      if (!/busy|locked/i.test(String(error))) throw error;
      sleepSync(MIGRATION_LOCK_RETRY_MS);
    }
  }
  if (!locked) {
    throw new Error(
      "Could not acquire the migration lock on the desktop database.",
    );
  }
  try {
    const version = readUserVersion(db);
    for (const migration of MIGRATIONS) {
      if (migration.version <= version) continue;
      migration.apply(db);
    }
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
    db.exec("COMMIT;");
  } catch (error) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      /* the transaction may already be gone */
    }
    throw error;
  }
};
