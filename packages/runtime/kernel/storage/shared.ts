import crypto from "crypto";
import { z } from "zod";
import type {
  AssistantMessage,
  ImageContent,
  TextContent,
  ToolResultMessage,
  UserMessage,
} from "@earendil-works/pi-ai";
import type { MapRouteArtifact } from "@stella/contracts/map-artifact";

/**
 * An image block as Stella keeps it in a thread: optionally with the durable
 * local copy a text-only history points `Read` at.
 */
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

/**
 * Read shape backing `MessageWindowReader.listMessages` — the same fields
 * as `LocalChatEventRecord` plus the turn-scoped `toolEvents` projection.
 * Renderer-facing contract lives at `runtime/contracts/local-chat.ts`
 * (`MessageRecord`); this is the storage-side mirror so callers in the
 * worker can construct one without depending on the contracts module.
 */
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
  /**
   * Count of user/assistant entries in `messages` whose payload is not
   * UI-hidden (see `isUiHiddenChatMessagePayload`). The chat hook bases
   * pagination state on this rather than raw `messages.length` so hidden
   * system reminders / workspace-creation requests don't keep
   * `hasOlderMessages` / `isLoadingOlder` stuck against the wrong
   * threshold.
   */
  visibleMessageCount: number;
};

/**
 * Read shape backing `ChatLog.listActivity` — the persisted agent-*
 * lifecycle events. Kept separate from the message stream so consumers
 * never need to walk the (much larger) raw event stream.
 *
 * `activities` are ordered ASC by `(timestamp, _id)` so consumers see
 * events in the same order a flat replay would. Task STATE no longer
 * derives from these events (that's `listThreadActivity`); the remaining
 * consumers are file-derived surfaces and the inline chat cards.
 */
export type LocalChatActivityWindow = {
  activities: LocalChatEventRecord[];
};

/**
 * Read shape backing `ChatLog.listFiles` — the `assistant_message` and
 * `agent-completed` events whose text plausibly carries markdown file
 * links. The Recent Files surfaces (Chat tab Recent Files,
 * ActivityHistoryDialog "files" section) derive their list from this
 * without scanning the full event stream.
 *
 * Events are ordered ASC by `(timestamp, _id)`. The renderer reuses
 * `deriveConversationFiles` to dedup by path; the storage layer's job
 * is just to surface the candidate events efficiently (the SQL
 * pre-filter on JSON payloads keeps the window genuinely scoped to
 * link-carrying events, so a `limit` of 500 buys 500 candidate events
 * rather than 500 arbitrary messages).
 */
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

/**
 * The canvas an `html` tool call produced, as the durable transcript keeps it.
 * The file is the artifact; this is the handle every client needs to render it
 * as a canvas (and to list it in Files) long after the turn streamed.
 */
export type PersistedCanvasHtmlDetails = {
  filePath: string;
  title: string;
  createdAt: number;
  slug?: string;
  driveBacked?: true;
};

export type PersistedToolResultDetails =
  | { map: MapRouteArtifact }
  | { maps: MapRouteArtifact[] }
  | PersistedCanvasHtmlDetails;

export type PersistedRuntimeThreadPayload =
  | UserMessage
  | AssistantMessage
  | (Omit<ToolResultMessage, "details"> & {
      details?: PersistedToolResultDetails;
    });

export type RuntimeThreadSessionEntryBase = {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
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

/** A trimmed conversation id; throws when there is none. */
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

const textContentSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

const imageContentSchema = z.object({
  type: z.literal("image"),
  data: z.string(),
  mimeType: z.string(),
});

const userContentSchema = z.union([
  z.string(),
  z.array(z.union([textContentSchema, imageContentSchema])),
]);

export const isUserContent = (
  value: unknown,
): value is string | (TextContent | ImageContent)[] =>
  userContentSchema.safeParse(value).success;

export const eventTextFromPayload = (
  payload?: Record<string, unknown>,
): string => {
  const text = payload?.contextText ?? payload?.text;
  return typeof text === "string" ? text.trim() : "";
};

/**
 * Chat-events subset the runtime inspects for runtime reminders (stale-user,
 * connector-transition), recall lookups, and the deprecated pre-transition
 * history shim. Structurally a narrowing of `LocalChatEventRecord`.
 */
export type LocalContextEvent = {
  _id: string;
  timestamp: number;
  type: string;
  payload?: unknown;
  requestId?: string;
};

/** Event types that describe conversation content (vs lifecycle noise). */
export const LOCAL_CONTEXT_EVENT_TYPES = new Set<string>([
  "user_message",
  "assistant_message",
  "tool_request",
  "tool_result",
]);

