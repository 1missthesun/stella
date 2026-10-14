/**
 * Idle-time maintenance for the desktop database (`stella.sqlite`).
 *
 * The file is shared over WAL by four connections in three processes (this
 * worker, Electron main's chat-history service, the Electron cloud-cache
 * thread, the host's connector outbox). Nothing else ever checkpoints,
 * analyzes or vacuums it, so this module owns all of that, from the worker —
 * the process that owns the database lifetime (`worker/server/session/storage.ts`).
 *
 * Scheduling. One fixed-rate fiber (`forkFixedRateFiber`, the run-event-log
 * sweep idiom) ticks every `intervalMs`. A tick does nothing unless the
 * caller's `isIdle()` holds — the worker wires its session-work signal (no orchestrator run, no agents, no
 * in-flight RPC handler, no voice work). Consecutive idle ticks form
 * an idle streak; heavier steps need a longer streak, and a tick runs at most
 * one heavy step:
 *   - every idle tick: `wal_checkpoint(PASSIVE)`, or `TRUNCATE` once the WAL
 *     file exceeds `walTruncateBytes` (the WAL never shrinks on its own);
 *   - every idle tick, until drained: `deleteLegacyRunEventBatch` batches
 *     (entry-retention.ts, <= 5k rows, one immediate transaction each) over
 *     the unread legacy `run_event` rows, for up to 250 ms per tick with a
 *     client attached or 2 s with none, stopping early if the idle
 *     predicate flips between batches; drained is recorded in `meta`.
 *     The budget is checked after each batch, so one tick can overrun it by
 *     at most one batch. Drain estimate for prod's ~1.56 M rows: a 5k batch
 *     measured ~60 ms p50 / ~200 ms max on a prod-shaped fixture, so ~4
 *     batches (~20k rows) per attached idle minute → ~80–90 idle minutes
 *     attached, or ~10 detached ticks (~165k rows each) — versus ~5 idle
 *     hours at one batch per tick;
 *   - streak >= analyzeIdleTicks: one bounded `ANALYZE` per schema version
 *     (meta-guarded), so the planner finally has `sqlite_stat1`;
 *   - zero RPC clients attached AND streak >= reclaimIdleTicks, while
 *     `idx_entry_search_conv_created` is missing: build the search-text covering
 *     index (`SEARCH_TEXT_INDEX_SQL`, below) — before the reclaim, so the
 *     VACUUM that follows also compacts it;
 *   - the run_event sweep drained (deleted rows only return space through
 *     VACUUM) AND zero RPC clients attached AND streak >= reclaimIdleTicks
 *     (default 1 — the long streak only ever protected an attached
 *     Electron, and the reclaim never runs attached): the one-time freelist
 *     reclaim (below). Its cheap preconditions are evaluated on every idle
 *     tick while attached, so the idle-shutdown hold is in place at quit.
 * `PRAGMA optimize` runs on the worker's own connection once on the first
 * idle tick and again at shutdown (`stop()`), per SQLite's guidance for
 * long-lived connections.
 *
 * Every statement here is synchronous (bun:sqlite), so a tick can never
 * interleave with a turn's writes on this thread, and `stop()` — also
 * synchronous — cannot race an in-flight tick: cancelling the fiber IS the
 * join. Other processes are handled with SQLITE_BUSY: maintenance uses its
 * own connection with a short busy timeout, and BUSY is always "try again
 * next idle window", never an error.
 *
 * One-time reclaim. Migration v1 dropped the legacy tables without a VACUUM,
 * leaving most of the file on the freelist. When the freelist exceeds both
 * `reclaimMinFreelistBytes` and `reclaimMinFreelistRatio` of the file, and
 * statfs shows room for VACUUM's two transient copies (the temp database and,
 * in WAL mode, a WAL as large as the result), the reclaim runs:
 *   TRUNCATE checkpoint → VACUUM → record completion →
 *   TRUNCATE checkpoint (this is what actually shrinks the file).
 *
 * Why not `auto_vacuum = INCREMENTAL`: switching an existing database to it
 * requires a full VACUUM anyway (the one-time cost this module pays once),
 * and incremental vacuum only moves free pages to the end of the file — it
 * never defragments, so a long-lived chat log fragments steadily while paying
 * pointer-map overhead on every write.
 *
 * The detached window. VACUUM holds the write lock for its whole duration
 * (minutes on a multi-GiB file) and blocks this worker's event loop (the
 * driver is synchronous). With Electron attached that would stall the user's
 * next message and fail Electron-main / cloud-cache writes past their 5s
 * busy_timeout, so the reclaim only starts when the peer broker reports zero
 * attached clients (`WorkerPeerBroker.attachedCount`, the same attach/detach
 * events the lifecycle server's idle-shutdown counts). That is the worker's
 * pre-idle-shutdown window: Electron is gone, there are no other writers, and
 * blocking our own loop is harmless. Once the preconditions have held on an
 * idle tick, `holdsWorkerAlive()` is the lifecycle's `shouldKeepAlive`, so it
 * postpones idle shutdown until the next tick
 * has run the reclaim (the VACUUM itself is synchronous, so no timer can
 * fire mid-VACUUM). Three BUSY deferrals end the hold for the session.
 * Worst-case post-quit linger, once per database: one tick (<= 60 s) +
 * VACUUM + final checkpoint — about 5–7 minutes for the
 * 13.3 GiB prod file (~6 GiB live).
 *
 * The search-text index. The covering partial index is not in the
 * schema or a migration: building it is one full `entry` scan through every
 * row's payload overflow chain (~6 s warm, ~15–20 s cold on the 13 GiB prod
 * file) holding the write lock, which at open would freeze Electron main
 * (it migrates synchronously) and fail other writers' 5 s busy timeout. So
 * it is built here, in the same detached window as the reclaim, with the
 * same treatment: `holdsWorkerAlive()` pins idle shutdown while it is
 * missing and no client is attached, BUSY defers to the next idle tick,
 * three deferrals give up for the session. `CREATE INDEX` and
 * `ANALYZE idx_entry_search_conv_created` commit in one transaction: with
 * `sqlite_stat1` rows for the other `entry` indexes but none for this one,
 * the planner would pick it for the latest-visible-message lookup over
 * `idx_entry_conv_visible_seq`. The index is ~14 MB on prod, so it needs no
 * disk check. Queries never force it (no `INDEXED BY`); without it they
 * return the same rows, slower. Presence is read from `sqlite_master`.
 * This adds, once per database, one tick plus the build to the post-quit
 * linger below.
 *
 * Kill switch: `STELLA_DB_RECLAIM=0` disables only the reclaim; checkpoint,
 * optimize, ANALYZE and the run_event sweep keep running.
 *
 * Killed mid-VACUUM (e.g. Electron reattaches, the host's attach times out,
 * and its kill ladder SIGTERMs then SIGKILLs the worker — the SIGTERM handler
 * cannot run while VACUUM blocks the loop): VACUUM is one write transaction.
 * In WAL mode its pages go to the WAL and the commit frame is written last,
 * so a SIGKILL before commit leaves the main file untouched and recovery
 * ignores the uncommitted frames; the temp database is an unlinked-on-open
 * (unix) / delete-on-close (Windows) file, so nothing is left behind.
 * Verified by SIGKILLing a VACUUM on a 200 MiB fixture: integrity_check ok,
 * freelist unchanged, `freelist_reclaim_v1` unset, and the reclaim retries in
 * a later detached window.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getFileLogger } from "../../observability/file-logger.js";
import { openSqliteConnection } from "./database.js";
import { forkFixedRateFiber } from "./effect-runtime.js";
import { deleteLegacyRunEventBatch } from "./entry-retention.js";
import {
  SCHEMA_VERSION,
  SEARCH_TEXT_INDEX_NAME,
  SEARCH_TEXT_INDEX_SQL,
} from "./schema.js";
import type { SqliteDatabase } from "./shared.js";

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

export type MaintenanceSettings = {
  intervalMs: number;
  walTruncateBytes: number;
  analyzeIdleTicks: number;
  reclaimIdleTicks: number;
  sweepBudgetMs: number;
  sweepDetachedBudgetMs: number;
  reclaimMinFreelistBytes: number;
  reclaimMinFreelistRatio: number;
  reclaimDiskHeadroomBytes: number;
  busyTimeoutMs: number;
  checkpointBusyTimeoutMs: number;
  analysisLimit: number;
};

export const MAINTENANCE_DEFAULTS: Readonly<MaintenanceSettings> = {
  intervalMs: 60_000,
  walTruncateBytes: 64 * MiB,
  analyzeIdleTicks: 2,
  reclaimIdleTicks: 1,
  sweepBudgetMs: 250,
  sweepDetachedBudgetMs: 2_000,
  reclaimMinFreelistBytes: 512 * MiB,
  reclaimMinFreelistRatio: 0.25,
  reclaimDiskHeadroomBytes: 1 * GiB,
  busyTimeoutMs: 2_000,
  checkpointBusyTimeoutMs: 100,
  analysisLimit: 400,
};

export const MAINTENANCE_META_KEYS = {
  analyzedSchemaVersion: "maintenance.analyze_schema_version",
  freelistReclaimed: "maintenance.freelist_reclaim_v1",
  runEventSweepDrained: "maintenance.run_event_sweep_drained",
} as const;

export type MaintenanceLogger = {
  process(event: string, fields?: Record<string, unknown>): void;
  warn(event: string, fields?: Record<string, unknown>): void;
};

export type DiskSpace = { freeBytes: number; device: number };
export type DiskSpaceProbe = (directory: string) => DiskSpace | null;

export type DatabaseHealth = {
  pageSize: number;
  pageCount: number;
  freelistCount: number;
  fileBytes: number;
  freelistBytes: number;
  liveBytes: number;
  walBytes: number;
};

export type CheckpointMode = "PASSIVE" | "TRUNCATE";

export type CheckpointResult = {
  mode: CheckpointMode;
  busy: boolean;
  walFrames: number;
  checkpointedFrames: number;
};

export type ReclaimOutcome =
  | {
      status: "reclaimed";
      before: DatabaseHealth;
      after: DatabaseHealth;
      vacuumMs: number;
      finalCheckpointBusy: boolean;
    }
  | {
      status: "deferred";
      reason: "busy";
      step: "checkpoint" | "vacuum" | "record";
    }
  | {
      status: "skipped";
      reason: "already-done" | "below-threshold" | "insufficient-disk";
      detail: Record<string, unknown>;
    };

export type SearchIndexOutcome =
  | { status: "built"; ms: number; indexBytes: number }
  | { status: "present" }
  | { status: "deferred"; reason: "busy" };

export type ReclaimPolicy = {
  minFreelistBytes: number;
  minFreelistRatio: number;
  diskHeadroomBytes: number;
  busyTimeoutMs: number;
  checkpointBusyTimeoutMs: number;
  diskSpace: DiskSpaceProbe;
  tempDirectory: string;
  vacuum?: (connection: SqliteDatabase) => void;
};

export const isSqliteBusyError = (error: unknown): boolean => {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /SQLITE_(BUSY|LOCKED)/.test(code)) {
    return true;
  }
  const message =
    error instanceof Error ? error.message : String(error ?? "");
  return /\b(database is locked|database table is locked|busy)\b/i.test(
    message,
  );
};

const firstColumn = (row: unknown): unknown =>
  row && typeof row === "object" ? Object.values(row)[0] : undefined;

const pragmaNumber = (db: SqliteDatabase, pragma: string): number => {
  const value = Number(firstColumn(db.prepare(`PRAGMA ${pragma};`).get()));
  return Number.isFinite(value) ? value : 0;
};

const fileSize = (filePath: string): number => {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
};

export const walPathFor = (databasePath: string): string =>
  `${databasePath}-wal`;

export const readDatabaseHealth = (
  db: SqliteDatabase,
  databasePath: string,
): DatabaseHealth => {
  const pageSize = pragmaNumber(db, "page_size");
  const pageCount = pragmaNumber(db, "page_count");
  const freelistCount = pragmaNumber(db, "freelist_count");
  return {
    pageSize,
    pageCount,
    freelistCount,
    fileBytes: fileSize(databasePath),
    freelistBytes: freelistCount * pageSize,
    liveBytes: Math.max(0, pageCount - freelistCount) * pageSize,
    walBytes: fileSize(walPathFor(databasePath)),
  };
};

export const withBusyTimeout = <A>(
  db: SqliteDatabase,
  timeoutMs: number,
  fn: () => A,
): A => {
  const previous = pragmaNumber(db, "busy_timeout");
  db.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.floor(timeoutMs))};`);
  try {
    return fn();
  } finally {
    db.exec(`PRAGMA busy_timeout = ${previous};`);
  }
};

export const checkpointWal = (
  db: SqliteDatabase,
  mode: CheckpointMode,
): CheckpointResult => {
  const row = db.prepare(`PRAGMA wal_checkpoint(${mode});`).get() as {
    busy?: number;
    log?: number;
    checkpointed?: number;
  } | null;
  return {
    mode,
    busy: Number(row?.busy ?? 0) !== 0,
    walFrames: Number(row?.log ?? 0),
    checkpointedFrames: Number(row?.checkpointed ?? 0),
  };
};

const readMeta = (db: SqliteDatabase, key: string): string | null => {
  const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as {
    value?: unknown;
  } | null;
  return typeof row?.value === "string" ? row.value : null;
};

const writeMeta = (db: SqliteDatabase, key: string, value: string): void => {
  db.prepare(
    `INSERT INTO meta (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value,
       updated_at = excluded.updated_at`,
  ).run(key, value, Date.now());
};

const inImmediateTransaction = <A>(db: SqliteDatabase, fn: () => A): A => {
  db.exec("BEGIN IMMEDIATE;");
  try {
    const result = fn();
    db.exec("COMMIT;");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      /* the transaction may already be gone */
    }
    throw error;
  }
};

