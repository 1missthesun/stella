import { Effect } from "effect";
import { releasingStub } from "../../rpc-release.js";
import type {
  ConversationCalls,
  ConversationExport,
  ConversationSummary,
  DataExport,
} from "@stella/contracts/backend/conversations";
import { enforceOwnerRateLimit } from "../rate-limit.js";
import {
  CONVERSATION_PREVIEW_MAX,
  CONVERSATION_TITLE_MAX,
  RECENT_CONVERSATIONS_LIMIT,
} from "@stella/contracts/backend/conversations";
import type {
  ConversationCreatedEvent,
  ConversationDeletedEvent,
  ConversationIndexEvent,
  TurnStartedEvent,
} from "@stella/contracts/turn-plane/owner-events";
import { welcomeCard } from "@stella/contracts/welcome-message";
import type { PublishViewArgs } from "@stella/contracts/backend/conversations";
import {
  parseViewCard,
  VIEW_CARD_MAX_DATA_BYTES,
  VIEW_CARD_MAX_SOURCE_BYTES,
  VIEW_CARD_TYPE,
  viewCardTurnId,
} from "@stella/contracts/view-card";
import { empty, json, number, object, optional, string } from "../args.js";
import { RpcError } from "../errors.js";
import {
  CONVERSATION_PURGE_JOB,
  conversationPurgeJob,
  purgeConversationData,
  scheduleConversationPurge,
} from "../purge.js";
import type { JobDef, OwnerContext, OwnerDbReader, OwnerDomain } from "../registry.js";
import {
  isSlackConversationId,
  NOT_SLACK_CONVERSATION_SQL,
} from "../../slack/conversation-id.js";

export type ConversationRow = {
  conversation_id: string;
  title: string;
  created_at: number;
  updated_at: number;
  deleted_at: number | null;
  client_create_id: string | null;
  allow_empty: number;
  execution_json: string | null;
  epoch: number;
  last_seq: number;
  last_preview: string | null;
  last_role: string | null;
  activity: string | null;
};

export const CONVERSATIONS_MIGRATION = {
  id: "conversations.1-init",
  statements: [
    `CREATE TABLE conversations (
       conversation_id TEXT PRIMARY KEY,
       title TEXT NOT NULL DEFAULT '',
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL,
       deleted_at INTEGER,
       client_create_id TEXT,
       allow_empty INTEGER NOT NULL DEFAULT 0,
       execution_json TEXT,
       epoch INTEGER NOT NULL DEFAULT 0,
       last_seq INTEGER NOT NULL DEFAULT -1,
       last_preview TEXT,
       last_role TEXT,
       activity TEXT
     )`,
    `CREATE UNIQUE INDEX conversations_client_create
       ON conversations (client_create_id) WHERE client_create_id IS NOT NULL`,
    `CREATE INDEX conversations_recent
       ON conversations (updated_at DESC, conversation_id DESC) WHERE deleted_at IS NULL`,
  ],
};

export const CONVERSATIONS_DROP_EDITS_MIGRATION = {
  id: "conversations.2-drop-conversation-edits",
  statements: [`DROP TABLE IF EXISTS conversation_edits`],
};

export const CONVERSATIONS_MAIN_MIGRATION = {
  id: "conversations.3-main-conversation",
  statements: [
    `CREATE TABLE conversation_main (
       id INTEGER PRIMARY KEY CHECK (id = 1),
       conversation_id TEXT NOT NULL,
       pinned_at INTEGER NOT NULL
     )`,
  ],
};

export const CONVERSATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const clip = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value;

const summary = (row: ConversationRow, ownerId: string): ConversationSummary => ({
  ownerId,
  conversationId: row.conversation_id,
  title: row.title,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  ...(row.last_preview !== null ? { lastPreview: row.last_preview } : {}),
  ...(row.last_role !== null ? { lastRole: row.last_role } : {}),
  ...(row.activity === "idle" || row.activity === "running"
    ? { activity: row.activity }
    : {}),
});

export const readConversation = (db: OwnerDbReader, conversationId: string): ConversationRow | null =>
  db.one<ConversationRow>(
    "SELECT * FROM conversations WHERE conversation_id = ?",
    conversationId,
  );

