import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { PiChatUsageRequest } from "@stella/contracts/pi-chat";
import type { LocalModelUsagePage, LocalModelUsageRecord } from "@stella/contracts/local-chat";
import { openSqliteConnection } from "../../kernel/storage/database.js";

const DEFAULT_LIMIT = 10_000;
const MAX_LIMIT = 50_000;
const LABEL_CHARS = 80;
const MTIME_CUSHION_MS = 60_000;
const MAX_CACHED_FILES = 16;

const ASSISTANT_PREFIX_SQL = `(substr(record, 1, 29) = '{"model":[{"role":"assistant"' OR substr(record, 1, 22) = '{"kind":"pi.assistant"')`;
const USER_PREFIX_SQL = `(substr(record, 1, 24) = '{"model":[{"role":"user"' OR substr(record, 1, 17) = '{"kind":"pi.user"')`;

type Usage = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  reasoning?: number;
  totalTokens?: number;
  cost?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; total?: number };
};

type CallFields = [
  kind: unknown,
  timestamp: unknown,
  provider: unknown,
  api: unknown,
  model: unknown,
  responseModel: unknown,
  usage: Usage | null,
  stopReason: unknown,
  errorMessage: unknown,
];

const CALL_FIELDS = [
  "$.kind",
  "$.model[0].timestamp",
  "$.model[0].provider",
  "$.model[0].api",
  "$.model[0].model",
  "$.model[0].responseModel",
  "$.model[0].usage",
  "$.model[0].stopReason",
  "$.model[0].errorMessage",
]
  .map((field) => `'${field}'`)
  .join(", ");

type SqliteDb = ReturnType<typeof openSqliteConnection>;

type RawAssistantRow = {
  id: number;
  conversation: number;
  fields: string;
};

type FileStamp = {
  ino: number;
  size: number;
  mtimeMs: number;
  walSize: number;
  walMtimeMs: number;
};

type FileUsageCache = {
  stamp: FileStamp;
  minEntryId: number;
  maxEntryId: number;
  coveredFromId: number;
  oldestCoveredMs: number;
  reachedStart: boolean;
  recordsDesc: LocalModelUsageRecord[];
  owners: Map<number, number | null>;
  labels: Map<number, string>;
  rootTitle: string;
};

const fileUsageCache = new Map<string, FileUsageCache>();

const str = (value: unknown): string => (typeof value === "string" ? value : "");

const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);

const stampsEqual = (a: FileStamp, b: FileStamp): boolean =>
  a.ino === b.ino &&
  a.size === b.size &&
  a.mtimeMs === b.mtimeMs &&
  a.walSize === b.walSize &&
  a.walMtimeMs === b.walMtimeMs;

const labelOf = (content: string | null): string => {
  if (!content) return "";
  let text = "";
  try {
    const parsed = JSON.parse(content) as unknown;
    if (typeof parsed === "string") text = parsed;
    else if (Array.isArray(parsed)) {
      const part = parsed.find((item) => item && typeof item === "object" && (item as { type?: unknown }).type === "text");
      text = typeof part?.text === "string" ? part.text : "";
    }
  } catch {
    text = content;
  }
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > LABEL_CHARS ? `${line.slice(0, LABEL_CHARS - 1)}…` : line;
};

const loadOwners = (db: SqliteDb): Map<number, number | null> => {
  const owners = new Map<number, number | null>();
  for (const row of db.prepare("SELECT id, owner_conversation_id AS owner FROM conversations").all() as Array<{
    id: number;
    owner: number | null;
  }>) {
    owners.set(row.id, row.owner);
  }
  return owners;
};

const depthOf = (owners: Map<number, number | null>, id: number): number => {
  let depth = 0;
  for (let owner = owners.get(id); owner != null && depth < 16; owner = owners.get(owner)) depth += 1;
  return depth;
};

const ensureLabels = (db: SqliteDb, labels: Map<number, string>, conversationIds: Iterable<number>): void => {
  const stmt = db.prepare(
    `SELECT json_extract(record, '$.model[0].content') AS content
     FROM entries
     WHERE conversation_id = ? AND ${USER_PREFIX_SQL}
     ORDER BY id ASC
     LIMIT 1`,
  );
  for (const id of conversationIds) {
    if (labels.has(id)) continue;
    const row = stmt.get(id) as { content: string | null } | undefined;
    labels.set(id, labelOf(row?.content ?? null));
  }
};