export const analyzeOncePerSchemaVersion = (
  db: SqliteDatabase,
  analysisLimit: number = MAINTENANCE_DEFAULTS.analysisLimit,
): boolean => {
  const version = String(SCHEMA_VERSION);
  if (readMeta(db, MAINTENANCE_META_KEYS.analyzedSchemaVersion) === version) {
    return false;
  }
  db.exec(`PRAGMA analysis_limit = ${analysisLimit};`);
  inImmediateTransaction(db, () => {
    db.exec("ANALYZE;");
    writeMeta(db, MAINTENANCE_META_KEYS.analyzedSchemaVersion, version);
  });
  return true;
};

export const searchTextIndexExists = (db: SqliteDatabase): boolean =>
  Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?")
      .get(SEARCH_TEXT_INDEX_NAME),
  );

/**
 * Build the search-text covering index and its `sqlite_stat1` row in one
 * immediate transaction. Holds the write lock for the whole `entry` scan,
 * so callers run it only in the detached window. BUSY is a deferral.
 * `indexBytes` is the growth in live pages (the index plus its stat row).
 */
export const buildSearchTextIndex = (
  connection: SqliteDatabase,
  options: {
    busyTimeoutMs: number;
    analysisLimit: number;
    create?: (connection: SqliteDatabase) => void;
  },
): SearchIndexOutcome => {
  if (searchTextIndexExists(connection)) return { status: "present" };
  const livePages = () =>
    pragmaNumber(connection, "page_count") -
    pragmaNumber(connection, "freelist_count");
  const pagesBefore = livePages();
  const startedAt = performance.now();
  try {
    withBusyTimeout(connection, options.busyTimeoutMs, () => {
      connection.exec(`PRAGMA analysis_limit = ${options.analysisLimit};`);
      inImmediateTransaction(connection, () => {
        (options.create ?? ((db) => db.exec(SEARCH_TEXT_INDEX_SQL)))(
          connection,
        );
        connection.exec(`ANALYZE ${SEARCH_TEXT_INDEX_NAME};`);
      });
    });
  } catch (error) {
    if (isSqliteBusyError(error)) return { status: "deferred", reason: "busy" };
    throw error;
  }
  return {
    status: "built",
    ms: elapsedMs(startedAt),
    indexBytes:
      Math.max(0, livePages() - pagesBefore) *
      pragmaNumber(connection, "page_size"),
  };
};

