import {
  AGENT_REPORT_OFFER_MS,
  agentReportId,
  agentReportReceipt,
  type AgentReportOutcome,
  type DeviceAgentReport,
  AGENT_REPORT_MAX_CHARS,
  silentRunReport,
} from "@stella/contracts/backend/agent-reports";
import { AGENT_STOPPED_REASON, isAgentStopReason } from "@stella/contracts/agent-status";
import { agentChangeHooks, appendAgentEvent } from "./agent-events.js";
import { deliverReportToAgent } from "./agent-threads.js";
import { resolveCurrentDeviceId } from "./devices.js";
import { object, string } from "../args.js";
import { RpcError } from "../errors.js";
import type {
  OwnerContext,
  OwnerDb,
  OwnerDbReader,
  OwnerDomain,
} from "../registry.js";

export const AGENT_REPORT_JOB = "agentReports.deliver";
export const AGENT_REPORT_AUDIT_JOB = "agentReports.audit";
const REPORT_AUDIT_FIRST_MS = 3 * 60_000;
const REPORT_AUDIT_MAX_MS = 60 * 60_000;
const REPORT_AUDIT_CHECKS_MAX = 12;

const LIVE_STATUSES = new Set([
  "queued",
  "pending",
  "running",
  "resuming",
  "waiting_for_helpers",
  "waiting_for_user",
]);
const WORKING_STATUSES_SQL =
  "('queued', 'pending', 'running', 'resuming', 'waiting_for_helpers')";
const REPORTABLE = new Set<string>(["completed", "failed", "canceled"]);
const REPORT_TEXT_MAX_CHARS = AGENT_REPORT_MAX_CHARS;

export const boundReportText = (text: string, threadId: string): string =>
  text.length <= REPORT_TEXT_MAX_CHARS
    ? text
    : `${text.slice(0, REPORT_TEXT_MAX_CHARS)}\n\n[Report shortened: ${text.length - REPORT_TEXT_MAX_CHARS} more characters are on thread_id ${threadId}.]`;
const TREE_DEPTH_MAX = 16;
const REPORT_DELIVERY_ATTEMPTS_MAX = 20;

type ThreadRow = {
  thread_id: string;
  conversation_id: string;
  owner_generation: string | null;
  parent_thread_id: string | null;
  origin_device_id: string | null;
  origin_conversation_id: string | null;
  description: string;
  agent_type: string;
  attempt_generation: number;
  status: string;
  result_json: string | null;
  error_message: string | null;
  origin_delivery_ack_at: number | null;
  updated_at: number;
};

type OutboxState = "pending" | "offered" | "delivered" | "dropped";

type OutboxRow = {
  report_id: string;
  kind: "report" | "note";
  thread_id: string;
  attempt_generation: number;
  conversation_id: string;
  owner_generation: string | null;
  requester_kind: "agent" | "conversation";
  requester_id: string;
  requester_generation: number | null;
  requester_was_live: number;
  outcome: AgentReportOutcome;
  description: string;
  agent_type: string;
  text: string;
  state: OutboxState;
  target_device_id: string | null;
  attempts: number;
  delivered_via: string | null;
  created_at: number;
  updated_at: number;
  delivered_at: number | null;
};

export const AGENT_REPORTS_MIGRATION = {
  id: "agent-reports.1-outbox",
  statements: [
    `CREATE TABLE agent_report_outbox (
       report_id TEXT PRIMARY KEY,
       kind TEXT NOT NULL,
       thread_id TEXT NOT NULL,
       attempt_generation INTEGER NOT NULL,
       conversation_id TEXT NOT NULL,
       owner_generation TEXT,
       requester_kind TEXT NOT NULL,
       requester_id TEXT NOT NULL,
       requester_generation INTEGER,
       requester_was_live INTEGER NOT NULL DEFAULT 0,
       outcome TEXT NOT NULL,
       description TEXT NOT NULL,
       agent_type TEXT NOT NULL,
       text TEXT NOT NULL,
       state TEXT NOT NULL,
       target_device_id TEXT,
       attempts INTEGER NOT NULL DEFAULT 0,
       delivered_via TEXT,
       created_at INTEGER NOT NULL,
       updated_at INTEGER NOT NULL,
       delivered_at INTEGER
     )`,
    "CREATE INDEX agent_report_outbox_requester ON agent_report_outbox (requester_id, requester_generation)",
    "CREATE INDEX agent_report_outbox_thread ON agent_report_outbox (thread_id, attempt_generation)",
    "CREATE INDEX agent_report_outbox_device ON agent_report_outbox (target_device_id, state) WHERE target_device_id IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS agent_threads_parent ON agent_threads (parent_thread_id) WHERE parent_thread_id IS NOT NULL",
  ],
};

