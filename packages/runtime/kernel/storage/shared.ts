import crypto from "crypto";
import type {
  ImageContent,
} from "@earendil-works/pi-ai";

export type StoredImageContent = ImageContent & { sourcePath?: string };

export type LocalChatEventRecord = {
  _id: string;
  timestamp: number;
  sequence?: number;
  type: string;
  deviceId?: string;
  requestId?: string;
  targetDeviceId?: string;
  payload?: Record<string, unknown>;
  channelEnvelope?: Record<string, unknown>;
};

export type LocalChatMessageRecord = LocalChatEventRecord & {
  toolEvents: LocalChatEventRecord[];
  toolEventSummary?: {
    totalCount: number;
    loadedCount: number;
    truncated: boolean;
    totalCountIsLowerBound?: boolean;
    detailLoaded?: boolean;
  };
};

export type LocalChatMessageWindow = {
  messages: LocalChatMessageRecord[];
  nextCursor?: { timestamp: number; id: string; sequence?: number };
  visibleMessageCount: number;
};

export type LocalChatActivityWindow = {
  activities: LocalChatEventRecord[];
};

export type LocalChatFilesWindow = {
  files: LocalChatEventRecord[];
};

export type LocalChatAppendEventArgs = {
  conversationId: string;
  type: string;
  payload?: unknown;
  deviceId?: string;
  requestId?: string;
  targetDeviceId?: string;
  channelEnvelope?: unknown;
  timestamp?: number;
  eventId?: string;
};

export type SqliteStatement = {
  run(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
};

export type SqliteDatabase = {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
};

/**
 * A connection's prepared-statement cache: `prepare(sql)` compiles each
 * distinct SQL text once per connection and hands back that same statement
 * on every later call. Storage code runs synchronously on the worker's one
 * database thread and only uses `run`/`get`/`all` (which bind fresh, step to
 * completion and reset), so reusing a statement is invisible to callers.
 *
 * Use it for SQL whose text comes from a small fixed set. SQL whose text
 * varies with the data (a `?` list sized by the input) stays on
 * `db.prepare`, which is why the cap below is a backstop, not a policy.
 *
 * One reuse hazard: bun:sqlite keeps a statement's previous bindings when it
 * is called with no arguments at all (a fresh statement would bind NULLs),
 * so always pass every parameter of a parameterized cached statement.
 */
export type CachedStatements = {
  prepare(sql: string): SqliteStatement;
};

const MAX_CACHED_STATEMENTS = 512;

const statementCaches = new WeakMap<SqliteDatabase, CachedStatements>();

/**
 * The shared statement cache for `db`. Every caller on the same connection
 * gets the same cache. Closing the connection finalizes the cached
 * statements first (bun:sqlite's close otherwise leaves the connection open
 * until they are garbage collected) and drops the cache.
 */
export const cachedStatements = (db: SqliteDatabase): CachedStatements => {
  const existing = statementCaches.get(db);
  if (existing) return existing;
  const statements = new Map<string, SqliteStatement>();
  const cache: CachedStatements = {
    prepare(sql) {
      const cached = statements.get(sql);
      if (cached) return cached;
      const statement = db.prepare(sql);
      if (statements.size < MAX_CACHED_STATEMENTS) {
        statements.set(sql, statement);
      }
      return statement;
    },
  };
  statementCaches.set(db, cache);
  const close = db.close;
  db.close = function closeAndFinalizeCachedStatements(
    this: unknown,
    ...args: unknown[]
  ) {
    statementCaches.delete(db);
    db.close = close;
    for (const statement of statements.values()) {
      (statement as { finalize?: () => void }).finalize?.();
    }
    statements.clear();
    return (close as (...closeArgs: unknown[]) => void).apply(db, args);
  };
  return cache;
};

const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export const MAX_EVENTS_PER_CONVERSATION = 2000;
export const DEFAULT_CONVERSATION_SETTING_KEY = "default_conversation_id";

export const asTrimmedString = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

export const requireConversationId = (value: unknown): string => {
  const conversationId = asTrimmedString(value);
  if (!conversationId) {
    throw new Error("conversationId is required.");
  }
  return conversationId;
};

export const asFiniteNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export const asObject = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
};

const encodeBase32 = (value: number, length: number): string => {
  let remaining = Math.floor(value);
  let output = "";
  for (let index = 0; index < length; index += 1) {
    output = ULID_ALPHABET[remaining % 32] + output;
    remaining = Math.floor(remaining / 32);
  }
  return output;
};

export const generateLocalId = (): string => {
  const time = encodeBase32(Date.now(), 10);
  const bytes = crypto.randomBytes(16);
  let randomPart = "";
  for (let index = 0; index < 16; index += 1) {
    randomPart += ULID_ALPHABET[bytes[index]! % ULID_ALPHABET.length];
  }
  return `${time}${randomPart}`;
};

export const toJsonValueString = (value: unknown): string | null => {
  if (value == null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
};

export const parseJsonRecord = (
  value: string | null,
): Record<string, unknown> | undefined => {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return asObject(parsed) ?? undefined;
  } catch {
    return undefined;
  }
};

export const eventTextFromPayload = (
  payload?: Record<string, unknown>,
): string => {
  const text = payload?.contextText ?? payload?.text;
  return typeof text === "string" ? text.trim() : "";
};

export type LocalContextEvent = {
  _id: string;
  timestamp: number;
  type: string;
  payload?: unknown;
  requestId?: string;
};

