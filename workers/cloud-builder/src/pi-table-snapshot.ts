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

const SIZE = `${PI_SNAPSHOT_PREFIX}bytes`;

const measureCopy = (storage: PiTableSnapshotStorage): number => {
  const copies = PI_TABLES.map((table) => `${PI_SNAPSHOT_PREFIX}${table}`).filter((table) => tableExists(storage, table));
  try {
    let bytes = 0;
    for (const table of copies) {
      bytes += Number(storage.sql.exec("SELECT COALESCE(SUM(pgsize), 0) AS bytes FROM dbstat WHERE name = ?", table).toArray()[0]?.bytes ?? 0);
    }
    if (bytes > 0) return bytes;
  } catch {
    // No dbstat in this SQLite build: count the rows' bytes instead.
  }
  let bytes = 0;
  for (const table of copies) {
    const columns = storage.sql.exec("SELECT name FROM pragma_table_info(?)", table).toArray().map((row) => String(row.name));
    if (columns.length === 0) continue;
    const length = columns.map((column) => `COALESCE(LENGTH(CAST("${column.replaceAll('"', '""')}" AS BLOB)), 0)`).join(" + ");
    bytes += Number(storage.sql.exec(`SELECT COALESCE(SUM(${length}), 0) AS bytes FROM ${table}`).toArray()[0]?.bytes ?? 0);
  }
  return bytes;
};

export function piTableSnapshotBytes(storage: PiTableSnapshotStorage): number {
  if (!tableExists(storage, DEFINITIONS)) return 0;
  if (tableExists(storage, SIZE)) {
    const row = storage.sql.exec(`SELECT bytes FROM ${SIZE} WHERE singleton = 1`).toArray()[0];
    if (row !== undefined) return Number(row.bytes);
  }
  const bytes = measureCopy(storage);
  storage.transactionSync(() => {
    storage.sql.exec(`CREATE TABLE IF NOT EXISTS ${SIZE} (singleton INTEGER PRIMARY KEY CHECK (singleton = 1), bytes INTEGER NOT NULL)`);
    storage.sql.exec(`INSERT OR REPLACE INTO ${SIZE} (singleton, bytes) VALUES (1, ?)`, bytes);
  });
  return bytes;
}

export const keepPiTableSnapshots = (env: { PI_UPGRADE_COPIES?: string }): boolean =>
  env.PI_UPGRADE_COPIES?.trim().toLowerCase() !== "drop";

export function dropPiTableSnapshot(storage: PiTableSnapshotStorage): "dropped" | "none" {
  if (!tableExists(storage, DEFINITIONS)) return "none";
  storage.transactionSync(() => {
    for (const table of PI_TABLES) storage.sql.exec(`DROP TABLE IF EXISTS ${PI_SNAPSHOT_PREFIX}${table}`);
    storage.sql.exec(`DROP TABLE IF EXISTS ${SIZE}`);
    storage.sql.exec(`DROP TABLE ${DEFINITIONS}`);
  });
  return "dropped";
}