const readThread = (db: OwnerDbReader, threadId: string): ThreadRow | null =>
  db.one<ThreadRow>(
    "SELECT * FROM agent_threads WHERE thread_id = ?",
    threadId,
  );

const readOutbox = (db: OwnerDbReader, reportId: string): OutboxRow | null =>
  db.one<OutboxRow>(
    "SELECT * FROM agent_report_outbox WHERE report_id = ?",
    reportId,
  );

const queuedInput = (db: OwnerDbReader, thread: ThreadRow): boolean =>
  Boolean(
    db.one(
      `SELECT 1 AS found FROM agent_commands
        WHERE thread_id = ? AND state = 'pending' AND kind IN ('message', 'resume') LIMIT 1`,
      thread.thread_id,
    ),
  ) ||
  Boolean(
    db.one(
      `SELECT 1 AS found FROM agent_report_outbox
        WHERE requester_kind = 'agent' AND requester_id = ? AND requester_generation = ?
          AND requester_was_live = 0 AND state <> 'dropped' LIMIT 1`,
      thread.thread_id,
      thread.attempt_generation,
    ),
  );

const liveDescendants = (db: OwnerDbReader, threadId: string): string[] =>
  db
    .all<{ thread_id: string }>(
      `WITH RECURSIVE tree(thread_id, depth) AS (
         SELECT thread_id, 1 FROM agent_threads WHERE parent_thread_id = ?
         UNION
         SELECT child.thread_id, tree.depth + 1 FROM agent_threads child
           JOIN tree ON child.parent_thread_id = tree.thread_id
          WHERE tree.depth < ${TREE_DEPTH_MAX}
       )
       SELECT DISTINCT t.thread_id FROM tree CROSS JOIN agent_threads t ON t.thread_id = tree.thread_id
        WHERE t.status IN ${WORKING_STATUSES_SQL}
           OR EXISTS (SELECT 1 FROM agent_commands c
                       WHERE c.thread_id = t.thread_id AND c.state = 'pending' AND c.kind IN ('message', 'resume'))
           OR EXISTS (SELECT 1 FROM agent_report_outbox o
                       WHERE o.requester_kind = 'agent' AND o.requester_id = t.thread_id
                         AND o.requester_generation = t.attempt_generation
                         AND o.requester_was_live = 0 AND o.state <> 'dropped')
        LIMIT 8`,
      threadId,
    )
    .map((row) => row.thread_id);

type Requester =
  | { kind: "agent"; threadId: string; thread: ThreadRow | null }
  | { kind: "conversation"; conversationId: string };

const conversationOf = (thread: ThreadRow): string =>
  thread.origin_conversation_id ?? thread.conversation_id;

const requesterOf = (db: OwnerDbReader, thread: ThreadRow): Requester =>
  thread.parent_thread_id && thread.parent_thread_id !== thread.thread_id
    ? {
        kind: "agent",
        threadId: thread.parent_thread_id,
        thread: readThread(db, thread.parent_thread_id),
      }
    : { kind: "conversation", conversationId: conversationOf(thread) };

export const resultTextOf = (resultJson: string | null): string => {
  if (!resultJson) return "";
  try {
    const parsed = JSON.parse(resultJson) as { finalText?: unknown };
    if (parsed && typeof parsed === "object" && "finalText" in parsed) {
      return typeof parsed.finalText === "string" ? parsed.finalText.trim() : "";
    }
  } catch {
    return resultJson.trim();
  }
  return resultJson.trim();
};

