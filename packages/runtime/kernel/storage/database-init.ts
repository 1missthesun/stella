import path from "path";
import { performance } from "node:perf_hooks";
import type { SqliteDatabase } from "./shared.js";
import { ensurePrivateDirSync } from "../shared/private-fs.js";
import { SCHEMA_VERSION, migrateDesktopDatabase } from "./schema.js";
import { getFileLogger } from "../../observability/file-logger.js";

const DB_FILE = "stella.sqlite";

export const ensureDatabaseStateRoot = (stellaDataDir: string) => {
  const stateRoot = stellaDataDir;
  ensurePrivateDirSync(stateRoot);
  return stateRoot;
};

export const getDesktopDatabasePath = (stellaDataDir: string) =>
  path.join(ensureDatabaseStateRoot(stellaDataDir), DB_FILE);

export type DesktopDatabaseInitTiming = {
  fromVersion: number;
  toVersion: number;
  migrated: boolean;
  durationMs: number;
};

const readUserVersionSafely = (db: SqliteDatabase): number => {
  try {
    const row = db.prepare("PRAGMA user_version;").get() as
      | { user_version?: number }
      | undefined;
    return typeof row?.user_version === "number" ? row.user_version : -1;
  } catch {
    return -1;
  }
};

export const initializeDesktopDatabase = (
  db: SqliteDatabase,
): DesktopDatabaseInitTiming => {
  const startedAt = performance.now();
  const fromVersion = readUserVersionSafely(db);
  const pending = fromVersion >= 0 && fromVersion < SCHEMA_VERSION;
  if (pending) {
    getFileLogger()?.process("storage.migration.start", {
      fromVersion,
      toVersion: SCHEMA_VERSION,
      pid: process.pid,
    });
  }
  try {
    migrateDesktopDatabase(db);
  } catch (error) {
    if (pending) {
      getFileLogger()?.error("storage.migration.failed", {
        fromVersion,
        toVersion: SCHEMA_VERSION,
        ms: Math.round(performance.now() - startedAt),
        error: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  }
  const durationMs = performance.now() - startedAt;
  if (pending) {
    getFileLogger()?.process("storage.migration.complete", {
      fromVersion,
      toVersion: SCHEMA_VERSION,
      ms: Math.round(durationMs),
    });
  }
  return {
    fromVersion,
    toVersion: SCHEMA_VERSION,
    migrated: pending,
    durationMs,
  };
};