/**
 * `PRAGMA optimize` on a long-lived connection. `boot` uses mask 0x10002
 * (SQLite >= 3.46: consider every table, not only ones this connection
 * queried; older versions ignore the extra bit). BUSY is swallowed — the
 * next boot/shutdown tries again.
 */
export const optimizeConnection = (
  db: SqliteDatabase,
  phase: "boot" | "close",
  options: { busyTimeoutMs?: number; analysisLimit?: number } = {},
): boolean => {
  try {
    withBusyTimeout(db, options.busyTimeoutMs ?? 250, () => {
      db.exec(
        `PRAGMA analysis_limit = ${options.analysisLimit ?? MAINTENANCE_DEFAULTS.analysisLimit};`,
      );
      db.exec(
        phase === "boot" ? "PRAGMA optimize = 0x10002;" : "PRAGMA optimize;",
      );
    });
    return true;
  } catch (error) {
    if (isSqliteBusyError(error)) return false;
    throw error;
  }
};

export const defaultDiskSpaceProbe: DiskSpaceProbe = (directory) => {
  try {
    const stats = fs.statfsSync(directory);
    return {
      freeBytes: Number(stats.bavail) * Number(stats.bsize),
      device: Number(fs.statSync(directory).dev),
    };
  } catch {
    return null;
  }
};