const readEntryBounds = (db: SqliteDb): { minId: number; maxId: number } | null => {
  const minRow = db.prepare("SELECT id FROM entries ORDER BY id ASC LIMIT 1").get() as { id: number } | undefined;
  if (!minRow) return null;
  const maxRow = db.prepare("SELECT id FROM entries ORDER BY id DESC LIMIT 1").get() as { id: number } | undefined;
  if (!maxRow) return null;
  return { minId: minRow.id, maxId: maxRow.id };
};

const parseAssistantRows = (
  db: SqliteDb,
  rows: readonly RawAssistantRow[],
  conversationId: string,
  owners: Map<number, number | null>,
  labels: Map<number, string>,
  rootTitle: string,
): LocalModelUsageRecord[] => {
  if (rows.length === 0) return [];
  const unseenConversations = new Set<number>();
  for (const row of rows) {
    if (!labels.has(row.conversation)) unseenConversations.add(row.conversation);
  }
  if (unseenConversations.size > 0) {
    ensureLabels(db, labels, unseenConversations);
  }

  const records: LocalModelUsageRecord[] = [];
  for (const row of rows) {
    let fields: CallFields;
    try {
      fields = JSON.parse(row.fields) as CallFields;
    } catch {
      continue;
    }
    const [kind, at, provider, api, model, responseModel, usage, stopReason, errorMessage] = fields;
    const timestamp = num(at);
    if (kind !== "pi.assistant" || !usage) continue;
    if (!num(usage.totalTokens) && !num(usage.input) && !num(usage.output)) continue;
    const threadId = `pi:${conversationId}:${row.conversation}`;
    const depth = depthOf(owners, row.conversation);
    const owner = owners.get(row.conversation);
    const isRoot = depth === 0;
    const agentLabel = labels.get(row.conversation) ?? "";
    records.push({
      id: `pi:${conversationId}:${row.id}`,
      timestamp,
      conversationId,
      conversationTitle: rootTitle,
      threadId,
      threadName: isRoot ? "Stella" : agentLabel,
      agentType: isRoot ? "orchestrator" : "general",
      ...(isRoot ? {} : { agentDescription: agentLabel }),
      agentDepth: depth,
      ...(owner != null ? { parentAgentId: `pi:${conversationId}:${owner}` } : {}),
      provider: str(provider),
      api: str(api),
      model: str(model),
      ...(str(responseModel) ? { responseModel: str(responseModel) } : {}),
      inputTokens: num(usage.input),
      cacheReadTokens: num(usage.cacheRead),
      cacheWriteTokens: num(usage.cacheWrite),
      outputTokens: num(usage.output),
      reasoningTokens: num(usage.reasoning),
      totalTokens: num(usage.totalTokens),
      inputCostUsd: num(usage.cost?.input),
      cacheReadCostUsd: num(usage.cost?.cacheRead),
      cacheWriteCostUsd: num(usage.cost?.cacheWrite),
      outputCostUsd: num(usage.cost?.output),
      totalCostUsd: num(usage.cost?.total),
      stopReason: str(stopReason),
      ...(str(errorMessage) ? { errorMessage: str(errorMessage) } : {}),
    });
  }
  return records;
};

const parseThreadConversation = (
  threadId: string | undefined,
  conversationId: string,
): { skipFile: boolean; subConversationId: number | null } => {
  if (!threadId) return { skipFile: false, subConversationId: null };
  const prefix = `pi:${conversationId}:`;
  if (!threadId.startsWith(prefix)) {
    return { skipFile: threadId.startsWith("pi:"), subConversationId: null };
  }
  const sub = Number(threadId.slice(prefix.length));
  return Number.isInteger(sub) && sub >= 0
    ? { skipFile: false, subConversationId: sub }
    : { skipFile: true, subConversationId: null };
};

