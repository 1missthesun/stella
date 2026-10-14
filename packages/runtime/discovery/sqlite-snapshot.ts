import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Database } from "bun:sqlite";

const BUSY_TIMEOUT_MS = 1_500;
const MAX_COPY_BYTES = 512 * 1024 * 1024;
const COPY_ATTEMPTS = 3;

export type SqliteSnapshot = Pick<Database, "prepare" | "query"> & {
  close(): void;
};

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const readInPlace = (Sqlite: typeof Database, dbPath: string): SqliteSnapshot => {
  const db = new Sqlite(dbPath, { readonly: true });
  try {
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    db.exec("BEGIN");
    db.query("SELECT count(*) FROM sqlite_master").get();
  } catch (error) {
    db.close();
    throw error;
  }
  return {
    prepare: db.prepare.bind(db),
    query: db.query.bind(db),
    close: () => {
      try {
        db.exec("COMMIT");
      } finally {
        db.close();
      }
    },
  };
};

const SIDECARS = ["-wal", "-journal"] as const;

const readCopy = (Sqlite: typeof Database, dbPath: string): SqliteSnapshot => {
  const bytes = [dbPath, ...SIDECARS.map((suffix) => `${dbPath}${suffix}`)]
    .filter((file) => existsSync(file))
    .reduce((sum, file) => sum + statSync(file).size, 0);
  if (bytes > MAX_COPY_BYTES) {
    throw new Error(`${dbPath} is locked and too large to copy.`);
  }
  let lastError: unknown = null;
  for (let attempt = 0; attempt < COPY_ATTEMPTS; attempt += 1) {
    const dir = mkdtempSync(path.join(os.tmpdir(), "stella-discovery-"));
    const copy = path.join(dir, path.basename(dbPath));
    try {
      copyFileSync(dbPath, copy);
      for (const suffix of SIDECARS) {
        if (existsSync(`${dbPath}${suffix}`)) {
          copyFileSync(`${dbPath}${suffix}`, `${copy}${suffix}`);
        }
      }
      const db = new Sqlite(copy);
      const check = db.query("PRAGMA quick_check(1)").get() as Record<
        string,
        unknown
      > | null;
      if (Object.values(check ?? {})[0] !== "ok") {
        db.close();
        throw new Error(`${dbPath} changed while it was being copied.`);
      }
      return {
        prepare: db.prepare.bind(db),
        query: db.query.bind(db),
        close: () => {
          try {
            db.close();
          } finally {
            rmSync(dir, { recursive: true, force: true });
          }
        },
      };
    } catch (error) {
      lastError = error;
      rmSync(dir, { recursive: true, force: true });
    }
  }
  throw new Error(
    `${dbPath} could not be read consistently: ${errorText(lastError)}`,
  );
};

/**
 * One coherent read of another app's live database: a read-only connection
 * inside one read transaction (it sees the WAL), or, while that app holds
 * the file locked, a private copy SQLite recovers and that passes
 * `quick_check`. Throws when neither is possible.
 */
export const openSqliteSnapshot = async (
  dbPath: string,
): Promise<SqliteSnapshot> => {
  const { Database: Sqlite } = await import("bun:sqlite");
  try {
    return readInPlace(Sqlite, dbPath);
  } catch {
    return readCopy(Sqlite, dbPath);
  }
};
