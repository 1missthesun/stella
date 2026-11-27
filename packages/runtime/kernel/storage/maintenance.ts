/**
 * SQLite behaviour this maintenance rests on:
 * - The WAL never shrinks on its own; only a TRUNCATE checkpoint shrinks it.
 * - `auto_vacuum = INCREMENTAL` needs a full VACUUM to switch on and only
 *   moves free pages to the end of the file, never defragmenting.
 * - VACUUM holds the write lock for its whole run and bun:sqlite is
 *   synchronous, so it blocks this event loop and fails other processes'
 *   writes past their busy_timeout; it runs only with no client attached.
 * - VACUUM is one write transaction: a SIGKILL before its WAL commit frame
 *   leaves the main file untouched, and its temp database is unlinked on open
 *   (unix) / deleted on close (Windows).
 * - VACUUM time grows with the live bytes: a database whose live data is
 *   small (tens of MiB) vacuums in well under a second, so it can run while
 *   clients are attached once the runtime has been idle a few minutes.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getFileLogger } from "@stella/node-shared/observability/file-logger.js";
import { openSqliteConnection } from "./database.js";
import { forkFixedRateFiber } from "./effect-runtime.js";
import { deleteLegacyRunEventBatch } from "./entry-retention.js";
import { SCHEMA_VERSION } from "@stella/node-shared/storage/schema.js";
import { savedAgeMs } from "@stella/contracts/server-clock";
import type { SqliteDatabase } from "@stella/node-shared/storage/shared.js";

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

export type MaintenanceSettings = {
  intervalMs: number;
  walTruncateBytes: number;
  analyzeIdleTicks: number;
  reclaimIdleTicks: number;
  reclaimAttachedIdleTicks: number;
  reclaimAttachedMaxLiveBytes: number;
  reclaimCooldownMs: number;
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
  reclaimAttachedIdleTicks: 5,
  reclaimAttachedMaxLiveBytes: 64 * MiB,
  reclaimCooldownMs: 24 * 60 * 60_000,
  sweepBudgetMs: 250,
  sweepDetachedBudgetMs: 2_000,
  reclaimMinFreelistBytes: 32 * MiB,
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
      reason: "recently-done" | "below-threshold" | "insufficient-disk";
      detail: Record<string, unknown>;
    };

export type ReclaimPolicy = {
  minFreelistBytes: number;
  minFreelistRatio: number;
  diskHeadroomBytes: number;
  cooldownMs: number;
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
    } catch {}
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

const lastReclaimAt = (value: string | null): number | null => {
  if (value === null) return null;
  try {
    const at = (JSON.parse(value) as { at?: unknown } | null)?.at;
    return typeof at === "number" && Number.isFinite(at) ? at : null;
  } catch {
    return null;
  }
};

export const evaluateReclaim = (
  connection: SqliteDatabase,
  databasePath: string,
  policy: ReclaimPolicy,
): { ready: true; health: DatabaseHealth } | (ReclaimOutcome & { ready?: false }) => {
  const lastAt = lastReclaimAt(readMeta(connection, MAINTENANCE_META_KEYS.freelistReclaimed));
  if (lastAt !== null && savedAgeMs(lastAt) < policy.cooldownMs) {
    return { status: "skipped", reason: "recently-done", detail: { lastAt } };
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
  private reclaimDisabled = false;
  private reclaimReady = false;
  private reclaimRunning = false;
  private detachedDeferrals = 0;
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

  holdsWorkerAlive(): boolean {
    if (this.reclaimRunning) return true;
    if (
      this.disposed ||
      !this.hooks ||
      !this.reclaimReady ||
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
    } catch {}
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

    if (this.sweepDrained && !this.reclaimDisabled) {
      this.reclaim(connection);
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
      cooldownMs: this.settings.reclaimCooldownMs,
      busyTimeoutMs: this.settings.busyTimeoutMs,
      checkpointBusyTimeoutMs: this.settings.checkpointBusyTimeoutMs,
      diskSpace: this.options.diskSpace ?? defaultDiskSpaceProbe,
      tempDirectory: this.options.tempDirectory ?? sqliteTempDirectory(),
      ...(this.options.vacuum ? { vacuum: this.options.vacuum } : {}),
    };
  }

  private reclaim(connection: SqliteDatabase): void {
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
    this.reclaimReady = true;
    if (this.isDetached()) {
      if (this.idleStreak < this.settings.reclaimIdleTicks) return;
    } else {
      if (evaluation.health.liveBytes > this.settings.reclaimAttachedMaxLiveBytes) {
        this.logOnce("waiting-for-detach", "storage.maintenance.reclaim-waiting", {
          reason: "clients-attached",
          liveBytes: evaluation.health.liveBytes,
          freelistBytes: evaluation.health.freelistBytes,
        });
        return;
      }
      if (this.idleStreak < this.settings.reclaimAttachedIdleTicks) return;
    }
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
