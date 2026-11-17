/**
 * The cloud's way back from the pi-durable 1.5 storage upgrade.
 *
 * pi keeps a conversation's runs in tables of the orchestrator's Durable Object, beside Stella's journal. pi-durable
 * 1.4 and later migrate those tables from schema version 1 (what 1.1.0 wrote) to 2 the first time they open them, and
 * 1.1.0 refuses version 2. Restoring the whole object to an earlier point would also undo the journal, so instead the
 * first open on this version copies pi's tables, as 1.1.0 left them, into tables of their own in the same object.
 *
 * `restorePiTables` puts the copies back for a build on 1.1.0 and moves pi's ID and commit counters past every one the
 * upgraded tables used, so nothing written afterwards reuses an entry ID that the journal already keys a message by.
 * It is plain SQL, so a rollback build can carry this file without carrying pi-durable 1.5.
 */

/** The part of a Durable Object's storage this needs: `ctx.storage` there, a thin wrapper over a SQLite file elsewhere. */
export type PiTableSnapshotStorage = {
  sql: { exec(query: string, ...bindings: unknown[]): { toArray(): Record<string, unknown>[] } };
  transactionSync<T>(closure: () => T): T;
};

/** Every table pi-durable 1.1.0 created (`TABLE_NAMES` in its schema), counters and schema version first. */
const PI_TABLES = [
  "durable_schema",
  "durable_metadata",
  "record_ids",
  "conversations",
  "entries",
  "tasks",
  "submissions",
  "documents",
  "document_revisions",
] as const;

export const PI_SNAPSHOT_PREFIX = "pi110_";
/** The copied tables' and indexes' definitions, so a restore rebuilds them exactly, constraints included. */
const DEFINITIONS = `${PI_SNAPSHOT_PREFIX}definitions`;
const PRE_UPGRADE_SCHEMA = 1;

const tableExists = (storage: PiTableSnapshotStorage, name: string): boolean =>
  storage.sql.exec("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?", name).toArray().length > 0;

const schemaVersion = (storage: PiTableSnapshotStorage): number | undefined => {
  if (!tableExists(storage, "durable_schema")) return undefined;
  const row = storage.sql.exec("SELECT version FROM durable_schema WHERE singleton = 1").toArray()[0];
  return row === undefined ? undefined : Number(row.version);
};

const counters = (storage: PiTableSnapshotStorage, table: string): { nextId: bigint; nextSeq: number } => {
  const row = storage.sql.exec(`SELECT next_id, next_seq FROM ${table} WHERE singleton = 1`).toArray()[0];
  if (row === undefined) throw new Error(`pi's counters are missing from ${table}`);
  return { nextId: BigInt(String(row.next_id)), nextSeq: Number(row.next_seq) };
};

/**
 * Copy pi's tables as pi-durable 1.1.0 left them, once, before this version opens them. Nothing to copy in an object
 * pi has not used, one already migrated, or one whose copy exists. One transaction: a copy is whole or absent.
 */
export function snapshotPiTablesBeforeUpgrade(storage: PiTableSnapshotStorage): "taken" | "kept" | "none" {
  if (tableExists(storage, DEFINITIONS)) return "kept";
  if (schemaVersion(storage) !== PRE_UPGRADE_SCHEMA) return "none";
  storage.transactionSync(() => {
    storage.sql.exec(`CREATE TABLE ${DEFINITIONS} (position INTEGER PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL, sql TEXT NOT NULL)`);
    for (const table of PI_TABLES) {
      if (!tableExists(storage, table)) continue;
      const definitions = storage.sql
        .exec("SELECT type, name, sql FROM sqlite_master WHERE tbl_name = ? AND sql IS NOT NULL ORDER BY type DESC, name", table)
        .toArray();
      for (const definition of definitions) {
        storage.sql.exec(`INSERT INTO ${DEFINITIONS} (type, name, sql) VALUES (?, ?, ?)`, definition.type, definition.name, definition.sql);
      }
      storage.sql.exec(`CREATE TABLE ${PI_SNAPSHOT_PREFIX}${table} AS SELECT * FROM ${table}`);
    }
  });
  return "taken";
}

/**
 * The way back to pi-durable 1.1.0: pi's tables are rebuilt from the copy, with the counters moved past the upgraded
 * tables'. What pi recorded after the upgrade is gone from pi's tables; the journal still has every message. The copy
 * stays, so a later upgrade starts from it again rather than taking a second one.
 */
export function restorePiTables(storage: PiTableSnapshotStorage): "restored" | "none" {
  if (!tableExists(storage, DEFINITIONS) || !tableExists(storage, "durable_metadata")) return "none";
  storage.transactionSync(() => {
    const reached = counters(storage, "durable_metadata");
    for (const table of PI_TABLES) storage.sql.exec(`DROP TABLE IF EXISTS ${table}`);
    const definitions = storage.sql.exec(`SELECT type, name, sql FROM ${DEFINITIONS} ORDER BY position`).toArray();
    for (const definition of definitions.filter((row) => row.type === "table")) {
      storage.sql.exec(String(definition.sql));
      storage.sql.exec(`INSERT INTO ${String(definition.name)} SELECT * FROM ${PI_SNAPSHOT_PREFIX}${String(definition.name)}`);
    }
    for (const definition of definitions.filter((row) => row.type === "index")) storage.sql.exec(String(definition.sql));
    const kept = counters(storage, "durable_metadata");
    const nextId = kept.nextId > reached.nextId ? kept.nextId : reached.nextId;
    storage.sql.exec(
      "UPDATE durable_metadata SET next_id = ?, next_seq = ? WHERE singleton = 1",
      String(nextId),
      Math.max(kept.nextSeq, reached.nextSeq),
    );
  });
  return "restored";
}

/** Drop the copy once the upgrade is settled and there is no going back to 1.1.0. */
export function dropPiTableSnapshot(storage: PiTableSnapshotStorage): void {
  if (!tableExists(storage, DEFINITIONS)) return;
  storage.transactionSync(() => {
    for (const table of PI_TABLES) storage.sql.exec(`DROP TABLE IF EXISTS ${PI_SNAPSHOT_PREFIX}${table}`);
    storage.sql.exec(`DROP TABLE ${DEFINITIONS}`);
  });
}
