import {
  asTrimmedString,
  cachedStatements,
  requireConversationId,
  type CachedStatements,
  type SqliteDatabase,
} from "./shared.js";
import { ChatLog } from "./chat-log.js";
import { MessageWindowReader } from "./message-window.js";
import { OutboxRepo } from "./outbox-repo.js";
import {
  projectLocalChatUpdateEvent,
} from "./view.js";

export {
  projectLocalChatUpdateEvent,
};

export type CloudTranscriptOutboxKind = "begin" | "finish";

export type CloudTranscriptOutboxRecord = {
  id: string;
  kind: CloudTranscriptOutboxKind;
  conversationId: string;
  deviceId: string;
  ownerGeneration: string | null;
  localTurnId: string;
  payloadJson: string;
  recoveryJson: string | null;
  attempts: number;
  lastError: string | null;
  deadLetteredAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type CloudJournalOutboxRecord = {
  sequence: number;
  id: string;
  conversationId: string;
  deviceId: string;
  ownerGeneration: string | null;
  appendId: string;
  payloadJson: string;
  attempts: number;
  lastError: string | null;
  deadLetteredAt: number | null;
  createdAt: number;
  updatedAt: number;
};

export type ComputerAgentCloudOutboxKind = "start" | "terminal" | "cancel";

export type ComputerAgentCloudOutboxRecord = {
  sequence: number;
  id: string;
  kind: ComputerAgentCloudOutboxKind;
  threadId: string;
  attemptGeneration: number;
  ownerScope: string | null;
  ownerGeneration: string | null;
  payloadJson: string;
  attempts: number;
  nextAttemptAt: number;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
};

type CloudTranscriptOutboxWrite = Omit<
  CloudTranscriptOutboxRecord,
  | "ownerGeneration"
  | "attempts"
  | "lastError"
  | "deadLetteredAt"
  | "createdAt"
  | "updatedAt"
> & { ownerGeneration: string };

const sameCloudTranscriptOutboxWrite = (
  existing: CloudTranscriptOutboxRecord,
  expected: CloudTranscriptOutboxWrite,
): boolean =>
  existing.id === expected.id &&
  existing.kind === expected.kind &&
  existing.conversationId === expected.conversationId &&
  existing.deviceId === expected.deviceId &&
  existing.ownerGeneration === expected.ownerGeneration &&
  existing.localTurnId === expected.localTurnId &&
  existing.payloadJson === expected.payloadJson &&
  existing.recoveryJson === expected.recoveryJson;

const CLOUD_TRANSCRIPT_OUTBOX_COLUMNS = `id,
  kind,
  conversation_id AS conversationId,
  device_id AS deviceId,
  owner_generation AS ownerGeneration,
  local_turn_id AS localTurnId,
  payload_json AS payloadJson,
  recovery_json AS recoveryJson,
  attempts,
  last_error AS lastError,
  dead_lettered_at AS deadLetteredAt,
  created_at AS createdAt,
  updated_at AS updatedAt`;

const CLOUD_JOURNAL_OUTBOX_COLUMNS = `sequence,
  id,
  conversation_id AS conversationId,
  device_id AS deviceId,
  owner_generation AS ownerGeneration,
  append_id AS appendId,
  payload_json AS payloadJson,
  attempts,
  last_error AS lastError,
  dead_lettered_at AS deadLetteredAt,
  created_at AS createdAt,
  updated_at AS updatedAt`;

const COMPUTER_AGENT_CLOUD_OUTBOX_COLUMNS = `sequence,
  id,
  kind,
  thread_id AS threadId,
  attempt_generation AS attemptGeneration,
  owner_scope AS ownerScope,
  owner_generation AS ownerGeneration,
  payload_json AS payloadJson,
  attempts,
  next_attempt_at AS nextAttemptAt,
  last_error AS lastError,
  created_at AS createdAt,
  updated_at AS updatedAt`;

export class SessionStore {
  readonly db: SqliteDatabase;
  private readonly cached: CachedStatements;
  readonly chat: ChatLog;
  readonly messageWindows: MessageWindowReader;
  private readonly transcriptOutbox: OutboxRepo<CloudTranscriptOutboxRecord>;
  private readonly journalOutbox: OutboxRepo<CloudJournalOutboxRecord>;
  private readonly computerAgentOutbox: OutboxRepo<ComputerAgentCloudOutboxRecord>;
  private inTransaction = false;
  constructor(db: SqliteDatabase) {
    this.db = db;
    this.cached = cachedStatements(db);
    const tx = {
      immediate: (work: () => void) => void this.withImmediateTransaction(work),
    };
    this.chat = new ChatLog(db, tx);
    this.messageWindows = new MessageWindowReader(db, this.chat);
    this.transcriptOutbox = new OutboxRepo(
      this.cached,
      "cloud_transcript_outbox",
      {
        columns: CLOUD_TRANSCRIPT_OUTBOX_COLUMNS,
        orderBy: "attempts ASC, updated_at ASC, created_at ASC, id ASC",
        pendingWhere: "dead_lettered_at IS NULL",
        deadLetterClears: ["recovery_json"],
      },
    );
    this.journalOutbox = new OutboxRepo(this.cached, "cloud_journal_outbox", {
      columns: CLOUD_JOURNAL_OUTBOX_COLUMNS,
      orderBy: "sequence ASC",
      pendingWhere: "dead_lettered_at IS NULL",
    });
    this.computerAgentOutbox = new OutboxRepo(
      this.cached,
      "computer_agent_cloud_outbox",
      {
        columns: COMPUTER_AGENT_CLOUD_OUTBOX_COLUMNS,
        orderBy: "sequence ASC",
      },
    );
  }

  withTransaction<T>(work: () => T): T {
    return this.withImmediateTransaction(work);
  }

  withImmediateTransaction<T>(work: () => T): T {
    if (this.inTransaction) {
      return work();
    }
    this.db.exec("BEGIN IMMEDIATE;");
    this.inTransaction = true;
    try {
      const result = work();
      this.db.exec("COMMIT;");
      return result;
    } catch (error) {
      try {
        this.db.exec("ROLLBACK;");
      } catch {
        /* the transaction may already be gone */
      }
      throw error;
    } finally {
      this.inTransaction = false;
    }
  }

  putCloudTranscriptOutbox(record: CloudTranscriptOutboxWrite): void {
    const now = Date.now();
    this.withImmediateTransaction(() => {
      const existing = this.transcriptOutbox.get(record.id);
      if (existing) {
        if (!sameCloudTranscriptOutboxWrite(existing, record)) {
          throw new Error(
            "Cloud transcript turn id was reused with different authority or payload.",
          );
        }
        return;
      }
      this.insertCloudTranscriptOutbox(record, now);
    });
  }

  private insertCloudTranscriptOutbox(
    record: CloudTranscriptOutboxWrite,
    now: number,
  ): void {
    this.cached
      .prepare(
        `
      INSERT INTO cloud_transcript_outbox (
        id,
        kind,
        conversation_id,
        device_id,
        owner_generation,
        local_turn_id,
        payload_json,
        recovery_json,
        attempts,
        last_error,
        dead_lettered_at,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?)
    `,
      )
      .run(
        record.id,
        record.kind,
        record.conversationId,
        record.deviceId,
        record.ownerGeneration,
        record.localTurnId,
        record.payloadJson,
        record.recoveryJson,
        now,
        now,
      );
  }

  listCloudTranscriptOutbox(limit = 256): CloudTranscriptOutboxRecord[] {
    return this.transcriptOutbox.list(limit);
  }

  countCloudTranscriptOutbox(): number {
    return this.transcriptOutbox.count();
  }

  markCloudTranscriptOutboxAttempt(id: string, error?: string): void {
    this.transcriptOutbox.markAttempt(id, { error });
  }

  deleteCloudTranscriptOutbox(id: string): void {
    this.transcriptOutbox.delete(id);
  }

  deadLetterCloudTranscriptOutbox(id: string, reason: string): void {
    this.transcriptOutbox.deadLetter(id, reason);
  }

  deadLetterCloudTranscriptOutboxWithFailureNotice(args: {
    id: string;
    reason: string;
    conversationId: string;
    deviceId: string;
    localTurnId: string;
    userMessageId: string;
    message: string;
  }): void {
    const now = Date.now();
    const conversationId = requireConversationId(args.conversationId);
    const eventId = `cloud-sync-error:${args.deviceId}:${args.localTurnId}`;
    const payload = {
      text: args.message.slice(0, 500),
      userMessageId: args.userMessageId,
      source: "cloud-sync-error",
    };
    this.withImmediateTransaction(() => {
      this.transcriptOutbox.deadLetter(args.id, args.reason);
      this.chat.appendEvent({
        conversationId,
        eventId,
        type: "assistant_message",
        timestamp: now,
        deviceId: args.deviceId,
        requestId: args.userMessageId,
        payload,
      });
    });
  }

  replaceCloudTranscriptOutbox(
    acknowledgedId: string,
    replacement: CloudTranscriptOutboxWrite,
  ): void {
    const now = Date.now();
    this.withImmediateTransaction(() => {
      const acknowledged = this.transcriptOutbox.get(acknowledgedId);
      const existingReplacement = this.transcriptOutbox.get(replacement.id);
      if (
        acknowledged &&
        (acknowledged.kind !== "begin" ||
          acknowledged.conversationId !== replacement.conversationId ||
          acknowledged.deviceId !== replacement.deviceId ||
          acknowledged.localTurnId !== replacement.localTurnId ||
          acknowledged.ownerGeneration !== replacement.ownerGeneration)
      ) {
        throw new Error(
          "Cloud transcript finish does not match its admitted begin authority.",
        );
      }
      if (existingReplacement) {
        if (!sameCloudTranscriptOutboxWrite(existingReplacement, replacement)) {
          throw new Error(
            "Cloud transcript finish id was reused with different authority or payload.",
          );
        }
      } else {
        if (!acknowledged) {
          throw new Error(
            "Cloud transcript finish has no matching admitted begin.",
          );
        }
        this.insertCloudTranscriptOutbox(replacement, now);
      }
      this.transcriptOutbox.delete(acknowledgedId);
    });
  }

  putCloudJournalOutbox(record: {
    id: string;
    conversationId: string;
    deviceId: string;
    ownerGeneration: string;
    appendId: string;
    payloadJson: string;
  }): { replayed: boolean } {
    const ownerGeneration = asTrimmedString(record.ownerGeneration);
    if (!ownerGeneration || ownerGeneration.length > 512) {
      throw new Error("Cloud journal owner generation is invalid.");
    }
    return this.withImmediateTransaction(() => {
      const admitted = this.cached
        .prepare(
          `SELECT payload_json AS payloadJson
             FROM cloud_journal_admission_receipts WHERE id = ?`,
        )
        .get(record.id) as { payloadJson?: unknown } | undefined;
      if (
        typeof admitted?.payloadJson === "string" &&
        admitted.payloadJson !== record.payloadJson
      ) {
        throw new Error("Cloud journal append id was reused with new payload.");
      }
      if (admitted) return { replayed: true };

      const now = Date.now();
      this.cached
        .prepare(
          `INSERT INTO cloud_journal_admission_receipts (
             id, payload_json, created_at
           ) VALUES (?, ?, ?)`,
        )
        .run(record.id, record.payloadJson, now);
      this.cached
        .prepare(
          `INSERT INTO cloud_journal_outbox (
             id, conversation_id, device_id, owner_generation, append_id, payload_json,
             attempts, last_error, dead_lettered_at, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?)`,
        )
        .run(
          record.id,
          record.conversationId,
          record.deviceId,
          ownerGeneration,
          record.appendId,
          record.payloadJson,
          now,
          now,
        );
      this.cached
        .prepare(
          `DELETE FROM cloud_journal_admission_receipts
            WHERE created_at < ?`,
        )
        .run(now - 30 * 24 * 60 * 60_000);
      return { replayed: false };
    });
  }

  listCloudJournalOutbox(limit = 256): CloudJournalOutboxRecord[] {
    return this.journalOutbox.list(limit);
  }

  countCloudJournalOutbox(): number {
    return this.journalOutbox.count();
  }

  markCloudJournalOutboxAttempt(id: string, error?: string): void {
    this.journalOutbox.markAttempt(id, { error });
  }

  deleteCloudJournalOutbox(id: string): void {
    this.journalOutbox.delete(id);
  }

  deadLetterCloudJournalOutbox(id: string, reason: string): void {
    this.journalOutbox.deadLetter(id, reason);
  }

  putComputerAgentCloudOutbox(record: {
    id: string;
    kind: ComputerAgentCloudOutboxKind;
    threadId: string;
    attemptGeneration: number;
    ownerScope: string | null;
    ownerGeneration: string | null;
    payloadJson: string;
  }): void {
    const now = Date.now();
    this.cached
      .prepare(
        `INSERT INTO computer_agent_cloud_outbox (
           id, kind, thread_id, attempt_generation, owner_scope,
           owner_generation, payload_json,
           attempts, next_attempt_at, last_error, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           payload_json = excluded.payload_json,
           next_attempt_at = MIN(
             computer_agent_cloud_outbox.next_attempt_at,
             excluded.next_attempt_at
           ),
           last_error = NULL,
           updated_at = excluded.updated_at`,
      )
      .run(
        record.id,
        record.kind,
        record.threadId,
        record.attemptGeneration,
        record.ownerScope,
        record.ownerGeneration,
        record.payloadJson,
        now,
        now,
        now,
      );
  }

  listComputerAgentCloudOutbox(
    ownerScope: string,
    limit = 256,
  ): ComputerAgentCloudOutboxRecord[] {
    return this.computerAgentOutbox.list(limit, {
      where: "owner_scope = ?",
      params: [ownerScope],
    });
  }

  countComputerAgentCloudOutbox(): number {
    return this.computerAgentOutbox.count();
  }

  markComputerAgentCloudOutboxRetry(args: {
    id: string;
    error: string;
    nextAttemptAt: number;
  }): void {
    this.computerAgentOutbox.markAttempt(args.id, {
      error: args.error,
      nextAttemptAt: args.nextAttemptAt,
    });
  }

  resumeComputerAgentCloudOutbox(ownerScope: string): void {
    const now = Date.now();
    this.cached
      .prepare(
        `UPDATE computer_agent_cloud_outbox
            SET next_attempt_at = MIN(next_attempt_at, ?),
                updated_at = ?
          WHERE owner_scope = ? AND next_attempt_at > ?`,
      )
      .run(now, now, ownerScope, now);
  }

  getComputerAgentCloudThreadOwnerScope(threadId: string): string | null {
    const row = this.cached
      .prepare(
        `SELECT owner_scope AS ownerScope
           FROM computer_agent_cloud_thread_owners
          WHERE thread_id = ?
          LIMIT 1`,
      )
      .get(threadId) as { ownerScope?: unknown } | undefined;
    return typeof row?.ownerScope === "string" && row.ownerScope.trim()
      ? row.ownerScope
      : null;
  }

  getComputerAgentCloudThreadAuthority(
    threadId: string,
  ): { ownerScope: string; ownerGeneration: string } | null {
    const row = this.cached
      .prepare(
        `SELECT owner_scope AS ownerScope,
                owner_generation AS ownerGeneration
           FROM computer_agent_cloud_thread_owners
          WHERE thread_id = ?
          LIMIT 1`,
      )
      .get(threadId) as
      | { ownerScope?: unknown; ownerGeneration?: unknown }
      | undefined;
    return typeof row?.ownerScope === "string" &&
      row.ownerScope.trim() &&
      typeof row.ownerGeneration === "string" &&
      row.ownerGeneration.trim()
      ? {
          ownerScope: row.ownerScope,
          ownerGeneration: row.ownerGeneration,
        }
      : null;
  }

  hasUnscopedComputerAgentCloudOutbox(threadId: string): boolean {
    return Boolean(
      this.cached
        .prepare(
          `SELECT 1
             FROM computer_agent_cloud_outbox
            WHERE thread_id = ?
              AND (owner_scope IS NULL OR owner_generation IS NULL)
            LIMIT 1`,
        )
        .get(threadId),
    );
  }

  isComputerAgentCloudGenerationRetired(args: {
    threadId: string;
    ownerScope: string;
    ownerGeneration: string;
  }): boolean {
    return Boolean(
      this.cached
        .prepare(
          `SELECT 1
             FROM computer_agent_cloud_retired_generations
            WHERE thread_id = ?
              AND owner_scope = ?
              AND owner_generation = ?
            LIMIT 1`,
        )
        .get(args.threadId, args.ownerScope, args.ownerGeneration),
    );
  }

  bindComputerAgentCloudThreadOwnerScope(
    threadId: string,
    ownerScope: string,
  ): string {
    const now = Date.now();
    this.cached
      .prepare(
        `INSERT INTO computer_agent_cloud_thread_owners (
           thread_id, owner_scope, created_at, updated_at
         ) VALUES (?, ?, ?, ?)
         ON CONFLICT(thread_id) DO NOTHING`,
      )
      .run(threadId, ownerScope, now, now);
    return this.getComputerAgentCloudThreadOwnerScope(threadId) ?? ownerScope;
  }

  bindComputerAgentCloudThreadAuthority(
    threadId: string,
    ownerScope: string,
    ownerGeneration: string,
  ): { ownerScope: string; ownerGeneration: string } | null {
    const now = Date.now();
    return this.withImmediateTransaction(() => {
      if (
        this.isComputerAgentCloudGenerationRetired({
          threadId,
          ownerScope,
          ownerGeneration,
        })
      ) {
        return null;
      }
      const existing = this.cached
        .prepare(
          `SELECT owner_scope AS ownerScope,
                  owner_generation AS ownerGeneration
             FROM computer_agent_cloud_thread_owners
            WHERE thread_id = ?`,
        )
        .get(threadId) as
        | { ownerScope?: unknown; ownerGeneration?: unknown }
        | undefined;
      if (
        existing &&
        (existing.ownerScope !== ownerScope ||
          typeof existing.ownerGeneration !== "string")
      ) {
        return null;
      }
      if (existing && existing.ownerGeneration !== ownerGeneration) {
        this.cached
          .prepare(
            `INSERT OR IGNORE INTO computer_agent_cloud_retired_generations (
               thread_id, owner_scope, owner_generation, retired_at
             ) VALUES (?, ?, ?, ?)`,
          )
          .run(threadId, ownerScope, existing.ownerGeneration, now);
        this.cached
          .prepare(
            `DELETE FROM computer_agent_cloud_outbox
              WHERE thread_id = ?
                AND owner_scope = ?
                AND owner_generation = ?`,
          )
          .run(threadId, ownerScope, existing.ownerGeneration);
      }
      this.cached
        .prepare(
          `INSERT INTO computer_agent_cloud_thread_owners (
             thread_id, owner_scope, owner_generation, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(thread_id) DO UPDATE SET
             owner_generation = excluded.owner_generation,
             updated_at = excluded.updated_at
           WHERE computer_agent_cloud_thread_owners.owner_scope = excluded.owner_scope`,
        )
        .run(threadId, ownerScope, ownerGeneration, now, now);
      return this.getComputerAgentCloudThreadAuthority(threadId);
    });
  }

  retireComputerAgentCloudGeneration(args: {
    threadId: string;
    ownerScope: string;
    ownerGeneration: string;
  }): void {
    this.withImmediateTransaction(() => {
      this.cached
        .prepare(
          `INSERT OR IGNORE INTO computer_agent_cloud_retired_generations (
             thread_id, owner_scope, owner_generation, retired_at
           ) VALUES (?, ?, ?, ?)`,
        )
        .run(args.threadId, args.ownerScope, args.ownerGeneration, Date.now());
      this.cached
        .prepare(
          `DELETE FROM computer_agent_cloud_outbox
            WHERE thread_id = ?
              AND owner_scope = ?
              AND owner_generation = ?`,
        )
        .run(args.threadId, args.ownerScope, args.ownerGeneration);
      this.cached
        .prepare(
          `DELETE FROM computer_agent_cloud_thread_owners
            WHERE thread_id = ?
              AND owner_scope = ?
              AND owner_generation = ?`,
        )
        .run(args.threadId, args.ownerScope, args.ownerGeneration);
    });
  }

  deleteComputerAgentCloudOutbox(id: string): void {
    this.computerAgentOutbox.delete(id);
  }
}