const reportText = (thread: ThreadRow, outcome: AgentReportOutcome): string => {
  if (outcome === "completed") {
    return boundReportText(resultTextOf(thread.result_json) || silentRunReport({}), thread.thread_id);
  }
  return boundReportText(
    thread.error_message?.trim() ||
      (outcome === "canceled" ? "The agent was stopped." : "The agent failed."),
    thread.thread_id,
  );
};

const deliveryJobId = (reportId: string): string => `agent-report:${reportId}`;

const scheduleDelivery = (
  db: OwnerDb,
  reportId: string,
  runAt: number,
): void => {
  db.run(
    `INSERT INTO owner_jobs (id, kind, run_at, payload, attempts) VALUES (?, ?, ?, ?, 0)
     ON CONFLICT (id) DO UPDATE SET kind = excluded.kind, run_at = excluded.run_at,
       payload = excluded.payload, attempts = 0`,
    deliveryJobId(reportId),
    AGENT_REPORT_JOB,
    Math.max(0, Math.floor(runAt)),
    JSON.stringify({ reportId }),
  );
};

const auditJobId = (threadId: string, attemptGeneration: number): string =>
  `agent-report-audit:${threadId}:${attemptGeneration}`;

const scheduleAudit = (
  db: OwnerDb,
  thread: Pick<ThreadRow, "thread_id" | "attempt_generation">,
  runAt: number,
  checks: number,
  replace: boolean,
): void => {
  db.run(
    `INSERT INTO owner_jobs (id, kind, run_at, payload, attempts) VALUES (?, ?, ?, ?, 0)
     ON CONFLICT (id) DO ${replace ? "UPDATE SET run_at = excluded.run_at, payload = excluded.payload, attempts = 0" : "NOTHING"}`,
    auditJobId(thread.thread_id, thread.attempt_generation),
    AGENT_REPORT_AUDIT_JOB,
    Math.max(0, Math.floor(runAt)),
    JSON.stringify({
      threadId: thread.thread_id,
      attemptGeneration: thread.attempt_generation,
      checks,
    }),
  );
};

/** A finished agent whose report waits for its own agents still at work. */
export const reportHeldForHelpers = (
  db: OwnerDbReader,
  thread: Pick<ThreadRow, "thread_id" | "attempt_generation" | "status" | "origin_delivery_ack_at">,
): boolean =>
  thread.status === "completed" &&
  thread.origin_delivery_ack_at === null &&
  !readOutbox(db, agentReportId(thread.thread_id, thread.attempt_generation)) &&
  liveDescendants(db, thread.thread_id).length > 0;

export const deriveAgentReport = (
  db: OwnerDb,
  threadId: string,
  now: number,
): void => {
  const thread = readThread(db, threadId);
  if (!thread || !REPORTABLE.has(thread.status)) return;
  if (thread.status === "canceled" && isAgentStopReason(thread.error_message)) return;
  if (thread.origin_delivery_ack_at !== null) return;
  const reportId = agentReportId(thread.thread_id, thread.attempt_generation);
  if (
    db.one("SELECT 1 AS found FROM agent_events WHERE event_key = ?", reportId)
  ) {
    return;
  }
  scheduleAudit(db, thread, now + REPORT_AUDIT_FIRST_MS, 0, false);
  const outcome = thread.status as AgentReportOutcome;
  const queued = queuedInput(db, thread);
  const helpers =
    !queued && outcome === "completed"
      ? liveDescendants(db, thread.thread_id)
      : [];
  if (queued || helpers.length > 0) {
    appendAgentEvent(db, {
      key: `report_deferred:${thread.thread_id}:${thread.attempt_generation}`,
      kind: "report_deferred",
      source: "ledger",
      threadId: thread.thread_id,
      conversationId: thread.conversation_id,
      attemptGeneration: thread.attempt_generation,
      status: thread.status,
      detail: queued ? { queuedInput: true } : { helpers },
      createdAt: now,
    });
    return;
  }
  const requester = requesterOf(db, thread);
  appendAgentEvent(db, {
    key: reportId,
    kind: "report",
    source: "ledger",
    threadId: thread.thread_id,
    conversationId: thread.conversation_id,
    attemptGeneration: thread.attempt_generation,
    status: thread.status,
    outcome,
    detail: {
      reportId,
      requester:
        requester.kind === "agent"
          ? { kind: "agent", threadId: requester.threadId }
          : { kind: "conversation", conversationId: requester.conversationId },
    },
    createdAt: now,
  });
  db.run(
    `INSERT INTO agent_report_outbox
       (report_id, kind, thread_id, attempt_generation, conversation_id, owner_generation, requester_kind,
        requester_id, requester_generation, requester_was_live, outcome, description, agent_type, text,
        state, attempts, created_at, updated_at)
     VALUES (?, 'report', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)
     ON CONFLICT (report_id) DO NOTHING`,
    reportId,
    thread.thread_id,
    thread.attempt_generation,
    thread.conversation_id,
    thread.owner_generation,
    requester.kind,
    requester.kind === "agent" ? requester.threadId : requester.conversationId,
    requester.kind === "agent"
      ? (requester.thread?.attempt_generation ?? null)
      : null,
    requester.kind === "agent" &&
      requester.thread &&
      LIVE_STATUSES.has(requester.thread.status)
      ? 1
      : 0,
    outcome,
    thread.description,
    thread.agent_type,
    reportText(thread, outcome),
    now,
    now,
  );
  scheduleDelivery(db, reportId, now);
};