export const sqliteTempDirectory = (): string =>
  process.env.SQLITE_TMPDIR || os.tmpdir();

/**
 * VACUUM needs, transiently, a temp database (~live bytes, in the temp
 * directory) plus a WAL as large as the result (~live bytes, next to the
 * database) before the final checkpoint shrinks the file.
 */
export const checkReclaimDiskSpace = (
  health: DatabaseHealth,
  databasePath: string,
  policy: Pick<ReclaimPolicy, "diskHeadroomBytes" | "diskSpace" | "tempDirectory">,
): { ok: true } | { ok: false; detail: Record<string, unknown> } => {
  const databaseDirectory = path.dirname(databasePath);
  const dbDisk = policy.diskSpace(databaseDirectory);
  const tmpDisk = policy.diskSpace(policy.tempDirectory);
  const perCopy = health.liveBytes + policy.diskHeadroomBytes;
  if (!dbDisk || !tmpDisk) {
    return { ok: false, detail: { reason: "statfs-unavailable" } };
  }
  const sameDevice = dbDisk.device === tmpDisk.device;
  const requiredDbBytes = sameDevice
    ? 2 * health.liveBytes + policy.diskHeadroomBytes
    : perCopy;
  const ok = sameDevice
    ? dbDisk.freeBytes >= requiredDbBytes
    : dbDisk.freeBytes >= perCopy && tmpDisk.freeBytes >= perCopy;
  return ok
    ? { ok: true }
    : {
        ok: false,
        detail: {
          liveBytes: health.liveBytes,
          requiredBytes: requiredDbBytes,
          freeBytes: dbDisk.freeBytes,
          ...(sameDevice ? {} : { tempFreeBytes: tmpDisk.freeBytes }),
        },
      };
};