const queryRangeDesc = (
  db: SqliteDb,
  fromIdInclusive: number,
  beforeIdExclusive: number,
  limit: number,
): RawAssistantRow[] =>
  db
    .prepare(
      `SELECT id, conversation_id AS conversation, json_extract(record, ${CALL_FIELDS}) AS fields
       FROM entries
       WHERE id >= ? AND id < ? AND ${ASSISTANT_PREFIX_SQL}
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(fromIdInclusive, beforeIdExclusive, limit) as RawAssistantRow[];

const readScopedThread = (
  db: SqliteDb,
  conversationId: string,
  subConversationId: number,
  fromMs: number,
  toMs: number,
  limit: number,
): LocalModelUsageRecord[] => {
  const owners = loadOwners(db);
  const labels = new Map<number, string>();
  const root = [...owners].find(([, owner]) => owner == null)?.[0];
  if (root !== undefined) ensureLabels(db, labels, [root, subConversationId]);
  else ensureLabels(db, labels, [subConversationId]);
  const rootTitle = (root !== undefined ? labels.get(root) : undefined) || conversationId;
  const rows = db
    .prepare(
      `SELECT id, conversation_id AS conversation, json_extract(record, ${CALL_FIELDS}) AS fields
       FROM entries
       WHERE conversation_id = ? AND ${ASSISTANT_PREFIX_SQL}
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(subConversationId, limit + 64) as RawAssistantRow[];
  const parsed = parseAssistantRows(db, rows, conversationId, owners, labels, rootTitle);
  const matched: LocalModelUsageRecord[] = [];
  for (const record of parsed) {
    if (record.timestamp < fromMs || record.timestamp > toMs) continue;
    matched.push(record);
    if (matched.length >= limit + 1) break;
  }
  return matched;
};

const rememberCache = (file: string, entry: FileUsageCache): void => {
  if (fileUsageCache.has(file)) fileUsageCache.delete(file);
  fileUsageCache.set(file, entry);
  while (fileUsageCache.size > MAX_CACHED_FILES) {
    const oldestKey = fileUsageCache.keys().next().value;
    if (oldestKey === undefined) break;
    fileUsageCache.delete(oldestKey);
  }
};

const sliceMatching = (
  recordsDesc: readonly LocalModelUsageRecord[],
  fromMs: number,
  toMs: number,
  limit: number,
): LocalModelUsageRecord[] => {
  const matched: LocalModelUsageRecord[] = [];
  for (const record of recordsDesc) {
    if (record.timestamp > toMs || record.timestamp < fromMs) continue;
    matched.push(record);
    if (matched.length >= limit + 1) break;
  }
  return matched;
};