const ancestorsOf = (db: OwnerDbReader, threadId: string): string[] => {
  const ancestors: string[] = [];
  const seen = new Set([threadId]);
  let cursor = readThread(db, threadId)?.parent_thread_id ?? null;
  while (cursor && !seen.has(cursor) && ancestors.length < TREE_DEPTH_MAX) {
    seen.add(cursor);
    ancestors.push(cursor);
    cursor = readThread(db, cursor)?.parent_thread_id ?? null;
  }
  return ancestors;
};

const deriveJobReports = (db: OwnerDb, threadId: string, now: number): void => {
  deriveAgentReport(db, threadId, now);
  for (const ancestor of ancestorsOf(db, threadId)) {
    deriveAgentReport(db, ancestor, now);
  }
};

agentChangeHooks.push(deriveJobReports);

const settle = (
  ctx: OwnerContext,
  row: OutboxRow,
  state: "delivered" | "dropped",
  via: string,
  detail?: Record<string, unknown>,
): void => {
  ctx.db.run(
    `UPDATE agent_report_outbox SET state = ?, delivered_via = ?, updated_at = ?,
       delivered_at = CASE WHEN ? = 'delivered' THEN ? ELSE delivered_at END
     WHERE report_id = ? AND state IN ('pending', 'offered')`,
    state,
    via,
    ctx.now,
    state,
    ctx.now,
    row.report_id,
  );
  appendAgentEvent(ctx.db, {
    key: `report_${state}:${row.report_id}`,
    kind: state === "delivered" ? "report_delivered" : "report_dropped",
    source: via,
    threadId: row.kind === "report" ? row.thread_id : null,
    conversationId: row.conversation_id,
    attemptGeneration: row.kind === "report" ? row.attempt_generation : null,
    ...(row.kind === "report" ? { outcome: row.outcome } : {}),
    detail: {
      reportId: row.report_id,
      kind: row.kind,
      requester: row.requester_id,
      ...detail,
    },
    createdAt: ctx.now,
  });
  ctx.jobs.cancel(deliveryJobId(row.report_id));
  // A build that still reads `agentThreads.forDevice` must not take a report
  // the outbox already delivered.
  if (state === "delivered" && row.kind === "report") {
    ctx.db.run(
      `UPDATE agent_threads SET origin_delivery_ack_at = ?
        WHERE thread_id = ? AND attempt_generation = ? AND origin_delivery_ack_at IS NULL`,
      ctx.now,
      row.thread_id,
      row.attempt_generation,
    );
  }
  if (state === "dropped" && row.requester_kind === "agent") {
    deriveJobReports(ctx.db, row.requester_id, ctx.now);
  }
  if (state === "dropped" && row.kind === "report") {
    scheduleAudit(ctx.db, { thread_id: row.thread_id, attempt_generation: row.attempt_generation }, ctx.now, REPORT_AUDIT_CHECKS_MAX - 1, true);
  }
};