export const evaluateReclaim = (
  connection: SqliteDatabase,
  databasePath: string,
  policy: ReclaimPolicy,
): { ready: true; health: DatabaseHealth } | (ReclaimOutcome & { ready?: false }) => {
  if (readMeta(connection, MAINTENANCE_META_KEYS.freelistReclaimed) !== null) {
    return { status: "skipped", reason: "already-done", detail: {} };
  }
  const health = readDatabaseHealth(connection, databasePath);
  const totalBytes = health.pageCount * health.pageSize;
  const ratio = totalBytes > 0 ? health.freelistBytes / totalBytes : 0;
  if (
    health.freelistBytes < policy.minFreelistBytes ||
    ratio < policy.minFreelistRatio
  ) {
    return {
      status: "skipped",
      reason: "below-threshold",
      detail: { freelistBytes: health.freelistBytes, ratio },
    };
  }
  const disk = checkReclaimDiskSpace(health, databasePath, policy);
  if (!disk.ok) {
    return { status: "skipped", reason: "insufficient-disk", detail: disk.detail };
  }
  return { ready: true, health };
};

export const reclaimFreelist = (
  connection: SqliteDatabase,
  databasePath: string,
  policy: ReclaimPolicy,
): ReclaimOutcome => {
  const evaluation = evaluateReclaim(connection, databasePath, policy);
  if (evaluation.ready !== true) return evaluation;
  const before = evaluation.health;

  // Start from an empty WAL: VACUUM will write the whole result into it.
  const preCheckpoint = withBusyTimeout(
    connection,
    policy.checkpointBusyTimeoutMs,
    () => checkpointWal(connection, "TRUNCATE"),
  );
  if (preCheckpoint.busy) {
    return { status: "deferred", reason: "busy", step: "checkpoint" };
  }

  connection.exec("PRAGMA temp_store = FILE;");
  return withBusyTimeout(connection, policy.busyTimeoutMs, () => {
    const vacuumStartedAt = performance.now();
    try {
      (policy.vacuum ?? ((db) => db.exec("VACUUM;")))(connection);
    } catch (error) {
      if (isSqliteBusyError(error)) {
        return { status: "deferred", reason: "busy", step: "vacuum" };
      }
      throw error;
    }
    const vacuumMs = Math.round(performance.now() - vacuumStartedAt);

    try {
      writeMeta(
        connection,
        MAINTENANCE_META_KEYS.freelistReclaimed,
        JSON.stringify({
          at: Date.now(),
          fileBytesBefore: before.fileBytes,
          freelistBytesBefore: before.freelistBytes,
        }),
      );
    } catch (error) {
      if (isSqliteBusyError(error)) {
        return { status: "deferred", reason: "busy", step: "record" };
      }
      throw error;
    }

    // This checkpoint copies the vacuumed pages back and truncates the file.
    // BUSY (a reader on an old snapshot) is fine: the WAL-size rule on a
    // later idle tick finishes it.
    const finalCheckpoint = withBusyTimeout(
      connection,
      policy.checkpointBusyTimeoutMs,
      () => checkpointWal(connection, "TRUNCATE"),
    );
    return {
      status: "reclaimed",
      before,
      after: readDatabaseHealth(connection, databasePath),
      vacuumMs,
      finalCheckpointBusy: finalCheckpoint.busy,
    };
  });
};

export type DatabaseMaintenanceOptions = {
  db: SqliteDatabase;
  databasePath: string;
  openConnection?: (databasePath: string) => SqliteDatabase;
  logger?: MaintenanceLogger | null;
  diskSpace?: DiskSpaceProbe;
  tempDirectory?: string;
  vacuum?: (connection: SqliteDatabase) => void;
  createSearchIndex?: (connection: SqliteDatabase) => void;
  sweepBatchSize?: number;
  now?: () => number;
} & Partial<MaintenanceSettings>;

export type MaintenanceStartOptions = {
  isIdle: () => boolean;
  attachedClientCount: () => number;
};

export const reclaimKillSwitchEngaged = (): boolean =>
  process.env.STELLA_DB_RECLAIM === "0";

const MAX_DETACHED_RECLAIM_DEFERRALS = 3;
const MAX_DETACHED_SEARCH_INDEX_DEFERRALS = 3;

const elapsedMs = (startedAt: number) =>
  Math.round(performance.now() - startedAt);

export class DatabaseMaintenance {
  private readonly settings: MaintenanceSettings;
  private cancelTicks: (() => void) | null = null;
  private hooks: MaintenanceStartOptions | null = null;
  private connection: SqliteDatabase | null = null;
  private disposed = false;
  private idleStreak = 0;
  private bootDone = false;
  private analyzeDone = false;
  private sweepDrained = false;
  private sweepCursor: string | null = null;
  private reclaimDone = false;
  private reclaimDisabled = false;
  private reclaimReady = false;
  private reclaimRunning = false;
  private detachedDeferrals = 0;
  private searchIndexDone = false;
  private searchIndexPending = false;
  private searchIndexRunning = false;
  private searchIndexDisabled = false;
  private searchIndexDeferrals = 0;
  private readonly loggedSkips = new Set<string>();

