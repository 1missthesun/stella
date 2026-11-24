import { isAgentStopReason } from "@stella/contracts/agent-status";
import { agentInputSender, sentByStarter } from "@stella/contracts/agent-rules";
import type { AgentInvariantKind, AgentInvariantReport } from "@stella/contracts/backend/agent-threads";
import type { OwnerDbReader } from "../registry.js";

const EXAMPLES_MAX = 5;
const SCAN_MAX = 5_000;


const parse = (json: string | null): Record<string, unknown> => {
  if (!json) return {};
  try {
    const value = JSON.parse(json) as unknown;
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return {};
  }
};


export const agentInvariants = (db: OwnerDbReader, now: number, days: number): AgentInvariantReport => {
  const since = now - days * 24 * 60 * 60_000;
  const found = new Map<AgentInvariantKind, string[]>();
  const add = (kind: AgentInvariantKind, example: string) => found.set(kind, [...(found.get(kind) ?? []), example]);

  for (const row of db.all<{ report_id: string; thread_id: string; kind: string; parent: string }>(
    `SELECT o.report_id, o.thread_id, o.kind, t.parent_thread_id AS parent
       FROM agent_report_outbox o JOIN agent_threads t ON t.thread_id = o.thread_id
      WHERE o.created_at >= ? AND o.kind = 'report' AND o.requester_kind = 'conversation'
        AND t.parent_thread_id IS NOT NULL AND t.parent_thread_id <> t.thread_id
      LIMIT ${SCAN_MAX}`,
    since,
  )) {
    add("report_to_stella_not_lead", `${row.kind} ${row.report_id} from ${row.thread_id} (lead ${row.parent})`);
  }

  for (const row of db.all<{ report_id: string; thread_id: string }>(
    `SELECT report_id, thread_id FROM agent_report_outbox
      WHERE state = 'dropped' AND updated_at >= ? LIMIT ${SCAN_MAX}`,
    since,
  )) {
    add("report_lost", `dropped ${row.report_id} (${row.thread_id})`);
  }
  for (const row of db.all<{ thread_id: string; attempt_generation: number | null }>(
    `SELECT thread_id, attempt_generation FROM agent_events
      WHERE kind = 'report_missing' AND created_at >= ? LIMIT ${SCAN_MAX}`,
    since,
  )) {
    add("report_lost", `missing ${row.thread_id}:${row.attempt_generation ?? "?"}`);
  }

  for (const row of db.all<{ thread_id: string; attempt_generation: number | null }>(
    `SELECT thread_id, attempt_generation FROM agent_events
      WHERE kind = 'terminal_ignored' AND created_at >= ? AND event_key LIKE 'turn_end_dropped:%' LIMIT ${SCAN_MAX}`,
    since,
  )) {
    add("report_lost", `turn end dropped ${row.thread_id}:${row.attempt_generation ?? "?"}`);
  }

  for (const row of db.all<{ seq: number; thread_id: string; detail: string | null }>(
    `SELECT seq, thread_id, detail FROM agent_events
      WHERE kind = 'resumed' AND created_at >= ? AND thread_id IS NOT NULL LIMIT ${SCAN_MAX}`,
    since,
  )) {
    const detail = parse(row.detail);
    const trigger = String(detail.messageId ?? detail.reportId ?? "");
    const from = typeof detail.from === "string" ? detail.from : undefined;
    const task = db.one<{ parent_thread_id: string | null; conversation_id: string; origin_conversation_id: string | null }>(
      "SELECT parent_thread_id, conversation_id, origin_conversation_id FROM agent_threads WHERE thread_id = ?",
      row.thread_id,
    );
    const byStarter =
      from === undefined ||
      sentByStarter(
        { parentThreadId: task?.parent_thread_id, conversationIds: [task?.conversation_id, task?.origin_conversation_id] },
        from,
      );
    if (agentInputSender({ id: trigger, byStarter }) !== "other") continue;
    const before = db.one<{ kind: string; thread_patch: string | null; detail: string | null }>(
      `SELECT kind, thread_patch, detail FROM agent_events
        WHERE thread_id = ? AND seq < ?
          AND kind IN ('canceled', 'paused', 'completed', 'failed', 'attempt_ended', 'waiting_for_user', 'attempt_started', 'resumed', 'spawned')
        ORDER BY seq DESC LIMIT 1`,
      row.thread_id,
      row.seq,
    );
    if (!before || before.kind !== "canceled") continue;
    const error = parse(before.thread_patch).error_message;
    if (!isAgentStopReason(typeof error === "string" ? error : null) && parse(before.detail).stopped !== true) continue;
    add("stopped_task_took_input", `${row.thread_id} resumed by ${trigger || from || "?"}`);
  }
  for (const row of db.all<{ thread_id: string; detail: string | null }>(
    `SELECT thread_id, detail FROM agent_events
      WHERE kind = 'terminal_ignored' AND created_at >= ? AND event_key LIKE 'hosted_turn_ignored:%' LIMIT ${SCAN_MAX}`,
    since,
  )) {
    if (parse(row.detail).reason === "stopped") add("stopped_task_took_input", `${row.thread_id} ran a turn after its stop`);
  }

  for (const row of db.all<{ thread_id: string; attempt_generation: number; sources: string }>(
    `SELECT thread_id, attempt_generation, group_concat(DISTINCT source) AS sources FROM agent_events
      WHERE created_at >= ? AND thread_id IS NOT NULL AND attempt_generation IS NOT NULL
        AND source LIKE 'device:%'
        AND kind IN ('spawned', 'attempt_started', 'resumed', 'completed', 'failed', 'attempt_ended', 'waiting_for_user')
        AND NOT (kind = 'spawned' AND COALESCE(json_extract(detail, '$.executor'), '') <> 'local')
      GROUP BY thread_id, attempt_generation
     HAVING COUNT(DISTINCT source) > 1
      LIMIT ${SCAN_MAX}`,
    since,
  )) {
    add("two_hosts_one_attempt", `${row.thread_id}:${row.attempt_generation} (${row.sources})`);
  }

  const hosted = db.one<{ turns: number; unannounced: number }>(
    `SELECT COUNT(*) AS turns,
            COALESCE(SUM(CASE WHEN json_extract(detail, '$.startMissing') = 1 THEN 1 ELSE 0 END), 0) AS unannounced
       FROM agent_events
      WHERE created_at >= ? AND kind IN ('attempt_started', 'resumed') AND json_extract(detail, '$.executor') = 'hosted'`,
    since,
  ) ?? { turns: 0, unannounced: 0 };

  const kinds: AgentInvariantKind[] = [
    "report_to_stella_not_lead",
    "report_lost",
    "stopped_task_took_input",
    "two_hosts_one_attempt",
  ];
  return {
    since,
    checks: kinds.map((kind) => {
      const examples = found.get(kind) ?? [];
      return { kind, count: examples.length, examples: examples.slice(0, EXAMPLES_MAX) };
    }),
    hostedTurns: { recorded: hosted.turns, withoutStart: hosted.unannounced },
  };
};
