import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { BackendRequestError } from "@stella/contracts/backend/client";
import {
  CLAUDE_SESSION_CHAIN_GENESIS,
  CLAUDE_SESSION_CHUNK_MAX_BYTES,
  CLAUDE_SESSION_CONFLICT_REASON,
  CLAUDE_SESSION_STALE_LEASE_REASON,
  claudeSessionChainInput,
  claudeSessionFileMode,
  isClaudeSessionFilePath,
  isClaudeSessionId,
  type ClaudeSessionAppendArgs,
  type ClaudeSessionCalls,
  type ClaudeSessionEngine,
  type ClaudeSessionFileHead,
  type ClaudeSessionManifest,
  type ClaudeSessionSyncTag,
} from "@stella/contracts/backend/claude-sessions";
import { createRuntimeLogger } from "../debug.js";
import {
  claudeCliCanResume,
  claudeCliVersion,
  claudeSessionFileAbsolutePath,
  claudeSessionProjectDir,
  claudeSessionReplyHashes,
  listClaudeSessionFiles,
  resolveClaudeWorkingFolder,
  writeFileAtomically,
} from "../integrations/claude-code-session-files.js";
import type {
  ClaudeSessionCheckpoint,
  ClaudeSessionSyncSink,
  RestoredClaudeSession,
} from "../integrations/claude-code-session-sync-sink.js";
import type { SqliteDatabase } from "../storage/shared.js";
import { forkDelayedCall, raceWithTimeoutError } from "./cloud-effect-runtime.js";
import { resolveJwtOwnerScope } from "./computer-agent-cloud-records.js";

const REQUEST_TIMEOUT_MS = 60_000;
const STEP_DEBOUNCE_MS = 400;
const FINAL_RECHECK_MS = 1_500;
const NO_AUTH_RETRY_MS = 5_000;
const BASE_RETRY_MS = 1_000;
const MAX_RETRY_MS = 5 * 60_000;
const MAX_ATTEMPTS_BEFORE_PARK = 40;
const REPLACE_MODE_MAX_BYTES = 32 * 1024 * 1024;

export type ClaudeSessionSyncBackend = {
  append(args: ClaudeSessionAppendArgs): Promise<ClaudeSessionFileHead>;
  tag(args: ClaudeSessionSyncTag): Promise<unknown>;
  latest(args: { threadId: string }): Promise<ClaudeSessionManifest | null>;
  readChunk(
    args: ClaudeSessionCalls["claudeSessions.readChunk"]["args"],
  ): Promise<ClaudeSessionCalls["claudeSessions.readChunk"]["result"]>;
};

export type ClaudeSessionRestoreResult = {
  threadId: string;
  sessionId: string;
  engine: ClaudeSessionEngine;
  conversationId: string;
  projectDir: string;
  workingFolder: string;
  files: number;
  bytes: number;
  keptLocalFiles: number;
  originDeviceId: string;
  originCwd: string;
  cliVersion: string;
  localCliVersion: string;
  cliCompatible: boolean;
  journalCursor?: string;
  journalSeq?: number;
  syncedAt: number;
};

export type ClaudeSessionSync = ClaudeSessionSyncSink & {
  resume(): void;
  stop(): void;
  pending(): number;
  flush(timeoutMs?: number): Promise<boolean>;
  restore(args: {
    threadId: string;
    configDir: string | null;
    cwd: string;
  }): Promise<ClaudeSessionRestoreResult | null>;
};

type SessionRow = {
  threadId: string;
  sessionId: string;
  conversationId: string;
  engine: ClaudeSessionEngine;
  configDir: string | null;
  cwd: string;
  journalCursor: string | null;
  journalSeq: number | null;
  leaseEpoch: number | null;
  dirty: number;
  tagDirty: number;
  attempts: number;
  nextAttemptAt: number;
};

type FileState = {
  generation: number;
  ackedLength: number;
  ackedChain: string;
  contentSha256: string | null;
  pendingEnd: number | null;
};

type RestoreRecord = {
  replyHashes: string[];
  cliVersion: string;
};

class ClaudeSessionDivergedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaudeSessionDivergedError";
  }
}

