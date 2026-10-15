import { USAGE_LIMIT_AGENT_JOB, USAGE_LIMIT_CONVERSATION_JOB } from "./domains/agent-threads.js";
import { deleteConversationAgentEvents } from "./domains/agent-events.js";
import { deleteConversationAgentLogs } from "./domains/agent-logs.js";
import { AGENT_REPORT_JOB, deleteConversationAgentReports } from "./domains/agent-reports.js";
import type { JobDef, OwnerContext, OwnerDb, OwnerJobs, PurgeDef } from "./registry.js";

const PURGE_BATCH = 25;
const PURGE_JOB_MAX_ATTEMPTS = 30;

export const CONVERSATION_PURGE_JOB = "conversations.purge";

export type ConversationPurgeJob = { conversationId: string };

export const scheduleConversationPurge = (
  jobs: OwnerJobs,
  conversationId: string,
  now: number,
): void => {
  jobs.schedule(
    CONVERSATION_PURGE_JOB,
    now,
    { conversationId } satisfies ConversationPurgeJob,
    { id: `purge:${conversationId}` },
  );
};

const purgeOrchestrator = async (
  env: Cloudflare.Env,
  conversationId: string,
): Promise<boolean> => {
  try {
    const response = await env.ORCHESTRATOR_SESSIONS.getByName(conversationId).fetch(
      "https://orchestrator-session/purge",
      { method: "POST", headers: { "content-type": "application/json" }, body: "{}" },
    );
    if (!response.ok) return false;
    const verdict = (await response.json().catch(() => null)) as { purged?: unknown } | null;
    return verdict?.purged === true;
  } catch {
    return false;
  }
};

const deleteThreadRows = (db: OwnerDb, jobs: OwnerJobs, conversationId: string): void => {
  const turns = db.all<{ turn_id: string }>(
    `SELECT turn_id FROM agent_turns WHERE conversation_id = ?
       OR thread_id IN (SELECT thread_id FROM agent_threads WHERE conversation_id = ?)`,
    conversationId,
    conversationId,
  );
  for (const { turn_id } of turns) {
    jobs.cancel(`dispatch:${turn_id}`);
    db.run("DELETE FROM agent_turn_files WHERE turn_id = ?", turn_id);
    db.run("DELETE FROM agent_dispatch_prompts WHERE turn_id = ?", turn_id);
    db.run("DELETE FROM agent_turns WHERE turn_id = ?", turn_id);
  }
  db.run(
    `DELETE FROM agent_cancel_receipts
      WHERE thread_id IN (SELECT thread_id FROM agent_threads WHERE conversation_id = ?)`,
    conversationId,
  );
  for (const { message_id } of db.all<{ message_id: string }>(
    `SELECT message_id FROM agent_device_messages
      WHERE thread_id IN (SELECT thread_id FROM agent_threads WHERE conversation_id = ?)`,
    conversationId,
  )) {
    jobs.cancel(`devmsg:${message_id}`);
    db.run("DELETE FROM agent_device_messages WHERE message_id = ?", message_id);
  }
  for (const { command_id } of db.all<{ command_id: string }>(
    `SELECT command_id FROM agent_commands
      WHERE thread_id IN (SELECT thread_id FROM agent_threads WHERE conversation_id = ?)`,
    conversationId,
  )) {
    jobs.cancel(`devmsg:${command_id}`);
    db.run("DELETE FROM agent_commands WHERE command_id = ?", command_id);
  }
  deleteConversationAgentReports(db, jobs, conversationId);
  deleteConversationAgentEvents(db, conversationId);
  deleteConversationAgentLogs(db, jobs, conversationId);
  db.run("DELETE FROM agent_threads WHERE conversation_id = ?", conversationId);
};

/**
 * A conversation's catch-ups (`domains/catch-ups.ts`), and any still being
 * written. Kept here rather than imported: that domain imports conversations,
 * which imports this file.
 */
const deleteConversationCatchUps = (db: OwnerDb, jobs: OwnerJobs, conversationId: string): void => {
  for (const { catch_up_id } of db.all<{ catch_up_id: string }>(
    "SELECT catch_up_id FROM catch_ups WHERE conversation_id = ? AND state = 'pending'",
    conversationId,
  )) {
    jobs.cancel(`catchUps.generate:${catch_up_id}`);
  }
  db.run("DELETE FROM catch_ups WHERE conversation_id = ?", conversationId);
};

const runConversationPurge = async (ctx: OwnerContext, payload: unknown): Promise<void> => {
  const { conversationId } = payload as ConversationPurgeJob;
  if (typeof conversationId !== "string" || !conversationId) return;
  if (!(await purgeOrchestrator(ctx.env, conversationId))) {
    throw new Error("The conversation's storage is not purged yet.");
  }
  deleteThreadRows(ctx.db, ctx.jobs, conversationId);
  deleteConversationCatchUps(ctx.db, ctx.jobs, conversationId);
  ctx.db.run(
    `UPDATE conversations SET title = '', last_preview = NULL, last_role = NULL, activity = NULL
      WHERE conversation_id = ? AND deleted_at IS NOT NULL`,
    conversationId,
  );
};

export const conversationPurgeJob: JobDef = {
  maxAttempts: PURGE_JOB_MAX_ATTEMPTS,
  run: runConversationPurge,
};

export const purgeConversationData: PurgeDef = async (ctx) => {
  const conversations = ctx.db.all<{ conversation_id: string }>(
    `SELECT conversation_id FROM conversations
     UNION SELECT conversation_id FROM agent_threads
     ORDER BY conversation_id LIMIT ?`,
    PURGE_BATCH,
  );
  const purged = await Promise.all(
    conversations.map(async ({ conversation_id }) => ({
      conversationId: conversation_id,
      purged: await purgeOrchestrator(ctx.env, conversation_id),
    })),
  );
  for (const { conversationId, purged: done } of purged) {
    if (!done) continue;
    ctx.jobs.cancel(`purge:${conversationId}`);
    deleteThreadRows(ctx.db, ctx.jobs, conversationId);
    ctx.db.run("DELETE FROM conversations WHERE conversation_id = ?", conversationId);
  }
  if (conversations.length === PURGE_BATCH || purged.some((entry) => !entry.purged)) {
    return { pending: true };
  }
  for (const kind of [
    "agentThreads.dispatch",
    "agentThreads.deviceMessage",
    USAGE_LIMIT_AGENT_JOB,
    USAGE_LIMIT_CONVERSATION_JOB,
    AGENT_REPORT_JOB,
    CONVERSATION_PURGE_JOB,
  ]) {
    for (const { id } of ctx.db.all<{ id: string }>(
      "SELECT id FROM owner_jobs WHERE kind = ?",
      kind,
    )) {
      ctx.jobs.cancel(id);
    }
  }
  for (const table of [
    "agent_turn_files",
    "agent_dispatch_prompts",
    "agent_turns",
    "agent_cancel_receipts",
    "agent_message_receipts",
    "agent_device_messages",
    "agent_commands",
    "agent_report_outbox",
    "agent_events",
    "usage_limit_backoff",
    "usage_limit_pauses",
    "conversation_main",
  ]) {
    ctx.db.run(`DELETE FROM ${table}`);
  }
  return { pending: false };
};