export const liveConversation = (
  db: OwnerDbReader,
  ownerId: string,
  conversationId: string,
): ConversationSummary | null => {
  const row = readConversation(db, conversationId);
  return row && row.deleted_at === null ? summary(row, ownerId) : null;
};

const recentConversations = (db: OwnerDbReader, ownerId: string): ConversationSummary[] =>
  db
    .all<ConversationRow>(
      `SELECT * FROM conversations WHERE deleted_at IS NULL AND ${NOT_SLACK_CONVERSATION_SQL}
        ORDER BY updated_at DESC, conversation_id DESC LIMIT ?`,
      RECENT_CONVERSATIONS_LIMIT,
    )
    .map((row) => summary(row, ownerId));

const EXPORT_MAX_CONVERSATIONS = 50;
const EXPORT_MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const EXPORT_MAX_CONVERSATION_BYTES = 10 * 1024 * 1024;

const exportData = async (ctx: OwnerContext): Promise<DataExport> => {
  enforceOwnerRateLimit(
    ctx.db,
    ctx.now,
    "data.export",
    { count: 3, windowMs: 60 * 60 * 1000 },
    "Too many exports. Please wait before downloading again.",
  );
  const rows = ctx.db.all<ConversationRow>(
    `SELECT * FROM conversations WHERE deleted_at IS NULL AND ${NOT_SLACK_CONVERSATION_SQL}
      ORDER BY updated_at DESC, conversation_id DESC LIMIT ?`,
    EXPORT_MAX_CONVERSATIONS,
  );
  let totalBytes = 0;
  let truncated = false;
  const conversations: ConversationExport[] = [];
  for (const row of rows) {
    if (totalBytes >= EXPORT_MAX_TOTAL_BYTES) {
      truncated = true;
      break;
    }
    const records: unknown[] = [];
    let bytes = 0;
    let conversationTruncated = false;
    let fromSeq = 0;
    try {
      const stub = releasingStub(ctx.env.ORCHESTRATOR_SESSIONS.getByName(row.conversation_id));
      for (;;) {
        const range = (await stub.queryHistory(ctx.ownerId, {
          op: "read",
          fromSeq,
          toSeq: Number.MAX_SAFE_INTEGER,
        })) as {
          records?: Array<{ seq?: unknown }>;
          complete?: boolean;
          missingBelowSeq?: number;
        };
        const batch = Array.isArray(range.records) ? range.records : [];
        for (const record of batch) {
          bytes += JSON.stringify(record).length;
          if (
            bytes > EXPORT_MAX_CONVERSATION_BYTES ||
            totalBytes + bytes > EXPORT_MAX_TOTAL_BYTES
          ) {
            conversationTruncated = true;
            break;
          }
          records.push(record);
        }
        if (conversationTruncated || range.complete) break;
        const last = batch[batch.length - 1];
        const next =
          typeof last?.seq === "number"
            ? last.seq + 1
            : typeof range.missingBelowSeq === "number"
              ? range.missingBelowSeq
              : null;
        if (next === null || next <= fromSeq) break;
        fromSeq = next;
      }
    } catch {
      conversationTruncated = records.length === 0 ? conversationTruncated : true;
    }
    totalBytes += bytes;
    truncated = truncated || conversationTruncated;
    conversations.push({
      summary: summary(row, ctx.ownerId),
      records,
      truncated: conversationTruncated,
    });
  }
  return { exportedAt: ctx.now, truncated, conversations };
};

const ownerIdentity = async (ctx: OwnerContext) => {
  const snapshot = await ctx.host.snapshot();
  return {
    ownerId: ctx.ownerId,
    ownerGeneration: snapshot.ownerGeneration,
    isAnonymous: false,
  };
};

const isLiveConversation = (db: OwnerDbReader, conversationId: string): boolean => {
  const row = readConversation(db, conversationId);
  return row !== null && row.deleted_at === null;
};