const sha256Hex = (value: Uint8Array | string): string =>
  crypto.createHash("sha256").update(value).digest("hex");

const asEngine = (value: unknown): ClaudeSessionEngine =>
  value === "claude_code_local_vanilla"
    ? "claude_code_local_vanilla"
    : "claude_code_local";

const SESSION_COLUMNS = `
  thread_id AS threadId,
  session_id AS sessionId,
  conversation_id AS conversationId,
  engine,
  config_dir AS configDir,
  cwd,
  journal_cursor AS journalCursor,
  journal_seq AS journalSeq,
  lease_epoch AS leaseEpoch,
  dirty,
  tag_dirty AS tagDirty,
  attempts,
  next_attempt_at AS nextAttemptAt`;

class ClaudeSessionSyncRepo {
  constructor(private readonly db: SqliteDatabase) {}

  noteCheckpoint(
    checkpoint: ClaudeSessionCheckpoint,
    ownerScope: string,
    now: number,
  ): void {
    this.db
      .prepare(
        `INSERT INTO claude_session_sync_sessions (
           thread_id, session_id, conversation_id, engine, config_dir, cwd,
           owner_scope, journal_cursor, journal_seq, lease_epoch, state, dirty,
           tag_dirty, resume_pending, attempts, next_attempt_at, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, 1, 0, 0, ?, ?, ?)
         ON CONFLICT(thread_id, session_id) DO UPDATE SET
           conversation_id = excluded.conversation_id,
           engine = excluded.engine,
           config_dir = excluded.config_dir,
           cwd = excluded.cwd,
           owner_scope = excluded.owner_scope,
           tag_dirty = claude_session_sync_sessions.tag_dirty + (CASE
             WHEN COALESCE(excluded.journal_cursor, '') <> COALESCE(claude_session_sync_sessions.journal_cursor, '')
               OR COALESCE(excluded.journal_seq, -2) <> COALESCE(claude_session_sync_sessions.journal_seq, -2)
               OR COALESCE(excluded.lease_epoch, -2) <> COALESCE(claude_session_sync_sessions.lease_epoch, -2)
             THEN 1 ELSE 0 END),
           journal_cursor = COALESCE(excluded.journal_cursor, claude_session_sync_sessions.journal_cursor),
           journal_seq = COALESCE(excluded.journal_seq, claude_session_sync_sessions.journal_seq),
           lease_epoch = COALESCE(excluded.lease_epoch, claude_session_sync_sessions.lease_epoch),
           dirty = claude_session_sync_sessions.dirty + 1,
           next_attempt_at = CASE
             WHEN claude_session_sync_sessions.attempts = 0
             THEN MIN(claude_session_sync_sessions.next_attempt_at, excluded.next_attempt_at)
             ELSE claude_session_sync_sessions.next_attempt_at END,
           updated_at = excluded.updated_at`,
      )
      .run(
        checkpoint.threadId,
        checkpoint.sessionId,
        checkpoint.conversationId,
        checkpoint.engine,
        checkpoint.configDir,
        checkpoint.cwd,
        ownerScope,
        checkpoint.journalCursor ?? null,
        checkpoint.journalSeq ?? null,
        checkpoint.leaseEpoch ?? null,
        now,
        now,
        now,
      );
  }

  listPending(ownerScope: string, limit: number): SessionRow[] {
    return (
      this.db
        .prepare(
          `SELECT ${SESSION_COLUMNS} FROM claude_session_sync_sessions
            WHERE owner_scope = ? AND state = 'active' AND (dirty > 0 OR tag_dirty > 0)
            ORDER BY next_attempt_at ASC, updated_at ASC
            LIMIT ?`,
        )
        .all(ownerScope, limit) as SessionRow[]
    ).map((row) => ({ ...row, engine: asEngine(row.engine) }));
  }

