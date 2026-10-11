import {
  CLAUDE_SESSION_APPEND_MAX_BODY_BYTES,
  CLAUDE_SESSION_CHAIN_GENESIS,
  CLAUDE_SESSION_CHUNK_MAX_BYTES,
  CLAUDE_SESSION_CONFLICT_REASON,
  CLAUDE_SESSION_ENGINES,
  CLAUDE_SESSION_MAX_FILES,
  CLAUDE_SESSION_STALE_LEASE_REASON,
  claudeSessionChainInput,
  isClaudeSessionFilePath,
  isClaudeSessionId,
  type ClaudeSessionAppendArgs,
  type ClaudeSessionCalls,
  type ClaudeSessionFileHead,
  type ClaudeSessionManifest,
  type ClaudeSessionSyncTag,
} from "@stella/contracts/backend/claude-sessions";
import { literal, number, object, optional, string } from "../args.js";
import { RpcError } from "../errors.js";
import { enforceOwnerRateLimit } from "../rate-limit.js";
import type { OwnerContext, OwnerDb, OwnerDomain } from "../registry.js";
import { sha256BytesHex, sha256Hex } from "../../hash.js";

export const CLAUDE_SESSIONS_MIGRATION = {
  id: "claude-sessions.1-init",
  statements: [
    `CREATE TABLE claude_sessions (
       thread_id TEXT NOT NULL,
       session_id TEXT NOT NULL,
       conversation_id TEXT NOT NULL,
       device_id TEXT NOT NULL,
       cli_version TEXT NOT NULL,
       engine TEXT NOT NULL,
       origin_cwd TEXT NOT NULL,
       journal_cursor TEXT,
       journal_seq INTEGER,
       lease_epoch INTEGER,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL,
       PRIMARY KEY (thread_id, session_id)
     )`,
    `CREATE INDEX idx_claude_sessions_thread_updated
       ON claude_sessions(thread_id, updated_at)`,
    `CREATE TABLE claude_session_files (
       thread_id TEXT NOT NULL,
       session_id TEXT NOT NULL,
       path TEXT NOT NULL,
       generation INTEGER NOT NULL,
       length INTEGER NOT NULL,
       chain TEXT NOT NULL,
       chunk_count INTEGER NOT NULL,
       updated_at INTEGER NOT NULL,
       PRIMARY KEY (thread_id, session_id, path)
     )`,
    `CREATE TABLE claude_session_chunks (
       thread_id TEXT NOT NULL,
       session_id TEXT NOT NULL,
       path TEXT NOT NULL,
       generation INTEGER NOT NULL,
       chunk_index INTEGER NOT NULL,
       offset INTEGER NOT NULL,
       length INTEGER NOT NULL,
       sha256 TEXT NOT NULL,
       chain TEXT NOT NULL,
       object_key TEXT NOT NULL,
       created_at INTEGER NOT NULL,
       PRIMARY KEY (thread_id, session_id, path, generation, chunk_index)
     )`,
    `CREATE INDEX idx_claude_session_chunks_offset
       ON claude_session_chunks(thread_id, session_id, path, generation, offset)`,
  ],
};

const HEX_SHA256 = /^[0-9a-f]{64}$/;

type SessionRow = {
  thread_id: string;
  session_id: string;
  conversation_id: string;
  device_id: string;
  cli_version: string;
  engine: string;
  origin_cwd: string;
  journal_cursor: string | null;
  journal_seq: number | null;
  lease_epoch: number | null;
  updated_at: number;
};

type FileRow = {
  path: string;
  generation: number;
  length: number;
  chain: string;
  chunk_count: number;
};

type ChunkRow = {
  chunk_index: number;
  offset: number;
  length: number;
  sha256: string;
  chain: string;
  object_key: string;
};

const bucketOf = (ctx: OwnerContext): R2Bucket => {
  const bucket = ctx.env.CONVERSATION_ARCHIVE;
  if (!bucket) {
    throw new RpcError("UNAVAILABLE", "Session sync isn't available right now.");
  }
  return bucket;
};

const ownerPrefix = async (ownerId: string): Promise<string> =>
  `conversations/${await sha256Hex(ownerId)}/claude-code-sessions/v1/`;