const conversationExists = (
  db: OwnerDbReader,
  conversationId: string,
): boolean =>
  Boolean(
    db.one(
      "SELECT 1 AS found FROM conversations WHERE conversation_id = ? AND deleted_at IS NULL",
      conversationId,
    ),
  );

const reportHeading = (outcome: AgentReportOutcome): string =>
  outcome === "completed"
    ? "[Agent completed]"
    : outcome === "canceled"
      ? "[Agent canceled]"
      : "[Agent failed]";

const offerToDevice = (
  ctx: OwnerContext,
  row: OutboxRow,
  deviceId: string,
  epoch: number | null,
): void => {
  ctx.db.run(
    `UPDATE agent_report_outbox SET state = 'offered', target_device_id = ?,
       attempts = attempts + 1, updated_at = ? WHERE report_id = ?`,
    deviceId,
    ctx.now,
    row.report_id,
  );
  appendAgentEvent(ctx.db, {
    key: `report_offered:${row.report_id}:${row.attempts + 1}`,
    kind: "report_offered",
    source: "owner:report-outbox",
    threadId: row.kind === "report" ? row.thread_id : null,
    conversationId: row.conversation_id,
    attemptGeneration: row.kind === "report" ? row.attempt_generation : null,
    detail: {
      reportId: row.report_id,
      kind: row.kind,
      deviceId,
      ...(epoch !== null ? { brainEpoch: epoch } : {}),
    },
    createdAt: ctx.now,
  });
  ctx.jobs.schedule(
    AGENT_REPORT_JOB,
    ctx.now + AGENT_REPORT_OFFER_MS,
    { reportId: row.report_id },
    { id: deliveryJobId(row.report_id) },
  );
};

const brainDevice = async (
  ctx: OwnerContext,
  row: OutboxRow,
  sender: string | null,
): Promise<{ deviceId: string; epoch: number | null } | null> => {
  const target = await ctx.host.agentReportTarget({
    conversationId: row.requester_id,
    ownerGeneration: row.owner_generation ?? "",
  });
  if (target.kind === "device") {
    return {
      deviceId: resolveCurrentDeviceId(ctx.db, target.deviceId),
      epoch: target.epoch,
    };
  }
  if (target.kind === "sender" && sender) {
    return { deviceId: resolveCurrentDeviceId(ctx.db, sender), epoch: null };
  }
  return null;
};

const deliverToConversation = async (
  ctx: OwnerContext,
  row: OutboxRow,
  thread: ThreadRow | null,
): Promise<void> => {
  if (!conversationExists(ctx.db, row.requester_id)) {
    settle(ctx, row, "dropped", "owner:report-outbox", {
      reason: "conversation_gone",
    });
    return;
  }
  const sender =
    row.kind === "report"
      ? (thread?.origin_device_id ?? null)
      : (readThread(ctx.db, row.thread_id)?.origin_device_id ?? null);
  const device = await brainDevice(ctx, row, sender);
  if (device) {
    offerToDevice(ctx, row, device.deviceId, device.epoch);
    return;
  }
  const ownerGeneration =
    row.owner_generation ?? thread?.owner_generation ?? "";
  if (row.kind === "note") {
    await ctx.host.startAgentMessageTurn({
      ownerGeneration,
      conversationId: row.requester_id,
      clientMsgId: row.report_id,
      prompt: row.text,
    });
  } else {
    await ctx.host.deliverAgentCompletion({
      ownerGeneration,
      conversationId: row.requester_id,
      threadId: row.thread_id,
      attemptGeneration: row.attempt_generation,
      description: row.description,
      status: row.outcome,
      ...(row.outcome === "completed"
        ? { resultJson: JSON.stringify({ finalText: row.text }) }
        : { errorMessage: row.text }),
      threadUpdatedAt: thread?.updated_at ?? row.created_at,
      clientMsgId: agentReportReceipt(row.report_id),
    });
  }
  settle(ctx, row, "delivered", "cloud");
};