const pinnedMainConversationId = (db: OwnerDbReader): string | null => {
  const pinned = db.one<{ conversation_id: string }>(
    "SELECT conversation_id FROM conversation_main WHERE id = 1",
  );
  return pinned &&
    !isSlackConversationId(pinned.conversation_id) &&
    isLiveConversation(db, pinned.conversation_id)
    ? pinned.conversation_id
    : null;
};

const newestConversationId = (db: OwnerDbReader): string | null =>
  db.one<{ conversation_id: string }>(
    `SELECT conversation_id FROM conversations WHERE deleted_at IS NULL AND ${NOT_SLACK_CONVERSATION_SQL}
      ORDER BY updated_at DESC, conversation_id DESC LIMIT 1`,
  )?.conversation_id ?? null;

export const readMainConversationId = (db: OwnerDbReader): string | null =>
  pinnedMainConversationId(db) ?? newestConversationId(db);

const CONVERSATION_WELCOME_JOB = "conversations.welcome";
const WELCOME_SOURCE_TURN_ID = "welcome";
const WELCOME_RETRY_AFTER_MS = 5_000;
const WELCOME_INLINE_WAIT_MS = 8_000;
/** Only an account made in the last two weeks counts as new; older ones never get the welcome. */
const WELCOME_NEW_OWNER_MS = 14 * 24 * 60 * 60_000;

const welcomeJobId = (conversationId: string): string => `welcome:${conversationId}`;

const isNewOwner = (ctx: Pick<OwnerContext, "db" | "now">): boolean => {
  const first = ctx.db.one<{ at: number | null }>(
    "SELECT MIN(applied_at) AS at FROM _owner_migrations",
  );
  return typeof first?.at === "number" && ctx.now - first.at < WELCOME_NEW_OWNER_MS;
};

const resolveMainConversation = (
  ctx: OwnerContext,
  preferConversationId: string | undefined,
): string => {
  const pinned = pinnedMainConversationId(ctx.db);
  if (pinned) return pinned;
  let conversationId =
    preferConversationId &&
    !isSlackConversationId(preferConversationId) &&
    isLiveConversation(ctx.db, preferConversationId)
      ? preferConversationId
      : newestConversationId(ctx.db);
  if (!conversationId) {
    const firstEver = !ctx.db.one("SELECT 1 AS found FROM conversations LIMIT 1");
    conversationId = crypto.randomUUID();
    ctx.db.run(
      `INSERT INTO conversations
         (conversation_id, title, created_at, updated_at, allow_empty)
       VALUES (?, '', ?, ?, 1)`,
      conversationId,
      ctx.now,
      ctx.now,
    );
    if (firstEver && isNewOwner(ctx)) {
      ctx.jobs.schedule(
        CONVERSATION_WELCOME_JOB,
        ctx.now + WELCOME_RETRY_AFTER_MS,
        { conversationId },
        { id: welcomeJobId(conversationId) },
      );
    }
  }
  ctx.db.run(
    `INSERT INTO conversation_main (id, conversation_id, pinned_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       conversation_id = excluded.conversation_id, pinned_at = excluded.pinned_at`,
    conversationId,
    ctx.now,
  );
  return conversationId;
};

const postWelcome = async (ctx: OwnerContext, conversationId: string): Promise<boolean> => {
  if (!isLiveConversation(ctx.db, conversationId)) return true;
  const snapshot = await ctx.host.snapshot();
  if (!snapshot.writable) return true;
  return await ctx.host.postConversationCard({
    conversationId,
    ownerGeneration: snapshot.ownerGeneration,
    sourceTurnId: WELCOME_SOURCE_TURN_ID,
    card: welcomeCard(),
    onlyFirst: true,
  });
};

const welcomePayload = object({ conversationId: string({ max: 64 }) });

const conversationWelcomeJob: JobDef = {
  maxAttempts: 8,
  run: async (ctx, payload) => {
    const { conversationId } = welcomePayload(payload);
    if (!(await postWelcome(ctx, conversationId))) {
      throw new Error("The welcome message could not be posted yet.");
    }
  },
};