  constructor(private readonly options: DatabaseMaintenanceOptions) {
    this.settings = { ...MAINTENANCE_DEFAULTS, ...stripUndefined(options) };
  }

  private get logger(): MaintenanceLogger | null {
    return this.options.logger === undefined
      ? getFileLogger()
      : this.options.logger;
  }

  start(hooks: MaintenanceStartOptions): void {
    if (this.disposed || this.cancelTicks) return;
    this.hooks = hooks;
    this.cancelTicks = forkFixedRateFiber(this.settings.intervalMs, () =>
      this.runIdleTick(),
    );
  }

  /**
   * True while the search-index build or the reclaim is running, or either
   * is pending and waiting for the detached window. This is the lifecycle's
   * idle-shutdown keep-alive (`shouldKeepAlive`), so it
   * keeps the process up after the last client detaches until later ticks
   * have run them. (Both are synchronous, so no timer can fire during them.)
   */
  holdsWorkerAlive(): boolean {
    if (this.reclaimRunning || this.searchIndexRunning) return true;
    if (
      !this.disposed &&
      this.hooks &&
      this.searchIndexPending &&
      !this.searchIndexDone &&
      !this.searchIndexDisabled &&
      safeCount(this.hooks.attachedClientCount) === 0
    ) {
      return true;
    }
    if (
      this.disposed ||
      !this.hooks ||
      !this.reclaimReady ||
      this.reclaimDone ||
      this.reclaimDisabled ||
      reclaimKillSwitchEngaged()
    ) {
      return false;
    }
    return safeCount(this.hooks.attachedClientCount) === 0;
  }

  stop(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelTicks?.();
    this.cancelTicks = null;
    try {
      this.connection?.close();
    } catch {
      /* already closed */
    }
    this.connection = null;
    const startedAt = performance.now();
    try {
      const ran = optimizeConnection(this.options.db, "close", {
        analysisLimit: this.settings.analysisLimit,
      });
      this.logger?.process("storage.maintenance.optimize", {
        phase: "close",
        busy: !ran,
        ms: elapsedMs(startedAt),
      });
    } catch (error) {
      this.logger?.warn("storage.maintenance.optimize-failed", {
        phase: "close",
        error: (error as Error)?.message ?? String(error),
      });
    }
  }

  runIdleTick(): void {
    if (this.disposed || !this.hooks) return;
    let idle = false;
    try {
      idle = this.hooks.isIdle();
    } catch {
      idle = false;
    }
    if (!idle) {
      this.idleStreak = 0;
      return;
    }
    this.idleStreak += 1;
    try {
      this.runIdleStep();
    } catch (error) {
      if (isSqliteBusyError(error)) {
        this.logOnce("busy", "storage.maintenance.deferred", {
          reason: "busy",
        });
        return;
      }
      this.logger?.warn("storage.maintenance.failed", {
        error: (error as Error)?.message ?? String(error),
      });
    }
  }

  private maintenanceConnection(): SqliteDatabase {
    if (!this.connection) {
      const connection = (this.options.openConnection ?? openSqliteConnection)(
        this.options.databasePath,
      );
      connection.exec(
        `PRAGMA busy_timeout = ${this.settings.busyTimeoutMs}; PRAGMA temp_store = FILE;`,
      );
      this.connection = connection;
    }
    return this.connection;
  }

  private runIdleStep(): void {
    const connection = this.maintenanceConnection();
    const { databasePath } = this.options;

    if (!this.bootDone) {
      this.bootDone = true;
      const health = readDatabaseHealth(connection, databasePath);
      this.logger?.process("storage.maintenance.health", { ...health });
      const startedAt = performance.now();
      const ran = optimizeConnection(this.options.db, "boot", {
        analysisLimit: this.settings.analysisLimit,
      });
      this.logger?.process("storage.maintenance.optimize", {
        phase: "boot",
        busy: !ran,
        ms: elapsedMs(startedAt),
      });
    }

    this.checkpoint(connection);
    this.sweepLegacyRunEvents(connection);

    if (
      !this.analyzeDone &&
      this.idleStreak >= this.settings.analyzeIdleTicks
    ) {
      const startedAt = performance.now();
      const ran = withBusyTimeout(connection, this.settings.busyTimeoutMs, () =>
        analyzeOncePerSchemaVersion(connection, this.settings.analysisLimit),
      );
      this.analyzeDone = true;
      if (ran) {
        this.logger?.process("storage.maintenance.analyze", {
          schemaVersion: SCHEMA_VERSION,
          ms: elapsedMs(startedAt),
        });
        return;
      }
    }

    const searchIndex = this.searchIndexStep(connection);

    // Readiness is evaluated on every idle tick (cheap: pragmas + statfs)
    // so the idle-shutdown hold is already in place when Electron quits;
    // the VACUUM itself only runs detached (see reclaim()), and not on a
    // tick that built the index or while the index is still pending.
    if (this.sweepDrained && !this.reclaimDone && !this.reclaimDisabled) {
      this.reclaim(connection, searchIndex === "settled");
    }
  }

