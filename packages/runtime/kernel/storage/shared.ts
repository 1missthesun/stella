import crypto from "crypto";
import type { ChannelEnvelope } from "@stella/contracts/local-chat";
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
  channelEnvelope?: ChannelEnvelope;
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

export type CachedStatements = {
  prepare(sql: string): SqliteStatement;
};

type SqliteDriverStatement = SqliteStatement & {
  readonly paramsCount?: number;
  finalize?(): void;
};

export type SqliteDriverDatabase = {
  exec(sql: string): void;
  prepare(sql: string): SqliteDriverStatement;
  close(): void;
};

const MAX_CACHED_STATEMENTS = 512;

const requireBoundParams = (
  sql: string,
  statement: SqliteDriverStatement,
): SqliteStatement => {
  const expected = statement.paramsCount ?? 0;
  const check = (params: unknown[]) => {
    if (params.length === 0 && expected > 0) {
      throw new Error(
        `Cached statement needs ${expected} parameter(s) on every call: ${sql}`,
      );
    }
  };
  return {
    run: (...params) => {
      check(params);
      return statement.run(...params);
    },
    get: (...params) => {
      check(params);
      return statement.get(...params);
    },
    all: (...params) => {
      check(params);
      return statement.all(...params);
    },
  };
};

export class SqliteConnection implements SqliteDatabase {
  private readonly compiled = new Map<string, SqliteDriverStatement>();
  private readonly bound = new Map<string, SqliteStatement>();

  readonly statements: CachedStatements = {
    prepare: (sql) => {
      const existing = this.bound.get(sql);
      if (existing) return existing;
      const statement = this.driver.prepare(sql);
      const bound = requireBoundParams(sql, statement);
      if (this.bound.size < MAX_CACHED_STATEMENTS) {
        this.compiled.set(sql, statement);
        this.bound.set(sql, bound);
      }
      return bound;
    },
  };

  constructor(private readonly driver: SqliteDriverDatabase) {}

  exec(sql: string): void {
    this.driver.exec(sql);
  }

  prepare(sql: string): SqliteStatement {
    return this.driver.prepare(sql);
  }

  close(): void {
    for (const statement of this.compiled.values()) statement.finalize?.();
    this.compiled.clear();
    this.bound.clear();
    this.driver.close();
  }
}

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

