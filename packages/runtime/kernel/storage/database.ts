import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import {
  getDesktopDatabasePath,
  initializeDesktopDatabase,
  type DesktopDatabaseInitTiming,
} from "./database-init.js";
import { SqliteConnection, type SqliteDriverDatabase } from "./shared.js";

type SqliteDatabaseCtor = new (filePath: string) => SqliteDriverDatabase;

const requireRuntime = createRequire(import.meta.url);

let cachedSqliteCtor: SqliteDatabaseCtor | null = null;

const loadSqliteDatabaseCtor = (): SqliteDatabaseCtor => {
  if (cachedSqliteCtor) return cachedSqliteCtor;
  if (process.versions.bun) {
    const bunSqlite = requireRuntime("bun:sqlite") as {
      Database?: SqliteDatabaseCtor;
    };
    if (typeof bunSqlite.Database === "function") {
      cachedSqliteCtor = bunSqlite.Database;
      return cachedSqliteCtor;
    }
  } else {
    const nodeSqlite = requireRuntime("node:sqlite") as {
      DatabaseSync?: SqliteDatabaseCtor;
    };
    if (typeof nodeSqlite.DatabaseSync === "function") {
      cachedSqliteCtor = nodeSqlite.DatabaseSync;
      return cachedSqliteCtor;
    }
  }
  throw new Error(
    "No sqlite driver available: requires Bun (bun:sqlite) or Node >= 22.5 (node:sqlite).",
  );
};

const openDatabase = (dbPath: string): SqliteConnection => {
  const Database = loadSqliteDatabaseCtor();
  return new SqliteConnection(new Database(dbPath));
};

export const openSqliteConnection = (dbPath: string): SqliteConnection =>
  openDatabase(dbPath);

export type DesktopDatabaseOpenTiming = DesktopDatabaseInitTiming & {
  openMs: number;
};

export const createDesktopDatabase = (
  stellaDataDir: string,
  options?: { onTiming?: (timing: DesktopDatabaseOpenTiming) => void },
): SqliteConnection => {
  const startedAt = performance.now();
  const db = openDatabase(getDesktopDatabasePath(stellaDataDir));
  const openMs = performance.now() - startedAt;
  const init = initializeDesktopDatabase(db);
  options?.onTiming?.({ ...init, openMs });
  return db;
};