  private searchIndexStep(
    connection: SqliteDatabase,
  ): "settled" | "waiting" | "ran" {
    if (this.searchIndexDone || this.searchIndexDisabled) return "settled";
    if (searchTextIndexExists(connection)) {
      this.searchIndexDone = true;
      this.searchIndexPending = false;
      return "settled";
    }
    this.searchIndexPending = true;
    if (!this.isDetached()) {
      this.logOnce(
        "search-index-waiting",
        "storage.maintenance.search-index-waiting",
        { reason: "clients-attached" },
      );
      return "waiting";
    }
    if (this.idleStreak < this.settings.reclaimIdleTicks) return "waiting";
    let outcome: SearchIndexOutcome;
    this.searchIndexRunning = true;
    const startedAt = performance.now();
    try {
      outcome = buildSearchTextIndex(connection, {
        busyTimeoutMs: this.settings.busyTimeoutMs,
        analysisLimit: this.settings.analysisLimit,
        ...(this.options.createSearchIndex
          ? { create: this.options.createSearchIndex }
          : {}),
      });
    } catch (error) {
      this.searchIndexDisabled = true;
      this.logger?.warn("storage.maintenance.search-index-failed", {
        error: (error as Error)?.message ?? String(error),
        ms: elapsedMs(startedAt),
      });
      return "ran";
    } finally {
      this.searchIndexRunning = false;
    }
    switch (outcome.status) {
      case "present":
        this.searchIndexDone = true;
        this.searchIndexPending = false;
        return "settled";
      case "built":
        this.searchIndexDone = true;
        this.searchIndexPending = false;
        this.logger?.process("storage.maintenance.search-index", {
          index: SEARCH_TEXT_INDEX_NAME,
          indexBytes: outcome.indexBytes,
          ms: outcome.ms,
        });
        return "ran";
      case "deferred":
        this.searchIndexDeferrals += 1;
        if (this.searchIndexDeferrals >= MAX_DETACHED_SEARCH_INDEX_DEFERRALS) {
          this.searchIndexDisabled = true;
        }
        this.logOnce("deferred:search-index", "storage.maintenance.deferred", {
          step: "search-index",
          reason: outcome.reason,
        });
        return "ran";
    }
  }

  private checkpoint(connection: SqliteDatabase): void {
    const walPath = walPathFor(this.options.databasePath);
    const walBytesBefore = fileSize(walPath);
    if (walBytesBefore === 0) return;
    if (walBytesBefore < this.settings.walTruncateBytes) {
      checkpointWal(connection, "PASSIVE");
      return;
    }
    const startedAt = performance.now();
    const result = withBusyTimeout(
      connection,
      this.settings.checkpointBusyTimeoutMs,
      () => checkpointWal(connection, "TRUNCATE"),
    );
    this.logger?.process("storage.maintenance.checkpoint", {
      mode: result.mode,
      busy: result.busy,
      walBytesBefore,
      walBytesAfter: fileSize(walPath),
      fileBytes: fileSize(this.options.databasePath),
      ms: elapsedMs(startedAt),
    });
  }

  private sweepLegacyRunEvents(connection: SqliteDatabase): void {
    if (this.sweepDrained) return;
    if (readMeta(connection, MAINTENANCE_META_KEYS.runEventSweepDrained) !== null) {
      this.sweepDrained = true;
      return;
    }
    const now = this.options.now ?? (() => performance.now());
    const budgetMs = this.isDetached()
      ? this.settings.sweepDetachedBudgetMs
      : this.settings.sweepBudgetMs;
    const startedAt = now();
    let deleted = 0;
    let batches = 0;
    for (;;) {
      const fromConversationId = this.sweepCursor;
      const batch = deleteLegacyRunEventBatch(connection, {
        fromConversationId,
        ...(this.options.sweepBatchSize
          ? { batchSize: this.options.sweepBatchSize }
          : {}),
      });
      this.sweepCursor = batch.resumeFrom;
      deleted += batch.deleted;
      batches += 1;
      if (batch.resumeFrom === null && fromConversationId === null) {
        writeMeta(
          connection,
          MAINTENANCE_META_KEYS.runEventSweepDrained,
          String(Date.now()),
        );
        this.sweepDrained = true;
        break;
      }
      if (now() - startedAt >= budgetMs) break;
      if (!this.stillIdle()) break;
    }
    if (deleted > 0) {
      this.logger?.process("storage.maintenance.run-event-sweep", {
        deleted,
        batches,
        budgetMs,
        drained: this.sweepDrained,
        ms: Math.round(now() - startedAt),
      });
    }
    if (this.sweepDrained) {
      this.logger?.process("storage.maintenance.run-event-sweep-drained", {});
    }
  }