const chunkObjectKey = async (
  ownerId: string,
  args: ClaudeSessionAppendArgs,
): Promise<string> =>
  [
    (await ownerPrefix(ownerId)).replace(/\/$/, ""),
    await sha256Hex(args.threadId),
    args.sessionId,
    String(args.generation),
    (await sha256Hex(args.path)).slice(0, 40),
    `${args.offset}-${args.chain.slice(0, 24)}`,
  ].join("/");

const decodeBase64 = (value: string): Uint8Array => {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new RpcError("BAD_REQUEST", "data must be base64.");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const encodeBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step));
  }
  return btoa(binary);
};

const assertTag = (tag: ClaudeSessionSyncTag): void => {
  if (!isClaudeSessionId(tag.sessionId)) {
    throw new RpcError("BAD_REQUEST", "sessionId must be well-formed.");
  }
};

const assertLease = (db: OwnerDb, tag: ClaudeSessionSyncTag): void => {
  if (tag.leaseEpoch === undefined) return;
  const row = db.one<{ epoch: number | null }>(
    "SELECT MAX(lease_epoch) AS epoch FROM claude_sessions WHERE thread_id = ?",
    tag.threadId,
  );
  if (row?.epoch !== null && row?.epoch !== undefined && row.epoch > tag.leaseEpoch) {
    throw new RpcError("CONFLICT", "A newer run owns this session.", {
      reason: CLAUDE_SESSION_STALE_LEASE_REASON,
    });
  }
};

const upsertSession = (db: OwnerDb, now: number, tag: ClaudeSessionSyncTag): void => {
  db.run(
    `INSERT INTO claude_sessions (
       thread_id, session_id, conversation_id, device_id, cli_version, engine,
       origin_cwd, journal_cursor, journal_seq, lease_epoch, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (thread_id, session_id) DO UPDATE SET
       conversation_id = excluded.conversation_id,
       device_id = excluded.device_id,
       cli_version = excluded.cli_version,
       engine = excluded.engine,
       origin_cwd = excluded.origin_cwd,
       journal_cursor = COALESCE(excluded.journal_cursor, claude_sessions.journal_cursor),
       journal_seq = COALESCE(excluded.journal_seq, claude_sessions.journal_seq),
       lease_epoch = MAX(COALESCE(excluded.lease_epoch, -1), COALESCE(claude_sessions.lease_epoch, -1)),
       updated_at = excluded.updated_at`,
    tag.threadId,
    tag.sessionId,
    tag.conversationId,
    tag.deviceId,
    tag.cliVersion,
    tag.engine,
    tag.originCwd,
    tag.journalCursor ?? null,
    tag.journalSeq ?? null,
    tag.leaseEpoch ?? null,
    now,
    now,
  );
};

const readFile = (db: OwnerDb, args: ClaudeSessionAppendArgs): FileRow | null =>
  db.one<FileRow>(
    `SELECT path, generation, length, chain, chunk_count FROM claude_session_files
      WHERE thread_id = ? AND session_id = ? AND path = ?`,
    args.threadId,
    args.sessionId,
    args.path,
  );

const headOf = (file: FileRow): ClaudeSessionFileHead => ({
  path: file.path,
  generation: file.generation,
  length: file.length,
  chain: file.chain,
});

type Placement =
  | { kind: "create" }
  | { kind: "extend"; file: FileRow }
  | { kind: "reset"; file: FileRow }
  | { kind: "replay"; file: FileRow }
  | { kind: "conflict"; file: FileRow };

const placeChunk = (db: OwnerDb, args: ClaudeSessionAppendArgs): Placement => {
  const file = readFile(db, args);
  if (!file) {
    if (args.offset !== 0 || args.prevChain !== CLAUDE_SESSION_CHAIN_GENESIS) {
      throw new RpcError("CONFLICT", "This session file was never started here.", {
        reason: CLAUDE_SESSION_CONFLICT_REASON,
      });
    }
    return { kind: "create" };
  }
  if (args.generation === file.generation) {
    if (args.offset === file.length && args.prevChain === file.chain) {
      return { kind: "extend", file };
    }
    const existing = db.one<{ sha256: string; chain: string }>(
      `SELECT sha256, chain FROM claude_session_chunks
        WHERE thread_id = ? AND session_id = ? AND path = ? AND generation = ? AND offset = ?`,
      args.threadId,
      args.sessionId,
      args.path,
      args.generation,
      args.offset,
    );
    if (existing && existing.sha256 === args.sha256 && existing.chain === args.chain) {
      return { kind: "replay", file };
    }
    return { kind: "conflict", file };
  }
  if (
    args.generation === file.generation + 1 &&
    args.offset === 0 &&
    args.prevChain === CLAUDE_SESSION_CHAIN_GENESIS
  ) {
    return { kind: "reset", file };
  }
  return { kind: "conflict", file };
};