const settleWelcome = async (ctx: OwnerContext, conversationId: string): Promise<void> => {
  const jobId = welcomeJobId(conversationId);
  if (!ctx.db.one("SELECT 1 AS queued FROM owner_jobs WHERE id = ?", jobId)) return;
  const posted = await Effect.runPromise(
    Effect.promise(() => postWelcome(ctx, conversationId)).pipe(
      Effect.timeoutOrElse({ duration: WELCOME_INLINE_WAIT_MS, orElse: () => Effect.succeed(false) }),
    ),
  );
  if (posted) ctx.jobs.cancel(jobId);
};

export type ConversationEvent =
  | ConversationCreatedEvent
  | ConversationIndexEvent
  | ConversationDeletedEvent
  | TurnStartedEvent;

export const applyConversationEvent = (
  ctx: Pick<OwnerContext, "db" | "jobs" | "now">,
  event: ConversationEvent,
): void => {
  const { db } = ctx;
  const row = readConversation(db, event.conversationId);
  switch (event.kind) {
    case "conversation.created": {
      if (row) return;
      db.run(
        `INSERT INTO conversations (conversation_id, title, created_at, updated_at, execution_json)
         VALUES (?, ?, ?, ?, ?)`,
        event.conversationId,
        clip(event.title.trim(), CONVERSATION_TITLE_MAX),
        event.createdAt,
        event.createdAt,
        event.execution ? JSON.stringify(event.execution) : null,
      );
      return;
    }
    case "conversation.index": {
      if (!row) {
        if (event.createdAt === undefined) return;
        db.run(
          `INSERT INTO conversations
             (conversation_id, title, created_at, updated_at, epoch, last_seq,
              last_preview, last_role, activity)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          event.conversationId,
          clip(event.title?.trim() || "Conversation", CONVERSATION_TITLE_MAX),
          event.createdAt,
          Math.max(event.updatedAt, event.createdAt),
          event.epoch,
          event.lastSeq,
          event.lastPreview !== undefined ? clip(event.lastPreview, CONVERSATION_PREVIEW_MAX) : null,
          event.lastRole ?? null,
          event.activity ?? null,
        );
        return;
      }
      if (row.deleted_at !== null) return;
      if (event.epoch < row.epoch) return;
      if (
        event.force !== true &&
        event.epoch === row.epoch &&
        (event.lastSeq < row.last_seq ||
          (event.lastSeq === row.last_seq &&
            (event.activity === undefined ||
              event.activity === row.activity ||
              event.updatedAt < row.updated_at)))
      ) {
        return;
      }
      db.run(
        `UPDATE conversations SET
           epoch = ?, last_seq = ?, updated_at = MAX(updated_at, ?),
           allow_empty = CASE WHEN ? >= 0 THEN 0 ELSE allow_empty END,
           last_preview = COALESCE(?, last_preview),
           last_role = COALESCE(?, last_role),
           activity = COALESCE(?, activity),
           title = CASE WHEN TRIM(title) = '' AND ? <> '' THEN ? ELSE title END
         WHERE conversation_id = ?`,
        event.epoch,
        event.lastSeq,
        event.updatedAt,
        event.lastSeq,
        event.lastPreview !== undefined ? clip(event.lastPreview, CONVERSATION_PREVIEW_MAX) : null,
        event.lastRole ?? null,
        event.activity ?? null,
        event.title?.trim() ?? "",
        clip(event.title?.trim() ?? "", CONVERSATION_TITLE_MAX),
        event.conversationId,
      );
      return;
    }
    case "conversation.deleted": {
      if (!row) {
        db.run(
          `INSERT INTO conversations (conversation_id, created_at, updated_at, deleted_at)
           VALUES (?, ?, ?, ?)`,
          event.conversationId,
          event.deletedAt,
          event.deletedAt,
          event.deletedAt,
        );
        return;
      }
      if (row.deleted_at !== null) return;
      db.run(
        "UPDATE conversations SET deleted_at = ? WHERE conversation_id = ?",
        event.deletedAt,
        event.conversationId,
      );
      scheduleConversationPurge(ctx.jobs, event.conversationId, ctx.now);
      return;
    }
    case "turn.started": {
      if (!row || row.deleted_at !== null) return;
      db.run(
        `UPDATE conversations SET
           updated_at = MAX(updated_at, ?), allow_empty = 0,
           execution_json = COALESCE(execution_json, ?)
         WHERE conversation_id = ?`,
        event.createdAt,
        JSON.stringify(event.execution),
        event.conversationId,
      );
      return;
    }
  }
};

const conversationIdArg = string({ pattern: CONVERSATION_ID_PATTERN, max: 64 });

const publishViewArgs = object({
  conversationId: conversationIdArg,
  agentId: string({ min: 1, max: 128 }),
  agentTitle: optional(string({ max: 200 })),
  filePath: string({ min: 1, max: 1024 }),
  slug: string({ min: 1, max: 128 }),
  title: string({ min: 1, max: 200 }),
  source: string({ min: 1, max: VIEW_CARD_MAX_SOURCE_BYTES }),
  data: optional(json({ maxBytes: VIEW_CARD_MAX_DATA_BYTES })),
  createdAt: number({ min: 0 }),
});

/** Puts a task's view into the user's chat as a view card, so the phone and web show it too. */
const publishView = async (ctx: OwnerContext, args: PublishViewArgs): Promise<{ posted: boolean }> => {
  if (!isLiveConversation(ctx.db, args.conversationId)) {
    throw new RpcError("NOT_FOUND", "That conversation doesn't exist.");
  }
  const card = parseViewCard({ type: VIEW_CARD_TYPE, ...args });
  if (!card) throw new RpcError("BAD_REQUEST", "That isn't a view.");
  const snapshot = await ctx.host.snapshot();
  if (!snapshot.writable) return { posted: false };
  const posted = await ctx.host.postConversationCard({
    conversationId: args.conversationId,
    ownerGeneration: snapshot.ownerGeneration,
    sourceTurnId: viewCardTurnId(card.agentId, card.slug),
    card,
  });
  return { posted };
};

export const conversationsDomain = {
  name: "conversations",
  migrations: [
    CONVERSATIONS_MIGRATION,
    CONVERSATIONS_DROP_EDITS_MIGRATION,
    CONVERSATIONS_MAIN_MIGRATION,
  ],
  purge: purgeConversationData,
  internal: {
    // A cloud task's `view` tool, through its turn broker.
    "conversations.publishView": (ctx: OwnerContext, args: unknown) => publishView(ctx, publishViewArgs(args)),
  },
  jobs: {
    [CONVERSATION_PURGE_JOB]: conversationPurgeJob,
    [CONVERSATION_WELCOME_JOB]: conversationWelcomeJob,
  },
  calls: {
  "owner.identity": {
    scope: "owner",
    parse: empty(),
    handler: (ctx: OwnerContext) => ownerIdentity(ctx),
  },
  "data.export": {
    scope: "owner",
    parse: empty(),
    handler: (ctx: OwnerContext) => exportData(ctx),
  },
  "conversations.publishView": {
    scope: "owner",
    maxBodyBytes: VIEW_CARD_MAX_SOURCE_BYTES + VIEW_CARD_MAX_DATA_BYTES + 16 * 1024,
    parse: publishViewArgs,
    handler: publishView,
  },
  "conversations.bootstrap": {
    scope: "owner",
    parse: object({
      clientCreateId: optional(string({ max: 128 })),
      preferConversationId: optional(string({ max: 64 })),
    }),
    handler: async (
      ctx: OwnerContext,
      args: ConversationCalls["conversations.bootstrap"]["args"],
    ) => {
      const identity = await ownerIdentity(ctx);
      const conversationId = resolveMainConversation(ctx, args.preferConversationId);
      await settleWelcome(ctx, conversationId);
      return { ...identity, conversationId };
    },
  },
  },
  views: {
  "conversations.recent": {
    parse: empty(),
    read: (ctx: { db: OwnerDbReader; ownerId: string }) => recentConversations(ctx.db, ctx.ownerId),
  },
  "conversations.get": {
    parse: object({ conversationId: conversationIdArg }),
    read: (ctx: { db: OwnerDbReader; ownerId: string }, args: { conversationId: string }) =>
      liveConversation(ctx.db, ctx.ownerId, args.conversationId),
  },
  },
} satisfies OwnerDomain;