  private isDetached(): boolean {
    return !!this.hooks && safeCount(this.hooks.attachedClientCount) === 0;
  }

  private stillIdle(): boolean {
    try {
      return this.hooks?.isIdle() ?? false;
    } catch {
      return false;
    }
  }

  private reclaimPolicy(): ReclaimPolicy {
    return {
      minFreelistBytes: this.settings.reclaimMinFreelistBytes,
      minFreelistRatio: this.settings.reclaimMinFreelistRatio,
      diskHeadroomBytes: this.settings.reclaimDiskHeadroomBytes,
      busyTimeoutMs: this.settings.busyTimeoutMs,
      checkpointBusyTimeoutMs: this.settings.checkpointBusyTimeoutMs,
      diskSpace: this.options.diskSpace ?? defaultDiskSpaceProbe,
      tempDirectory: this.options.tempDirectory ?? sqliteTempDirectory(),
      ...(this.options.vacuum ? { vacuum: this.options.vacuum } : {}),
    };
  }

  private reclaim(connection: SqliteDatabase, mayRun: boolean): void {
    if (reclaimKillSwitchEngaged()) {
      this.reclaimReady = false;
      this.logOnce("kill-switch", "storage.maintenance.reclaim-skipped", {
        reason: "STELLA_DB_RECLAIM=0",
      });
      return;
    }
    const policy = this.reclaimPolicy();
    const evaluation = evaluateReclaim(
      connection,
      this.options.databasePath,
      policy,
    );
    if (evaluation.ready !== true) {
      this.reclaimReady = false;
      this.handleOutcome(evaluation, 0);
      return;
    }
    // The detached window: with a client attached, a multi-minute
    // synchronous VACUUM would stall its messages and fail other
    // processes' writes. Wait (and keep the worker alive) for zero clients.
    this.reclaimReady = true;
    if (!this.isDetached()) {
      this.logOnce("waiting-for-detach", "storage.maintenance.reclaim-waiting", {
        reason: "clients-attached",
        freelistBytes: evaluation.health.freelistBytes,
      });
      return;
    }
    // No attached client to protect, so no long streak: the default of one
    // idle tick keeps the post-quit linger to a single tick.
    if (this.idleStreak < this.settings.reclaimIdleTicks) return;
    if (!mayRun) return;
    const startedAt = performance.now();
    let outcome: ReclaimOutcome;
    this.reclaimRunning = true;
    try {
      outcome = reclaimFreelist(connection, this.options.databasePath, policy);
    } catch (error) {
      this.reclaimDisabled = true;
      this.logger?.warn("storage.maintenance.reclaim-failed", {
        error: (error as Error)?.message ?? String(error),
        ms: elapsedMs(startedAt),
      });
      return;
    } finally {
      this.reclaimRunning = false;
    }
    this.handleOutcome(outcome, elapsedMs(startedAt));
  }

  private handleOutcome(outcome: ReclaimOutcome, ms: number): void {
    switch (outcome.status) {
      case "reclaimed":
        this.reclaimDone = true;
        this.reclaimReady = false;
        this.logger?.process("storage.maintenance.reclaim", {
          fileBytesBefore: outcome.before.fileBytes,
          freelistBytesBefore: outcome.before.freelistBytes,
          fileBytesAfter: outcome.after.fileBytes,
          freelistBytesAfter: outcome.after.freelistBytes,
          walBytesAfter: outcome.after.walBytes,
          vacuumMs: outcome.vacuumMs,
          finalCheckpointBusy: outcome.finalCheckpointBusy,
          ms,
        });
        return;
      case "deferred":
        this.detachedDeferrals += 1;
        if (this.detachedDeferrals >= MAX_DETACHED_RECLAIM_DEFERRALS) {
          this.reclaimDisabled = true;
        }
        this.logOnce(`deferred:${outcome.step}`, "storage.maintenance.deferred", {
          step: outcome.step,
          reason: outcome.reason,
        });
        return;
      case "skipped":
        if (outcome.reason === "already-done") {
          this.reclaimDone = true;
          return;
        }
        if (outcome.reason === "insufficient-disk") {
          this.logOnce(
            "insufficient-disk",
            "storage.maintenance.reclaim-skipped",
            { reason: outcome.reason, ...outcome.detail },
          );
        }
        return;
    }
  }

  private logOnce(
    key: string,
    event: string,
    fields: Record<string, unknown>,
  ): void {
    if (this.loggedSkips.has(key)) return;
    this.loggedSkips.add(key);
    this.logger?.process(event, fields);
  }
}

const safeCount = (count: () => number): number => {
  try {
    const value = count();
    return Number.isFinite(value) ? value : 1;
  } catch {
    return 1;
  }
};

const stripUndefined = (value: object): Partial<MaintenanceSettings> =>
  Object.fromEntries(
    Object.entries(value).filter(
      ([key, entry]) => typeof entry === "number" && key in MAINTENANCE_DEFAULTS,
    ),
  ) as Partial<MaintenanceSettings>;