const route = async (ctx: OwnerContext, row: OutboxRow): Promise<void> => {
  const thread =
    row.kind === "report" ? readThread(ctx.db, row.thread_id) : null;
  if (row.requester_kind === "agent") {
    const parent = readThread(ctx.db, row.requester_id);
    if (!parent) {
      throw new Error(
        `${row.requester_id}, which started ${row.thread_id}, is not recorded yet.`,
      );
    }
    await deliverReportToAgent(ctx, {
      reportId: row.report_id,
      parentThreadId: parent.thread_id,
      ownerGeneration: row.owner_generation ?? parent.owner_generation ?? "",
      text: `${reportHeading(row.outcome)} ${row.description.trim() || row.thread_id} (thread ${row.thread_id})\n\n${row.text}`,
      fromThreadId: row.thread_id,
    });
    settle(ctx, row, "delivered", `agent:${parent.thread_id}`);
    return;
  }
  await deliverToConversation(ctx, row, thread);
};

const deliver = async (ctx: OwnerContext, payload: unknown): Promise<void> => {
  const reportId = (payload as { reportId?: unknown } | null)?.reportId;
  if (typeof reportId !== "string") return;
  const row = readOutbox(ctx.db, reportId);
  if (!row || (row.state !== "pending" && row.state !== "offered")) return;
  try {
    await route(ctx, row);
  } catch (error) {
    const failures =
      (ctx.db.one<{ failures: number }>(
        "SELECT COUNT(*) AS failures FROM agent_events WHERE event_key > ? AND event_key < ?",
        `report_failed:${row.report_id}:`,
        `report_failed:${row.report_id};`,
      )?.failures ?? 0) + 1;
    const reason =
      error instanceof Error
        ? error.message.slice(0, 300)
        : String(error).slice(0, 300);
    appendAgentEvent(ctx.db, {
      key: `report_failed:${row.report_id}:${failures}`,
      kind: "report_failed",
      source: "owner:report-outbox",
      threadId: row.kind === "report" ? row.thread_id : null,
      conversationId: row.conversation_id,
      attemptGeneration: row.kind === "report" ? row.attempt_generation : null,
      detail: { reportId: row.report_id, kind: row.kind, reason },
      createdAt: ctx.now,
    });
    const current = readOutbox(ctx.db, reportId);
    if (
      failures >= REPORT_DELIVERY_ATTEMPTS_MAX &&
      current &&
      (current.state === "pending" || current.state === "offered")
    ) {
      settle(ctx, current, "dropped", "owner:report-outbox", { reason });
      return;
    }
    throw error;
  }
};

const missingReportNote = (
  ctx: OwnerContext,
  thread: ThreadRow,
  reason: string,
): void => {
  const requester = requesterOf(ctx.db, thread);
  appendAgentEvent(ctx.db, {
    key: `report_missing:${thread.thread_id}:${thread.attempt_generation}`,
    kind: "report_missing",
    source: "owner:report-audit",
    threadId: thread.thread_id,
    conversationId: thread.conversation_id,
    attemptGeneration: thread.attempt_generation,
    status: thread.status,
    detail: { reason },
    createdAt: ctx.now,
  });
  if (requester.kind !== "conversation" || !conversationExists(ctx.db, requester.conversationId)) return;
  const outcome = thread.status as AgentReportOutcome;
  queueStellaNote(ctx, {
    noteId: `missing:${agentReportReceipt(agentReportId(thread.thread_id, thread.attempt_generation))}`,
    conversationId: requester.conversationId,
    ownerGeneration: thread.owner_generation ?? "",
    fromThreadId: thread.thread_id,
    text: [
      "[Agent report missing]",
      `description: ${thread.description}`,
      `thread_id: ${thread.thread_id}`,
      `status: ${thread.status}`,
      `problem: it finished, but its report could not be delivered (${reason}).`,
      `${outcome === "completed" ? "result" : "error"}: ${reportText(thread, outcome)}`,
    ].join("\n"),
  });
};