const readConversation = (
  file: string,
  stamp: FileStamp,
  conversationId: string,
  args: PiChatUsageRequest,
  limit: number,
): LocalModelUsageRecord[] => {
  const threadFilter = parseThreadConversation(args.threadId, conversationId);
  if (threadFilter.skipFile) return [];

  const fromMs = args.fromMs ?? 0;
  const toMs = args.toMs ?? Number.MAX_SAFE_INTEGER;
  const existing = fileUsageCache.get(file);

  if (
    threadFilter.subConversationId === null &&
    existing &&
    stampsEqual(existing.stamp, stamp)
  ) {
    const cachedMatches = sliceMatching(existing.recordsDesc, fromMs, toMs, limit);
    if (
      cachedMatches.length >= limit + 1 ||
      existing.reachedStart ||
      (fromMs > 0 && existing.oldestCoveredMs <= fromMs - MTIME_CUSHION_MS)
    ) {
      return cachedMatches;
    }
  }

  const db = openSqliteConnection(file);
  try {
    db.exec("PRAGMA query_only = 1; PRAGMA busy_timeout = 2000;");
    const bounds = readEntryBounds(db);
    if (!bounds) return [];
    const { minId, maxId } = bounds;

    if (threadFilter.subConversationId !== null) {
      return readScopedThread(
        db,
        conversationId,
        threadFilter.subConversationId,
        fromMs,
        toMs,
        limit,
      );
    }

    let cache: FileUsageCache;
    if (
      existing &&
      existing.stamp.ino === stamp.ino &&
      existing.minEntryId === minId &&
      maxId >= existing.maxEntryId
    ) {
      cache = existing;
      cache.stamp = stamp;
      if (maxId > cache.maxEntryId) {
        cache.owners = loadOwners(db);
        const tailRows = db
          .prepare(
            `SELECT id, conversation_id AS conversation, json_extract(record, ${CALL_FIELDS}) AS fields
             FROM entries
             WHERE id > ? AND ${ASSISTANT_PREFIX_SQL}
             ORDER BY id DESC`,
          )
          .all(cache.maxEntryId) as RawAssistantRow[];
        const tailRecords = parseAssistantRows(
          db,
          tailRows,
          conversationId,
          cache.owners,
          cache.labels,
          cache.rootTitle,
        );
        if (tailRecords.length > 0) {
          cache.recordsDesc = [...tailRecords, ...cache.recordsDesc];
        }
        cache.maxEntryId = maxId;
      }
    } else {
      const owners = loadOwners(db);
      const labels = new Map<number, string>();
      const root = [...owners].find(([, owner]) => owner == null)?.[0];
      if (root !== undefined) ensureLabels(db, labels, [root]);
      const rootTitle = (root !== undefined ? labels.get(root) : undefined) || conversationId;
      cache = {
        stamp,
        minEntryId: minId,
        maxEntryId: maxId,
        coveredFromId: maxId + 1,
        oldestCoveredMs: Number.MAX_SAFE_INTEGER,
        reachedStart: false,
        recordsDesc: [],
        owners,
        labels,
        rootTitle,
      };
    }

    let matched = sliceMatching(cache.recordsDesc, fromMs, toMs, limit);
    const stopMs = fromMs > 0 ? fromMs - MTIME_CUSHION_MS : 0;
    while (
      matched.length < limit + 1 &&
      !cache.reachedStart &&
      !(fromMs > 0 && cache.oldestCoveredMs <= stopMs) &&
      cache.coveredFromId > minId
    ) {
      const remaining = limit + 1 - matched.length;
      const batchLimit = Math.min(Math.max(remaining + 64, 512), MAX_LIMIT + 128);
      const rows = queryRangeDesc(db, minId, cache.coveredFromId, batchLimit);
      if (rows.length === 0) {
        cache.coveredFromId = minId;
        cache.reachedStart = true;
        break;
      }
      const parsed = parseAssistantRows(
        db,
        rows,
        conversationId,
        cache.owners,
        cache.labels,
        cache.rootTitle,
      );
      if (parsed.length > 0) {
        cache.recordsDesc.push(...parsed);
        const lastParsed = parsed[parsed.length - 1]!;
        cache.oldestCoveredMs = Math.min(cache.oldestCoveredMs, lastParsed.timestamp);
        for (const record of parsed) {
          if (record.timestamp >= fromMs && record.timestamp <= toMs) {
            matched.push(record);
            if (matched.length >= limit + 1) break;
          }
        }
      }
      const oldestRowId = rows[rows.length - 1]!.id;
      if (rows.length < batchLimit || oldestRowId <= minId) {
        cache.coveredFromId = minId;
        cache.reachedStart = true;
        break;
      }
      cache.coveredFromId = oldestRowId;
    }

    rememberCache(file, cache);
    return matched;
  } finally {
    db.close();
  }
};

export const piModelUsage = async (dataDir: string, args: PiChatUsageRequest): Promise<LocalModelUsagePage> => {
  const directory = path.join(dataDir, "agent");
  const files = (await readdir(directory).catch(() => [] as string[])).filter((name) => name.endsWith(".sqlite"));
  const limit = Math.max(1, Math.min(Math.floor(args.limit ?? DEFAULT_LIMIT), MAX_LIMIT));
  const records: LocalModelUsageRecord[] = [];
  for (const name of files) {
    const conversationId = name.slice(0, -".sqlite".length);
    if (args.conversationId && args.conversationId !== conversationId) continue;
    const file = path.join(directory, name);
    try {
      const [fileStat, walStat] = await Promise.all([
        stat(file),
        stat(`${file}-wal`).catch(() => null),
      ]);
      const latestMtimeMs = Math.max(fileStat.mtimeMs, walStat?.mtimeMs ?? 0);
      if (args.fromMs !== undefined && latestMtimeMs < args.fromMs - MTIME_CUSHION_MS) {
        continue;
      }
      const stamp: FileStamp = {
        ino: fileStat.ino,
        size: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
        walSize: walStat?.size ?? 0,
        walMtimeMs: walStat?.mtimeMs ?? 0,
      };
      records.push(...readConversation(file, stamp, conversationId, args, limit));
    } catch (error) {
      console.warn(`[pi-usage] ${name} could not be read.`, error);
    }
  }
  if (files.length > 1) {
    records.sort((a, b) => b.timestamp - a.timestamp);
  }
  return { records: records.slice(0, limit), truncated: records.length > limit };
};
