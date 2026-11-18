import { execFile } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir, homedir, platform } from "node:os";
import path from "node:path";

export const OS = platform() as "darwin" | "win32" | "linux";
export const HOME = homedir();

export const home = (...parts: string[]) => path.join(HOME, ...parts);

export type ExecResult = { ok: boolean; stdout: string; stderr: string; code: number | null };

/** Run a program without a shell; never throws. Read-only commands only. */
export const run = (file: string, args: string[], timeoutMs = 15_000): Promise<ExecResult> =>
  new Promise((resolve) => {
    execFile(
      file,
      args,
      { timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, windowsHide: true, encoding: "utf8" },
      (error, stdout, stderr) => {
        const code = error && typeof (error as { code?: unknown }).code === "number" ? ((error as { code: number }).code) : error ? null : 0;
        resolve({ ok: !error, stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), code });
      },
    );
  });

export const powershell = (script: string, timeoutMs = 20_000) =>
  run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], timeoutMs);

export const readJson = <T = unknown>(file: string): T | undefined => {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return undefined;
  }
};

export const exists = (file: string) => {
  try {
    return existsSync(file);
  } catch {
    return false;
  }
};

export const mtime = (file: string): number | undefined => {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return undefined;
  }
};

type Row = Record<string, unknown>;
type Db = { all(sql: string, ...params: unknown[]): Row[]; close(): void };

const openSqlite = async (file: string): Promise<Db> => {
  if (typeof (globalThis as { Bun?: unknown }).Bun !== "undefined") {
    const { Database } = await import("bun:sqlite");
    const db = new Database(file, { readonly: true });
    return { all: (sql, ...params) => db.query(sql).all(...(params as never[])) as Row[], close: () => db.close() };
  }
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(file, { readOnly: true });
  // Browser timestamps (microseconds since 1601) don't fit a JS number exactly; read them as
  // BigInt and round to a number (sub-millisecond precision doesn't matter here).
  const toNum = (row: Row): Row => {
    for (const k of Object.keys(row)) if (typeof row[k] === "bigint") row[k] = Number(row[k]);
    return row;
  };
  return {
    all: (sql, ...params) => {
      const stmt = db.prepare(sql);
      stmt.setReadBigInts(true);
      return (stmt.all(...(params as never[])) as Row[]).map(toNum);
    },
    close: () => db.close(),
  };
};

/**
 * Browsers keep their databases locked while running, so read a private copy
 * (with its WAL) in a temp folder and delete it right after.
 */
export const readSqliteCopy = async (file: string, sql: string, ...params: unknown[]): Promise<Row[]> => {
  if (!exists(file)) return [];
  const dir = mkdtempSync(path.join(tmpdir(), "stella-security-"));
  try {
    const copy = path.join(dir, "db.sqlite");
    copyFileSync(file, copy);
    for (const suffix of ["-wal", "-shm"]) if (exists(file + suffix)) copyFileSync(file + suffix, copy + suffix);
    const db = await openSqlite(copy);
    try {
      return db.all(sql, ...params);
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

export { DAY, baseDomain, chromeTimeToMs, compareVersions, fetchJson, fetchText, hostOf, msToChromeTime } from "./pure.ts";