// Every finished attempt gets one look a few minutes later: a report that was
// never derived is derived now, one that was dropped is told to Stella, and a
// report still waiting (helpers at work, an offline computer) is looked at again.
const auditReport = async (ctx: OwnerContext, payload: unknown): Promise<void> => {
  const args = payload as { threadId?: unknown; attemptGeneration?: unknown; checks?: unknown } | null;
  if (typeof args?.threadId !== "string" || typeof args.attemptGeneration !== "number") return;
  const checks = typeof args.checks === "number" ? args.checks : 0;
  const thread = readThread(ctx.db, args.threadId);
  if (!thread || thread.attempt_generation !== args.attemptGeneration || !REPORTABLE.has(thread.status)) return;
  if (thread.status === "canceled" && isAgentStopReason(thread.error_message)) return;
  if (thread.origin_delivery_ack_at !== null) return;
  const again = () => {
    if (checks + 1 >= REPORT_AUDIT_CHECKS_MAX) return;
    scheduleAudit(
      ctx.db,
      thread,
      ctx.now + Math.min(REPORT_AUDIT_MAX_MS, REPORT_AUDIT_FIRST_MS * 2 ** (checks + 1)),
      checks + 1,
      true,
    );
  };
  const reportId = agentReportId(thread.thread_id, thread.attempt_generation);
  let row = readOutbox(ctx.db, reportId);
  if (!row) {
    deriveAgentReport(ctx.db, thread.thread_id, ctx.now);
    row = readOutbox(ctx.db, reportId);
    if (row) {
      appendAgentEvent(ctx.db, {
        key: `report_missing:${reportId}:derived`,
        kind: "report_missing",
        source: "owner:report-audit",
        threadId: thread.thread_id,
        conversationId: thread.conversation_id,
        attemptGeneration: thread.attempt_generation,
        status: thread.status,
        detail: { recovered: "derived" },
        createdAt: ctx.now,
      });
      again();
      return;
    }
    if (queuedInput(ctx.db, thread) || liveDescendants(ctx.db, thread.thread_id).length > 0) {
      again();
      return;
    }
    missingReportNote(ctx, thread, "no report was ever recorded for it");
    return;
  }
  if (row.state === "delivered") return;
  if (row.state === "dropped") {
    const dropped = ctx.db.one<{ detail: string | null }>(
      "SELECT detail FROM agent_events WHERE event_key = ?",
      `report_dropped:${reportId}`,
    );
    let reason = "delivery kept failing";
    try {
      const detail = JSON.parse(dropped?.detail ?? "{}") as { reason?: unknown };
      if (typeof detail.reason === "string" && detail.reason.trim()) reason = detail.reason.trim().slice(0, 300);
    } catch {
      // The default reason stands.
    }
    if (reason !== "conversation_gone") missingReportNote(ctx, thread, reason);
    return;
  }
  if (!ctx.db.one("SELECT 1 AS found FROM owner_jobs WHERE id = ?", deliveryJobId(reportId))) {
    scheduleDelivery(ctx.db, reportId, ctx.now);
  }
  again();
};

export const queueStellaNote = (
  ctx: OwnerContext,
  args: {
    noteId: string;
    conversationId: string;
    ownerGeneration: string;
    fromThreadId: string;
    text: string;
  },
): void => {
  ctx.db.run(
    `INSERT INTO agent_report_outbox
       (report_id, kind, thread_id, attempt_generation, conversation_id, owner_generation, requester_kind,
        requester_id, outcome, description, agent_type, text, state, attempts, created_at, updated_at)
     VALUES (?, 'note', ?, 0, ?, ?, 'conversation', ?, 'completed', '', '', ?, 'pending', 0, ?, ?)
     ON CONFLICT (report_id) DO NOTHING`,
    args.noteId,
    args.fromThreadId,
    args.conversationId,
    args.ownerGeneration,
    args.conversationId,
    args.text,
    ctx.now,
    ctx.now,
  );
  scheduleDelivery(ctx.db, args.noteId, ctx.now);
};

const acknowledge = (
  ctx: OwnerContext,
  args: { deviceId: string; ownerGeneration: string; reportId: string },
): { acknowledged: boolean } => {
  const deviceId = resolveCurrentDeviceId(ctx.db, args.deviceId);
  const row = readOutbox(ctx.db, args.reportId);
  if (!row || row.owner_generation !== args.ownerGeneration) {
    throw new RpcError(
      "NOT_FOUND",
      "That report is not waiting for this device.",
    );
  }
  if (row.state !== "offered" || row.target_device_id !== deviceId) {
    return { acknowledged: false };
  }
  settle(ctx, row, "delivered", `device:${deviceId}`);
  return { acknowledged: true };
};