const fileCount = (db: OwnerDb, args: ClaudeSessionAppendArgs): number =>
  db.one<{ count: number }>(
    "SELECT COUNT(*) AS count FROM claude_session_files WHERE thread_id = ? AND session_id = ?",
    args.threadId,
    args.sessionId,
  )?.count ?? 0;

const appendChunk = async (
  ctx: OwnerContext,
  args: ClaudeSessionAppendArgs,
): Promise<ClaudeSessionCalls["claudeSessions.append"]["result"]> => {
  assertTag(args);
  if (!isClaudeSessionFilePath(args.sessionId, args.path)) {
    throw new RpcError("BAD_REQUEST", "path must be a file of this session.");
  }
  if (!HEX_SHA256.test(args.sha256) || !HEX_SHA256.test(args.chain) || !HEX_SHA256.test(args.prevChain)) {
    throw new RpcError("BAD_REQUEST", "Hashes must be lowercase SHA-256 hex.");
  }
  enforceOwnerRateLimit(
    ctx.db,
    ctx.now,
    "claudeSessions.append",
    { count: 1_200, windowMs: 60_000 },
    "Session sync is going too fast. It will retry shortly.",
  );
  const bytes = decodeBase64(args.data);
  if (bytes.byteLength === 0 || bytes.byteLength > CLAUDE_SESSION_CHUNK_MAX_BYTES) {
    throw new RpcError("BAD_REQUEST", "Chunk size is out of range.");
  }
  if ((await sha256BytesHex(bytes)) !== args.sha256) {
    throw new RpcError("BAD_REQUEST", "Chunk bytes don't match their hash.");
  }
  if ((await sha256Hex(claudeSessionChainInput(args.prevChain, args.sha256))) !== args.chain) {
    throw new RpcError("BAD_REQUEST", "Chunk chain doesn't follow its predecessor.");
  }
  assertLease(ctx.db, args);
  const replayed = {
    path: args.path,
    generation: args.generation,
    length: args.offset + bytes.byteLength,
    chain: args.chain,
  };
  const before = placeChunk(ctx.db, args);
  if (before.kind === "replay") {
    upsertSession(ctx.db, ctx.now, args);
    return replayed;
  }
  if (before.kind === "conflict") {
    throw new RpcError("CONFLICT", "The cloud copy of this session moved on.", {
      reason: CLAUDE_SESSION_CONFLICT_REASON,
    });
  }
  if (before.kind === "create" && fileCount(ctx.db, args) >= CLAUDE_SESSION_MAX_FILES) {
    throw new RpcError("BAD_REQUEST", "This session has too many files to sync.");
  }
  const bucket = bucketOf(ctx);
  const objectKey = await chunkObjectKey(ctx.ownerId, args);
  await bucket.put(objectKey, bytes);
  const placement = placeChunk(ctx.db, args);
  if (placement.kind !== before.kind) {
    if (placement.kind !== "replay") await bucket.delete(objectKey).catch(() => undefined);
    if (placement.kind === "replay") return replayed;
    throw new RpcError("CONFLICT", "The cloud copy of this session moved on.", {
      reason: CLAUDE_SESSION_CONFLICT_REASON,
    });
  }
  const retired: string[] = [];
  if (placement.kind === "reset") {
    for (const row of ctx.db.all<{ object_key: string }>(
      `SELECT object_key FROM claude_session_chunks
        WHERE thread_id = ? AND session_id = ? AND path = ? AND generation < ?`,
      args.threadId,
      args.sessionId,
      args.path,
      args.generation,
    )) {
      retired.push(row.object_key);
    }
    ctx.db.run(
      `DELETE FROM claude_session_chunks
        WHERE thread_id = ? AND session_id = ? AND path = ? AND generation < ?`,
      args.threadId,
      args.sessionId,
      args.path,
      args.generation,
    );
  }
  const chunkIndex =
    placement.kind === "extend" ? placement.file.chunk_count : 0;
  ctx.db.run(
    `INSERT INTO claude_session_chunks (
       thread_id, session_id, path, generation, chunk_index, offset, length,
       sha256, chain, object_key, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args.threadId,
    args.sessionId,
    args.path,
    args.generation,
    chunkIndex,
    args.offset,
    bytes.byteLength,
    args.sha256,
    args.chain,
    objectKey,
    ctx.now,
  );
  const length = args.offset + bytes.byteLength;
  ctx.db.run(
    `INSERT INTO claude_session_files (
       thread_id, session_id, path, generation, length, chain, chunk_count, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (thread_id, session_id, path) DO UPDATE SET
       generation = excluded.generation,
       length = excluded.length,
       chain = excluded.chain,
       chunk_count = excluded.chunk_count,
       updated_at = excluded.updated_at`,
    args.threadId,
    args.sessionId,
    args.path,
    args.generation,
    length,
    args.chain,
    chunkIndex + 1,
    ctx.now,
  );
  upsertSession(ctx.db, ctx.now, args);
  if (retired.length > 0) {
    await bucket.delete(retired).catch(() => undefined);
  }
  return { path: args.path, generation: args.generation, length, chain: args.chain };
};

const tagSession = (
  ctx: OwnerContext,
  args: ClaudeSessionSyncTag,
): null => {
  assertTag(args);
  assertLease(ctx.db, args);
  upsertSession(ctx.db, ctx.now, args);
  return null;
};

const latestSession = (
  ctx: OwnerContext,
  args: { threadId: string },
): ClaudeSessionManifest | null => {
  const session = ctx.db.one<SessionRow>(
    `SELECT thread_id, session_id, conversation_id, device_id, cli_version, engine,
            origin_cwd, journal_cursor, journal_seq, lease_epoch, updated_at
       FROM claude_sessions
      WHERE thread_id = ?
        AND EXISTS (
          SELECT 1 FROM claude_session_files f
           WHERE f.thread_id = claude_sessions.thread_id
             AND f.session_id = claude_sessions.session_id
        )
      ORDER BY updated_at DESC, session_id DESC
      LIMIT 1`,
    args.threadId,
  );
  if (!session) return null;
  const files = ctx.db.all<FileRow>(
    `SELECT path, generation, length, chain, chunk_count FROM claude_session_files
      WHERE thread_id = ? AND session_id = ?
      ORDER BY path`,
    session.thread_id,
    session.session_id,
  );
  return {
    threadId: session.thread_id,
    sessionId: session.session_id,
    conversationId: session.conversation_id,
    deviceId: session.device_id,
    cliVersion: session.cli_version,
    engine: session.engine === "claude_code_local_vanilla" ? "claude_code_local_vanilla" : "claude_code_local",
    originCwd: session.origin_cwd,
    ...(session.journal_cursor !== null ? { journalCursor: session.journal_cursor } : {}),
    ...(session.journal_seq !== null ? { journalSeq: session.journal_seq } : {}),
    ...(session.lease_epoch !== null && session.lease_epoch >= 0 ? { leaseEpoch: session.lease_epoch } : {}),
    updatedAt: session.updated_at,
    files: files.map((file) => ({
      ...headOf(file),
      chunks: ctx.db
        .all<ChunkRow>(
          `SELECT chunk_index, offset, length, sha256, chain, object_key FROM claude_session_chunks
            WHERE thread_id = ? AND session_id = ? AND path = ? AND generation = ?
            ORDER BY chunk_index`,
          session.thread_id,
          session.session_id,
          file.path,
          file.generation,
        )
        .map((chunk) => ({
          index: chunk.chunk_index,
          offset: chunk.offset,
          length: chunk.length,
          sha256: chunk.sha256,
          chain: chunk.chain,
        })),
    })),
  };
};

const readChunk = async (
  ctx: OwnerContext,
  args: ClaudeSessionCalls["claudeSessions.readChunk"]["args"],
): Promise<ClaudeSessionCalls["claudeSessions.readChunk"]["result"]> => {
  if (!isClaudeSessionId(args.sessionId) || !isClaudeSessionFilePath(args.sessionId, args.path)) {
    throw new RpcError("BAD_REQUEST", "path must be a file of this session.");
  }
  const chunk = ctx.db.one<ChunkRow>(
    `SELECT chunk_index, offset, length, sha256, chain, object_key FROM claude_session_chunks
      WHERE thread_id = ? AND session_id = ? AND path = ? AND generation = ? AND chunk_index = ?`,
    args.threadId,
    args.sessionId,
    args.path,
    args.generation,
    args.index,
  );
  if (!chunk) throw new RpcError("NOT_FOUND", "That part of the session isn't stored.");
  const object = await bucketOf(ctx).get(chunk.object_key);
  if (!object) throw new RpcError("NOT_FOUND", "That part of the session is missing.");
  const bytes = new Uint8Array(await object.arrayBuffer());
  if ((await sha256BytesHex(bytes)) !== chunk.sha256) {
    throw new RpcError("INTERNAL", "A stored session part failed its integrity check.");
  }
  return { data: encodeBase64(bytes), sha256: chunk.sha256, offset: chunk.offset, chain: chunk.chain };
};

const purgeClaudeSessions = async (ctx: OwnerContext): Promise<{ pending: boolean }> => {
  ctx.db.run("DELETE FROM claude_session_chunks");
  ctx.db.run("DELETE FROM claude_session_files");
  ctx.db.run("DELETE FROM claude_sessions");
  const bucket = ctx.env.CONVERSATION_ARCHIVE;
  if (!bucket) return { pending: false };
  const listed = await bucket.list({ prefix: await ownerPrefix(ctx.ownerId), limit: 1_000 });
  if (listed.objects.length > 0) {
    await bucket.delete(listed.objects.map((entry) => entry.key));
  }
  return { pending: listed.truncated };
};

const threadIdArg = string({ min: 1, max: 512 });
const sessionIdArg = string({ min: 1, max: 128 });
const hashArg = string({ min: 64, max: 64 });

const tagShape = {
  threadId: threadIdArg,
  conversationId: string({ min: 1, max: 512 }),
  sessionId: sessionIdArg,
  deviceId: string({ min: 1, max: 512 }),
  cliVersion: string({ min: 1, max: 128 }),
  engine: literal(...CLAUDE_SESSION_ENGINES),
  originCwd: string({ min: 1, max: 4_096 }),
  journalCursor: optional(string({ min: 1, max: 512 })),
  journalSeq: optional(number({ int: true, min: -1 })),
  leaseEpoch: optional(number({ int: true, min: 0 })),
};

export const claudeSessionsDomain = {
  name: "claude-sessions",
  migrations: [CLAUDE_SESSIONS_MIGRATION],
  calls: {
    "claudeSessions.append": {
      scope: "owner",
      requireAccount: true,
      maxBodyBytes: CLAUDE_SESSION_APPEND_MAX_BODY_BYTES,
      parse: object({
        ...tagShape,
        path: string({ min: 1, max: 1_024 }),
        generation: number({ int: true, min: 1 }),
        offset: number({ int: true, min: 0 }),
        prevChain: hashArg,
        sha256: hashArg,
        chain: hashArg,
        data: string({ min: 1, max: CLAUDE_SESSION_APPEND_MAX_BODY_BYTES }),
      }),
      handler: appendChunk,
    },
    "claudeSessions.tag": {
      scope: "owner",
      requireAccount: true,
      parse: object(tagShape),
      handler: tagSession,
    },
    "claudeSessions.latest": {
      scope: "owner",
      requireAccount: true,
      parse: object({ threadId: threadIdArg }),
      handler: latestSession,
    },
    "claudeSessions.readChunk": {
      scope: "owner",
      requireAccount: true,
      parse: object({
        threadId: threadIdArg,
        sessionId: sessionIdArg,
        path: string({ min: 1, max: 1_024 }),
        generation: number({ int: true, min: 1 }),
        index: number({ int: true, min: 0 }),
      }),
      handler: readChunk,
    },
  },
  internal: {
    // The cloud resuming a computer's synced session after it took the
    // brain over (`@stella/contracts/cloud-orchestrator-cli`).
    "claudeSessions.latestForRestore": (ctx: OwnerContext, raw: unknown) =>
      latestSession(ctx, object({ threadId: threadIdArg })(raw)),
    "claudeSessions.readChunkForRestore": async (ctx: OwnerContext, raw: unknown) =>
      await readChunk(
        ctx,
        object({
          threadId: threadIdArg,
          sessionId: sessionIdArg,
          path: string({ min: 1, max: 1_024 }),
          generation: number({ int: true, min: 1 }),
          index: number({ int: true, min: 0 }),
        })(raw),
      ),
  },
  purge: (ctx) => purgeClaudeSessions(ctx),
} satisfies OwnerDomain;
