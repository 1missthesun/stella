import { Database } from "bun:sqlite";
import { constants } from "node:fs";
import { copyFile, rename, rm, stat } from "node:fs/promises";

/**
 * pi-durable 1.4 and later migrate a conversation's SQLite file from schema
 * version 1 (what 1.1.0 wrote) to 2 the first time they open it, and 1.1.0
 * refuses a version 2 file. So before a file is opened by this version for the
 * first time, a copy of it as 1.1.0 left it is kept beside it: a clone where
 * the filesystem shares blocks (btrfs, APFS), a plain copy elsewhere.
 *
 * `restorePiSnapshot` is the way back for a build on 1.1.0: it puts the copy
 * in place and moves pi's ID and commit counters past every one the upgraded
 * file used, so nothing written afterwards reuses an entry ID that Stella's
 * journal already keys a message by.
 */

export const PI_SNAPSHOT_SUFFIX = ".pi-1.1.0";
const UPGRADED_SUFFIX = ".pi-upgraded";
const PRE_UPGRADE_SCHEMA = 1;

const exists = async (path: string): Promise<boolean> =>
  stat(path).then(
    () => true,
    () => false,
  );

const nonEmpty = async (path: string): Promise<boolean> =>
  stat(path).then(
    (info) => info.size > 0,
    () => false,
  );

const schemaVersion = (database: Database): number | undefined => {
  const table = database
    .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'durable_schema'")
    .get();
  if (!table) return undefined;
  return database.query<{ version: number }, []>("SELECT version FROM durable_schema WHERE singleton = 1").get()?.version;
};

/** A copy that shares blocks with the original where the filesystem can, a full copy elsewhere. */
const cloneFile = async (from: string, to: string): Promise<void> => {
  const partial = `${to}.partial`;
  await rm(partial, { force: true });
  await copyFile(from, partial, constants.COPYFILE_FICLONE);
  await rename(partial, to);
};

/**
 * Keep a copy of `path` as pi-durable 1.1.0 left it, once, before anything
 * opens it with this version. Nothing to keep for a new file, one already
 * migrated, or one whose copy exists.
 */
export async function snapshotBeforePiUpgrade(path: string): Promise<"taken" | "kept" | "none"> {
  if (path === ":memory:" || !(await exists(path))) return "none";
  const snapshot = `${path}${PI_SNAPSHOT_SUFFIX}`;
  if (await exists(snapshot)) return "kept";
  const database = new Database(path, { readwrite: true, create: false });
  try {
    if (schemaVersion(database) !== PRE_UPGRADE_SCHEMA) return "none";
    // Fold the write-ahead log into the file so the copy is whole; a log that could not be folded is copied too.
    database.run("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    database.close();
  }
  if (await nonEmpty(`${path}-wal`)) await cloneFile(`${path}-wal`, `${snapshot}-wal`);
  await cloneFile(path, snapshot);
  return "taken";
}

type Counters = { nextId: bigint; nextSeq: number };

const countersOf = (database: Database): Counters => {
  const row = database
    .query<{ next_id: string; next_seq: number }, []>("SELECT next_id, next_seq FROM durable_metadata WHERE singleton = 1")
    .get();
  if (!row) throw new Error("pi's SQLite metadata is missing");
  return { nextId: BigInt(row.next_id), nextSeq: Number(row.next_seq) };
};

/**
 * The way back to pi-durable 1.1.0 for one conversation file: the upgraded
 * file moves aside (kept, with the suffix `.pi-upgraded`), the snapshot takes
 * its place, and the snapshot's counters move past the upgraded file's. What
 * pi itself recorded after the upgrade is gone from this file; the journal
 * still has every message.
 */
export async function restorePiSnapshot(path: string): Promise<"restored" | "none"> {
  const snapshot = `${path}${PI_SNAPSHOT_SUFFIX}`;
  if (!(await exists(snapshot)) || !(await exists(path))) return "none";
  const upgraded = new Database(path, { readwrite: true, create: false });
  let reached: Counters;
  try {
    upgraded.run("PRAGMA wal_checkpoint(TRUNCATE)");
    reached = countersOf(upgraded);
  } finally {
    upgraded.close();
  }
  const aside = `${path}${UPGRADED_SUFFIX}`;
  for (const suffix of ["", "-wal", "-shm"]) {
    if (await exists(`${path}${suffix}`)) await rename(`${path}${suffix}`, `${aside}${suffix}`);
  }
  if (await exists(`${snapshot}-wal`)) await cloneFile(`${snapshot}-wal`, `${path}-wal`);
  await cloneFile(snapshot, path);
  const restored = new Database(path, { readwrite: true, create: false });
  try {
    const kept = countersOf(restored);
    const nextId = kept.nextId > reached.nextId ? kept.nextId : reached.nextId;
    const nextSeq = Math.max(kept.nextSeq, reached.nextSeq);
    restored.run("UPDATE durable_metadata SET next_id = ?, next_seq = ? WHERE singleton = 1", [String(nextId), nextSeq]);
  } finally {
    restored.close();
  }
  return "restored";
}