const deviceReports = (
  db: OwnerDbReader,
  args: { deviceId: string; ownerGeneration: string },
): DeviceAgentReport[] =>
  db
    .all<OutboxRow>(
      `SELECT * FROM agent_report_outbox
        WHERE target_device_id = ? AND state = 'offered' AND owner_generation = ?
        ORDER BY created_at ASC LIMIT 50`,
      resolveCurrentDeviceId(db, args.deviceId),
      args.ownerGeneration,
    )
    .map((row) => ({
      reportId: row.report_id,
      kind: row.kind,
      threadId: row.thread_id,
      attemptGeneration: row.attempt_generation,
      conversationId: row.requester_id,
      ownerGeneration: row.owner_generation ?? args.ownerGeneration,
      description: row.description,
      agentType: row.agent_type,
      outcome: row.outcome,
      text: row.text,
      createdAt: row.created_at,
    }));

export const deleteConversationAgentReports = (
  db: OwnerDb,
  jobs: OwnerContext["jobs"],
  conversationId: string,
): void => {
  for (const { report_id } of db.all<{ report_id: string }>(
    `SELECT report_id FROM agent_report_outbox WHERE conversation_id = ? OR requester_id = ?
        OR thread_id IN (SELECT thread_id FROM agent_threads WHERE conversation_id = ?)`,
    conversationId,
    conversationId,
    conversationId,
  )) {
    jobs.cancel(deliveryJobId(report_id));
    db.run("DELETE FROM agent_report_outbox WHERE report_id = ?", report_id);
  }
};

const id = (max = 256) => string({ min: 1, max });
const noteParser = object({
  ownerGeneration: id(512),
  noteId: id(64),
  conversationId: id(),
  fromThreadId: id(),
  text: string({ min: 1, max: 40_000 }),
});

export const AGENT_REPORTS_STOP_MIGRATION = {
  id: "agent-reports.2-stop-replaces-pause",
  statements: [
    `UPDATE agent_threads SET status = 'canceled', error_message = '${AGENT_STOPPED_REASON}' WHERE status = 'paused'`,
    "UPDATE agent_turns SET status = 'canceled' WHERE status = 'paused'",
    "UPDATE agent_commands SET kind = 'stop' WHERE kind = 'pause'",
    `INSERT INTO owner_jobs (id, kind, run_at, payload, attempts)
       SELECT 'agent-report:' || o.report_id, '${AGENT_REPORT_JOB}', 0, json_object('reportId', o.report_id), 0
         FROM agent_report_outbox o
        WHERE o.requester_kind = 'agent' AND o.state = 'pending'
          AND NOT EXISTS (SELECT 1 FROM owner_jobs j WHERE j.id = 'agent-report:' || o.report_id)`,
  ],
};

export const agentReportsDomain = {
  name: "agent-reports",
  migrations: [AGENT_REPORTS_MIGRATION, AGENT_REPORTS_STOP_MIGRATION],
  calls: {
    "agentReports.note": {
      scope: "owner",
      parse: noteParser,
      handler: (ctx, args) => {
        queueStellaNote(ctx, args);
        return { queued: true };
      },
    },
    "agentReports.acknowledge": {
      scope: "owner",
      parse: object({
        deviceId: id(),
        ownerGeneration: id(512),
        reportId: id(512),
      }),
      handler: acknowledge,
    },
  },
  views: {
    "agentReports.forDevice": {
      parse: object({ deviceId: id(), ownerGeneration: id(512) }),
      read: (ctx, args) => deviceReports(ctx.db, args),
    },
  },
  internal: {
    "agentReports.note": (ctx, raw) => {
      queueStellaNote(ctx, noteParser(raw));
      return { queued: true };
    },
  },
  jobs: {
    [AGENT_REPORT_JOB]: {
      run: deliver,
      maxAttempts: REPORT_DELIVERY_ATTEMPTS_MAX + 5,
    },
    [AGENT_REPORT_AUDIT_JOB]: {
      run: auditReport,
      maxAttempts: 3,
    },
  },
} satisfies OwnerDomain;