  countPending(): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS count FROM claude_session_sync_sessions
          WHERE state = 'active' AND (dirty > 0 OR tag_dirty > 0)`,
      )
      .get() as { count?: number } | undefined;
    return row?.count ?? 0;
  }

  markSynced(row: SessionRow, now: number): void {
    this.db
      .prepare(
        `UPDATE claude_session_sync_sessions
            SET dirty = CASE WHEN dirty = ? THEN 0 ELSE dirty END,
                tag_dirty = CASE WHEN tag_dirty = ? THEN 0 ELSE tag_dirty END,
                attempts = 0,
                last_error = NULL,
                next_attempt_at = ?,
                updated_at = ?
          WHERE thread_id = ? AND session_id = ?`,
      )
      .run(row.dirty, row.tagDirty, now, now, row.threadId, row.sessionId);
  }

  markRetry(row: SessionRow, error: string, nextAttemptAt: number, now: number): void {
    this.db
      .prepare(
        `UPDATE claude_session_sync_sessions
            SET attempts = attempts + 1,
                last_error = ?,
                next_attempt_at = ?,
                state = CASE WHEN attempts + 1 >= ? THEN 'parked' ELSE state END,
                updated_at = ?
          WHERE thread_id = ? AND session_id = ?`,
      )
      .run(
        error.slice(0, 2_000),
        nextAttemptAt,
        MAX_ATTEMPTS_BEFORE_PARK,
        now,
        row.threadId,
        row.sessionId,
      );
  }

  markDiverged(row: SessionRow, error: string, now: number): void {
    this.db
      .prepare(
        `UPDATE claude_session_sync_sessions
            SET state = 'diverged', last_error = ?, updated_at = ?
          WHERE thread_id = ? AND session_id = ?`,
      )
      .run(error.slice(0, 2_000), now, row.threadId, row.sessionId);
  }

  resumeScope(ownerScope: string, now: number): void {
    this.db
      .prepare(
        `UPDATE claude_session_sync_sessions
            SET state = CASE WHEN state = 'parked' THEN 'active' ELSE state END,
                attempts = CASE WHEN state = 'parked' THEN 0 ELSE attempts END,
                next_attempt_at = MIN(next_attempt_at, ?)
          WHERE owner_scope = ? AND (dirty > 0 OR tag_dirty > 0)`,
      )
      .run(now, ownerScope);
  }

  getFile(threadId: string, sessionId: string, path: string): FileState | null {
    const row = this.db
      .prepare(
        `SELECT generation, acked_length AS ackedLength, acked_chain AS ackedChain,
                content_sha256 AS contentSha256, pending_end AS pendingEnd
           FROM claude_session_sync_files
          WHERE thread_id = ? AND session_id = ? AND path = ?`,
      )
      .get(threadId, sessionId, path) as FileState | undefined;
    return row ?? null;
  }

  putFile(threadId: string, sessionId: string, path: string, state: FileState): void {
    this.db
      .prepare(
        `INSERT INTO claude_session_sync_files (
           thread_id, session_id, path, generation, acked_length, acked_chain,
           content_sha256, pending_end, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(thread_id, session_id, path) DO UPDATE SET
           generation = excluded.generation,
           acked_length = excluded.acked_length,
           acked_chain = excluded.acked_chain,
           content_sha256 = excluded.content_sha256,
           pending_end = excluded.pending_end,
           updated_at = excluded.updated_at`,
      )
      .run(
        threadId,
        sessionId,
        path,
        state.generation,
        state.ackedLength,
        state.ackedChain,
        state.contentSha256,
        state.pendingEnd,
        Date.now(),
      );
  }

  recordRestore(args: {
    manifest: ClaudeSessionManifest;
    ownerScope: string;
    configDir: string | null;
    cwd: string;
    dirty: boolean;
    record: RestoreRecord;
    now: number;
  }): void {
    const { manifest } = args;
    this.db
      .prepare(
        `INSERT INTO claude_session_sync_sessions (
           thread_id, session_id, conversation_id, engine, config_dir, cwd,
           owner_scope, journal_cursor, journal_seq, lease_epoch, state, dirty,
           tag_dirty, resume_pending, reply_hashes_json, attempts, next_attempt_at,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 0, 1, ?, 0, ?, ?, ?)
         ON CONFLICT(thread_id, session_id) DO UPDATE SET
           conversation_id = excluded.conversation_id,
           engine = excluded.engine,
           config_dir = excluded.config_dir,
           cwd = excluded.cwd,
           owner_scope = excluded.owner_scope,
           journal_cursor = excluded.journal_cursor,
           journal_seq = excluded.journal_seq,
           lease_epoch = excluded.lease_epoch,
           state = 'active',
           dirty = excluded.dirty,
           tag_dirty = 0,
           resume_pending = 1,
           reply_hashes_json = excluded.reply_hashes_json,
           attempts = 0,
           last_error = NULL,
           next_attempt_at = excluded.next_attempt_at,
           updated_at = excluded.updated_at`,
      )
      .run(
        manifest.threadId,
        manifest.sessionId,
        manifest.conversationId,
        manifest.engine,
        args.configDir,
        args.cwd,
        args.ownerScope,
        manifest.journalCursor ?? null,
        manifest.journalSeq ?? null,
        manifest.leaseEpoch ?? null,
        args.dirty ? 1 : 0,
        JSON.stringify(args.record),
        args.now,
        args.now,
        args.now,
      );
  }

  takeRestored(
    threadId: string,
    engine: ClaudeSessionEngine,
  ): (RestoreRecord & { sessionId: string; cwd: string }) | null {
    const row = this.db
      .prepare(
        `SELECT session_id AS sessionId, cwd, reply_hashes_json AS recordJson
           FROM claude_session_sync_sessions
          WHERE thread_id = ? AND engine = ? AND resume_pending = 1
          ORDER BY updated_at DESC
          LIMIT 1`,
      )
      .get(threadId, engine) as
      | { sessionId: string; cwd: string; recordJson: string | null }
      | undefined;
    if (!row) return null;
    let record: RestoreRecord = { replyHashes: [], cliVersion: "unknown" };
    try {
      const parsed = JSON.parse(row.recordJson ?? "{}") as Partial<RestoreRecord>;
      record = {
        replyHashes: Array.isArray(parsed.replyHashes)
          ? parsed.replyHashes.filter((hash): hash is string => typeof hash === "string")
          : [],
        cliVersion: typeof parsed.cliVersion === "string" ? parsed.cliVersion : "unknown",
      };
    } catch {
      record = { replyHashes: [], cliVersion: "unknown" };
    }
    return { sessionId: row.sessionId, cwd: row.cwd, ...record };
  }

  consumeRestored(threadId: string, sessionId: string): void {
    this.db
      .prepare(
        `UPDATE claude_session_sync_sessions
            SET resume_pending = 0, updated_at = ?
          WHERE thread_id = ? AND session_id = ?`,
      )
      .run(Date.now(), threadId, sessionId);
  }
}

const retryDelay = (attempts: number): number =>
  Math.min(MAX_RETRY_MS, BASE_RETRY_MS * 2 ** Math.min(attempts, 9));

const errorMessage = (error: unknown): string =>
  error instanceof Error && error.message.trim()
    ? error.message.trim()
    : String(error);

const isDivergence = (error: unknown): boolean =>
  error instanceof ClaudeSessionDivergedError ||
  (error instanceof BackendRequestError &&
    (error.reason === CLAUDE_SESSION_CONFLICT_REASON ||
      error.reason === CLAUDE_SESSION_STALE_LEASE_REASON));

const withTimeout = <T>(promise: Promise<T>): Promise<T> =>
  raceWithTimeoutError(
    promise,
    REQUEST_TIMEOUT_MS,
    () => new Error("Stella's cloud did not answer the session sync within 60s."),
  );

const readRange = async (
  handle: FileHandle,
  start: number,
  end: number,
): Promise<Uint8Array> => {
  const buffer = Buffer.alloc(end - start);
  let filled = 0;
  while (filled < buffer.length) {
    const { bytesRead } = await handle.read(buffer, filled, buffer.length - filled, start + filled);
    if (bytesRead === 0) break;
    filled += bytesRead;
  }
  return buffer.subarray(0, filled);
};

const appendChunkEnd = async (
  handle: FileHandle,
  start: number,
  size: number,
): Promise<number> => {
  const window = await readRange(handle, start, Math.min(size, start + CLAUDE_SESSION_CHUNK_MAX_BYTES));
  const newline = window.lastIndexOf(0x0a);
  if (newline >= 0) return start + newline + 1;
  if (start + window.length >= size) return start;
  return start + window.length;
};

export const createClaudeSessionSync = (options: {
  deviceId: string;
  db: SqliteDatabase;
  getAuthToken: () => string | null;
  getBackend: () => ClaudeSessionSyncBackend | null;
}): ClaudeSessionSync => {
  const logger = createRuntimeLogger("claude-session-sync");
  const repo = new ClaudeSessionSyncRepo(options.db);
  let stopped = false;
  let cancelScheduled: (() => void) | null = null;
  let scheduledAt = Number.POSITIVE_INFINITY;
  let activeDrain: Promise<void> | null = null;

  const ownerScope = (): string | null =>
    resolveJwtOwnerScope(options.getAuthToken());

  const scheduleDrain = (delayMs: number): void => {
    if (stopped) return;
    const at = Date.now() + Math.max(0, delayMs);
    if (cancelScheduled && scheduledAt <= at) return;
    cancelScheduled?.();
    scheduledAt = at;
    cancelScheduled = forkDelayedCall(Math.max(0, delayMs), () => {
      cancelScheduled = null;
      scheduledAt = Number.POSITIVE_INFINITY;
      void drain();
    });
  };

  const tagOf = async (row: SessionRow): Promise<ClaudeSessionSyncTag> => ({
    threadId: row.threadId,
    conversationId: row.conversationId,
    sessionId: row.sessionId,
    deviceId: options.deviceId,
    cliVersion: await claudeCliVersion(),
    engine: row.engine,
    originCwd: row.cwd,
    ...(row.journalCursor ? { journalCursor: row.journalCursor } : {}),
    ...(row.journalSeq !== null ? { journalSeq: row.journalSeq } : {}),
    ...(row.leaseEpoch !== null ? { leaseEpoch: row.leaseEpoch } : {}),
  });

  const uploadChunk = async (args: {
    backend: ClaudeSessionSyncBackend;
    tag: ClaudeSessionSyncTag;
    path: string;
    state: FileState;
    bytes: Uint8Array;
  }): Promise<string> => {
    const sha256 = sha256Hex(args.bytes);
    const chain = sha256Hex(claudeSessionChainInput(args.state.ackedChain, sha256));
    const head = await withTimeout(
      args.backend.append({
        ...args.tag,
        path: args.path,
        generation: args.state.generation,
        offset: args.state.ackedLength,
        prevChain: args.state.ackedChain,
        sha256,
        chain,
        data: Buffer.from(args.bytes).toString("base64"),
      }),
    );
    if (head.chain !== chain || head.length !== args.state.ackedLength + args.bytes.length) {
      throw new ClaudeSessionDivergedError("The cloud acknowledged a different session state.");
    }
    return chain;
  };

  const syncFile = async (args: {
    backend: ClaudeSessionSyncBackend;
    row: SessionRow;
    tag: ClaudeSessionSyncTag;
    projectDir: string;
    path: string;
  }): Promise<void> => {
    const { row, path } = args;
    const absolute = claudeSessionFileAbsolutePath(args.projectDir, path);
    let handle: FileHandle;
    try {
      handle = await fs.open(absolute, "r");
    } catch {
      return;
    }
    try {
      const size = (await handle.stat()).size;
      if (size === 0) return;
      let state: FileState = repo.getFile(row.threadId, row.sessionId, path) ?? {
        generation: 1,
        ackedLength: 0,
        ackedChain: CLAUDE_SESSION_CHAIN_GENESIS,
        contentSha256: null,
        pendingEnd: null,
      };
      const save = () => repo.putFile(row.threadId, row.sessionId, path, state);
      if (claudeSessionFileMode(path) === "append") {
        if (size < state.ackedLength) {
          state = {
            generation: state.generation + 1,
            ackedLength: 0,
            ackedChain: CLAUDE_SESSION_CHAIN_GENESIS,
            contentSha256: null,
            pendingEnd: null,
          };
          save();
        }
        while (!stopped && state.ackedLength < size) {
          const end =
            state.pendingEnd !== null &&
            state.pendingEnd > state.ackedLength &&
            state.pendingEnd <= size
              ? state.pendingEnd
              : await appendChunkEnd(handle, state.ackedLength, size);
          if (end <= state.ackedLength) break;
          if (state.pendingEnd !== end) {
            state = { ...state, pendingEnd: end };
            save();
          }
          const bytes = await readRange(handle, state.ackedLength, end);
          const chain = await uploadChunk({ ...args, state, bytes });
          state = { ...state, ackedLength: end, ackedChain: chain, pendingEnd: null };
          save();
        }
        return;
      }
      if (size > REPLACE_MODE_MAX_BYTES) return;
      const content = await readRange(handle, 0, size);
      const contentSha256 = sha256Hex(content);
      if (state.contentSha256 === contentSha256 && state.ackedLength === content.length) return;
      if (state.contentSha256 !== contentSha256) {
        state = {
          generation:
            state.ackedLength > 0 || state.contentSha256 !== null
              ? state.generation + 1
              : state.generation,
          ackedLength: 0,
          ackedChain: CLAUDE_SESSION_CHAIN_GENESIS,
          contentSha256,
          pendingEnd: null,
        };
        save();
      }
      while (!stopped && state.ackedLength < content.length) {
        const end = Math.min(content.length, state.ackedLength + CLAUDE_SESSION_CHUNK_MAX_BYTES);
        const chain = await uploadChunk({
          ...args,
          state,
          bytes: content.subarray(state.ackedLength, end),
        });
        state = { ...state, ackedLength: end, ackedChain: chain, pendingEnd: null };
        save();
      }
    } finally {
      await handle.close().catch(() => undefined);
    }
  };

  const syncSession = async (
    row: SessionRow,
    backend: ClaudeSessionSyncBackend,
  ): Promise<void> => {
    if (!isClaudeSessionId(row.sessionId)) {
      throw new ClaudeSessionDivergedError("The session id can't be synced.");
    }
    const workingFolder = await resolveClaudeWorkingFolder(row.cwd);
    const projectDir = claudeSessionProjectDir(row.configDir, workingFolder);
    const files = await listClaudeSessionFiles(projectDir, row.sessionId);
    if (!files.includes(`${row.sessionId}.jsonl`)) return;
    const tag = await tagOf({ ...row, cwd: workingFolder });
    for (const path of files) {
      if (stopped) return;
      await syncFile({ backend, row, tag, projectDir, path });
    }
    if (row.tagDirty > 0 && !stopped) {
      await withTimeout(backend.tag(tag));
    }
  };

  const runDrain = async (): Promise<void> => {
    while (!stopped) {
      const scope = ownerScope();
      const backend = options.getBackend();
      if (!scope || !backend) {
        if (repo.countPending() > 0) scheduleDrain(NO_AUTH_RETRY_MS);
        return;
      }
      const rows = repo.listPending(scope, 64);
      if (rows.length === 0) return;
      const now = Date.now();
      const row = rows.find((candidate) => candidate.nextAttemptAt <= now);
      if (!row) {
        scheduleDrain(Math.min(...rows.map((candidate) => candidate.nextAttemptAt)) - now);
        return;
      }
      try {
        await syncSession(row, backend);
        if (stopped) return;
        repo.markSynced(row, Date.now());
      } catch (error) {
        if (stopped) return;
        const message = errorMessage(error);
        if (isDivergence(error)) {
          repo.markDiverged(row, message, Date.now());
          logger.warn("claude-session-sync.diverged", {
            threadId: row.threadId,
            sessionId: row.sessionId,
            error: message,
          });
          continue;
        }
        const delay = retryDelay(row.attempts);
        repo.markRetry(row, message, Date.now() + delay, Date.now());
        logger.warn("claude-session-sync.retry", {
          threadId: row.threadId,
          sessionId: row.sessionId,
          attempts: row.attempts + 1,
          error: message,
        });
      }
    }
  };

  const drain = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (activeDrain) return activeDrain;
    const running = runDrain()
      .catch((error: unknown) => {
        logger.error("claude-session-sync.drain-failed", { error: errorMessage(error) });
      })
      .finally(() => {
        if (activeDrain === running) activeDrain = null;
      });
    activeDrain = running;
    return running;
  };

  const noteCheckpoint = (checkpoint: ClaudeSessionCheckpoint): void => {
    if (stopped || !isClaudeSessionId(checkpoint.sessionId)) return;
    const scope = ownerScope();
    if (!scope) return;
    try {
      repo.noteCheckpoint(checkpoint, scope, Date.now());
    } catch (error) {
      logger.warn("claude-session-sync.note-failed", { error: errorMessage(error) });
      return;
    }
    scheduleDrain(STEP_DEBOUNCE_MS);
    if (checkpoint.final) {
      forkDelayedCall(FINAL_RECHECK_MS, () =>
        noteCheckpoint({ ...checkpoint, final: false }),
      );
    }
  };

  const downloadFile = async (
    backend: ClaudeSessionSyncBackend,
    manifest: ClaudeSessionManifest,
    file: ClaudeSessionManifest["files"][number],
  ): Promise<Uint8Array> => {
    const parts: Uint8Array[] = [];
    let chain = CLAUDE_SESSION_CHAIN_GENESIS;
    let offset = 0;
    for (const chunk of file.chunks) {
      if (chunk.offset !== offset) {
        throw new Error(`Session file ${file.path} has a gap at ${offset}.`);
      }
      const read = await withTimeout(
        backend.readChunk({
          threadId: manifest.threadId,
          sessionId: manifest.sessionId,
          path: file.path,
          generation: file.generation,
          index: chunk.index,
        }),
      );
      const bytes = new Uint8Array(Buffer.from(read.data, "base64"));
      const sha256 = sha256Hex(bytes);
      if (sha256 !== chunk.sha256 || bytes.length !== chunk.length) {
        throw new Error(`Session file ${file.path} failed its integrity check.`);
      }
      chain = sha256Hex(claudeSessionChainInput(chain, sha256));
      if (chain !== chunk.chain) {
        throw new Error(`Session file ${file.path} broke its hash chain.`);
      }
      parts.push(bytes);
      offset += bytes.length;
    }
    if (offset !== file.length || chain !== file.chain) {
      throw new Error(`Session file ${file.path} is incomplete in the cloud.`);
    }
    return new Uint8Array(Buffer.concat(parts));
  };

  const localCoversCloud = async (
    absolute: string,
    file: ClaudeSessionManifest["files"][number],
  ): Promise<boolean> => {
    let handle: FileHandle;
    try {
      handle = await fs.open(absolute, "r");
    } catch {
      return false;
    }
    try {
      if ((await handle.stat()).size < file.length) return false;
      for (const chunk of file.chunks) {
        const bytes = await readRange(handle, chunk.offset, chunk.offset + chunk.length);
        if (sha256Hex(bytes) !== chunk.sha256) return false;
      }
      return true;
    } finally {
      await handle.close().catch(() => undefined);
    }
  };

  const restore: ClaudeSessionSync["restore"] = async (args) => {
    const scope = ownerScope();
    const backend = options.getBackend();
    if (!scope || !backend) {
      throw new Error("Sign in to Stella to restore a Claude Code session.");
    }
    const manifest = await withTimeout(backend.latest({ threadId: args.threadId }));
    if (!manifest) return null;
    if (!isClaudeSessionId(manifest.sessionId)) {
      throw new Error("The synced session id is malformed.");
    }
    const mainPath = `${manifest.sessionId}.jsonl`;
    const files = manifest.files.filter((file) =>
      isClaudeSessionFilePath(manifest.sessionId, file.path),
    );
    if (!files.some((file) => file.path === mainPath)) {
      throw new Error("The synced session has no transcript yet.");
    }
    await fs.mkdir(args.cwd, { recursive: true });
    const workingFolder = await resolveClaudeWorkingFolder(args.cwd);
    const projectDir = claudeSessionProjectDir(args.configDir, workingFolder);
    const ordered = [
      ...files.filter((file) => file.path !== mainPath),
      ...files.filter((file) => file.path === mainPath),
    ];
    let bytes = 0;
    let keptLocalFiles = 0;
    let mainText = "";
    const seeded: Array<{ path: string; state: FileState }> = [];
    for (const file of ordered) {
      const absolute = claudeSessionFileAbsolutePath(projectDir, file.path);
      const mode = claudeSessionFileMode(file.path);
      if (mode === "append" && (await localCoversCloud(absolute, file))) {
        keptLocalFiles += 1;
        if (file.path === mainPath) mainText = await fs.readFile(absolute, "utf8");
        seeded.push({
          path: file.path,
          state: {
            generation: file.generation,
            ackedLength: file.length,
            ackedChain: file.chain,
            contentSha256: null,
            pendingEnd: null,
          },
        });
        continue;
      }
      const content = await downloadFile(backend, manifest, file);
      try {
        await fs.rename(absolute, `${absolute}.pre-restore-${Date.now()}`);
      } catch {}
      await writeFileAtomically(absolute, content);
      bytes += content.length;
      if (file.path === mainPath) mainText = Buffer.from(content).toString("utf8");
      seeded.push({
        path: file.path,
        state: {
          generation: file.generation,
          ackedLength: file.length,
          ackedChain: file.chain,
          contentSha256: mode === "replace" ? sha256Hex(content) : null,
          pendingEnd: null,
        },
      });
    }
    for (const entry of seeded) {
      repo.putFile(manifest.threadId, manifest.sessionId, entry.path, entry.state);
    }
    repo.recordRestore({
      manifest,
      ownerScope: scope,
      configDir: args.configDir,
      cwd: workingFolder,
      dirty: keptLocalFiles > 0,
      record: {
        replyHashes: claudeSessionReplyHashes(mainText),
        cliVersion: manifest.cliVersion,
      },
      now: Date.now(),
    });
    if (keptLocalFiles > 0) scheduleDrain(0);
    const localCliVersion = await claudeCliVersion();
    logger.info("claude-session-sync.restored", {
      threadId: manifest.threadId,
      sessionId: manifest.sessionId,
      files: ordered.length,
      bytes,
      keptLocalFiles,
    });
    return {
      threadId: manifest.threadId,
      sessionId: manifest.sessionId,
      engine: manifest.engine,
      conversationId: manifest.conversationId,
      projectDir,
      workingFolder,
      files: ordered.length,
      bytes,
      keptLocalFiles,
      originDeviceId: manifest.deviceId,
      originCwd: manifest.originCwd,
      cliVersion: manifest.cliVersion,
      localCliVersion,
      cliCompatible: claudeCliCanResume(localCliVersion, manifest.cliVersion),
      ...(manifest.journalCursor ? { journalCursor: manifest.journalCursor } : {}),
      ...(manifest.journalSeq !== undefined ? { journalSeq: manifest.journalSeq } : {}),
      syncedAt: manifest.updatedAt,
    };
  };

  const takeRestored: ClaudeSessionSyncSink["takeRestored"] = (args) => {
    let record: ReturnType<ClaudeSessionSyncRepo["takeRestored"]>;
    try {
      record = repo.takeRestored(args.threadId, args.engine);
    } catch {
      return null;
    }
    if (!record) return null;
    const restored: RestoredClaudeSession = {
      threadId: args.threadId,
      sessionId: record.sessionId,
      engine: args.engine,
      cwd: record.cwd,
      cliVersion: record.cliVersion,
      replyHashes: new Set(record.replyHashes),
    };
    return restored;
  };

  const pendingCount = (): number => {
    try {
      return repo.countPending();
    } catch {
      return 0;
    }
  };

  const flush: ClaudeSessionSync["flush"] = async (timeoutMs = 60_000) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      await drain();
      if (pendingCount() === 0) return true;
      if (Date.now() >= deadline) return false;
      await new Promise<void>((resolve) => {
        forkDelayedCall(250, resolve);
      });
    }
  };

  return {
    noteCheckpoint,
    takeRestored,
    consumeRestored: ({ threadId, sessionId }) => {
      try {
        repo.consumeRestored(threadId, sessionId);
      } catch (error) {
        logger.warn("claude-session-sync.consume-failed", { error: errorMessage(error) });
      }
    },
    resume: () => {
      stopped = false;
      const scope = ownerScope();
      if (scope) {
        try {
          repo.resumeScope(scope, Date.now());
        } catch {}
      }
      scheduleDrain(0);
    },
    stop: () => {
      stopped = true;
      cancelScheduled?.();
      cancelScheduled = null;
      scheduledAt = Number.POSITIVE_INFINITY;
    },
    pending: pendingCount,
    flush,
    restore,
  };
};
