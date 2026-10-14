import type { TaskLifecycleStatus } from "./agent-runtime";
import { agentTaskStatus } from "./agent-ledger";
import { isAgentAttemptOutcome } from "./agent-status";
import { wakePromptOf } from "./agent-wake-prompt";

export type AgentTitleRecord = {
  kind: string;
  role?: string;
  payload?: Record<string, unknown>;
  clientMsgId?: string;
  card?: unknown;
};

export type JournalAgent = {
  title?: string;
  status?: TaskLifecycleStatus;
  followUpTitles?: string[];
};

/**
 * The label a follow-up `send_message` gives a continued cloud thread: its
 * first line, clipped. Older runs stored it as the thread's description, so
 * a description equal to one of these is the follow-up, not the agent's name.
 */
export const followUpLabel = (message: string): string => {
  const firstLine = message
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^task\s*:\s*/i, "");
  if (!firstLine) return "Follow-up";
  return firstLine.length > 80 ? `${firstLine.slice(0, 77).trimEnd()}...` : firstLine;
};

export const isFollowUpTitle = (agent: JournalAgent | undefined, title: string | undefined): boolean =>
  Boolean(title && agent?.followUpTitles?.includes(title.trim()));

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const nonEmpty = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const payloadText = (payload: Record<string, unknown>): string => {
  const content = payload.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      const entry = asRecord(block);
      return entry?.type === "text" && typeof entry.text === "string" ? entry.text : "";
    })
    .join("\n");
};

const parseJson = (text: string): Record<string, unknown> | null => {
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return null;
  }
};

const AGENT_NOTE_RE = /^<agent-message from="([^"\n]*)" thread_id="([^"\n]*)"(?: relation="[^"\n]*")?>/;

const CARD_STATUS: Record<string, TaskLifecycleStatus> = {
  "agent-started": "running",
  "agent-progress": "running",
  "agent-completed": "completed",
  "agent-failed": "error",
  "agent-canceled": "canceled",
};

const cardStatus = (type: string, payload: Record<string, unknown> | null): TaskLifecycleStatus | undefined =>
  (type === "agent-failed" || type === "agent-canceled") && isAgentAttemptOutcome(payload?.status)
    ? agentTaskStatus(payload.status)
    : CARD_STATUS[type];

const LIVE_DELIVERIES = new Set(["steered", "resumed", "delivered_agent_still_working"]);

const wakeAgent = (
  record: AgentTitleRecord,
): { threadId: string; title?: string; status: TaskLifecycleStatus } | null => {
  const wake = wakePromptOf(record.payload, record.clientMsgId);
  if (!wake) return null;
  return {
    threadId: wake.threadId,
    ...(wake.description ? { title: wake.description } : {}),
    status: agentTaskStatus(wake.outcome),
  };
};

export const agentNoteSender = (
  text: string,
): { threadId: string; title: string } | null => {
  const match = AGENT_NOTE_RE.exec(text.trimStart());
  const title = nonEmpty(match?.[1]);
  const threadId = nonEmpty(match?.[2]);
  if (!title || !threadId || title === "Stella") return null;
  return { threadId, title };
};

const agentRecordFlags = new WeakMap<AgentTitleRecord, boolean>();

const touchesAgents = (record: AgentTitleRecord): boolean => {
  if (record.kind !== "message" || !record.payload) return record.kind === "card";
  const cached = agentRecordFlags.get(record);
  if (cached !== undefined) return cached;
  const payload = record.payload;
  let touches = false;
  if (record.role === "assistant") {
    touches =
      Array.isArray(payload.content) &&
      payload.content.some((block) => {
        const entry = asRecord(block);
        return (
          entry?.type === "toolCall" &&
          (entry.name === "spawn_agent" || entry.name === "send_message")
        );
      });
  } else if (record.role === "toolResult") {
    touches =
      payload.toolName === "spawn_agent" ||
      payload.toolName === "send_message" ||
      nonEmpty(asRecord(payload.details)?.thread_id) !== undefined;
  } else if (record.role === "user") {
    touches =
      wakeAgent(record) !== null || agentNoteSender(payloadText(payload)) !== null;
  }
  agentRecordFlags.set(record, touches);
  return touches;
};

const lifecycleCard = (
  card: unknown,
): { threadId: string; title?: string; status?: TaskLifecycleStatus } | null => {
  const value = asRecord(card);
  if (value?.type !== "agent-lifecycle") return null;
  const event = asRecord(value.event);
  const payload = asRecord(event?.payload);
  const threadId = nonEmpty(payload?.agentId);
  if (!threadId || typeof event?.type !== "string") return null;
  const title = event.type === "agent-started" ? nonEmpty(payload?.description) : undefined;
  const status = cardStatus(event.type, payload);
  return { threadId, ...(title ? { title } : {}), ...(status ? { status } : {}) };
};

const resultThreadId = (
  payload: Record<string, unknown>,
  json: Record<string, unknown> | null,
  callThreadId: string | undefined,
): string | undefined =>
  nonEmpty(asRecord(payload.details)?.thread_id) ??
  (payload.toolName === "spawn_agent" || payload.toolName === "send_message"
    ? (nonEmpty(json?.thread_id) ?? callThreadId)
    : undefined);

const resultStatus = (
  payload: Record<string, unknown>,
  json: Record<string, unknown> | null,
): TaskLifecycleStatus | undefined => {
  if (payload.isError === true) return undefined;
  if (payload.toolName === "spawn_agent") return "running";
  if (payload.toolName !== "send_message") return undefined;
  const details = asRecord(payload.details);
  const delivery = nonEmpty(details?.delivered) ?? nonEmpty(json?.delivered) ?? nonEmpty(json?.status);
  return !delivery || LIVE_DELIVERIES.has(delivery) || delivery === "delivered" ? "running" : undefined;
};

export const journalAgents = (
  records: readonly AgentTitleRecord[],
): Map<string, JournalAgent> => {
  const agents = new Map<string, JournalAgent>();
  const hinted = new Map<string, string>();
  const spawnDescriptions = new Map<string, string>();
  const messageTargets = new Map<string, string>();
  const followUps = new Map<string, Set<string>>();
  const agentFor = (threadId: string): JournalAgent => {
    let agent = agents.get(threadId);
    if (!agent) {
      agent = {};
      agents.set(threadId, agent);
    }
    return agent;
  };
  const name = (threadId: string, title: string | undefined) => {
    if (title) agentFor(threadId).title = title;
  };
  const hint = (threadId: string, title: string | undefined) => {
    if (title && !hinted.has(threadId)) hinted.set(threadId, title);
  };
  const settle = (threadId: string, status: TaskLifecycleStatus | undefined) => {
    if (status) agentFor(threadId).status = status;
  };
  for (const record of records) {
    if (!touchesAgents(record)) continue;
    if (record.kind === "card") {
      const card = lifecycleCard(record.card);
      if (!card) continue;
      name(card.threadId, card.title);
      settle(card.threadId, card.status);
      continue;
    }
    if (record.kind !== "message" || !record.payload) continue;
    const payload = record.payload;
    if (record.role === "assistant") {
      if (!Array.isArray(payload.content)) continue;
      for (const block of payload.content) {
        const entry = asRecord(block);
        if (entry?.type !== "toolCall") continue;
        const callId = nonEmpty(entry.id);
        if (!callId) continue;
        const args = asRecord(entry.arguments);
        if (entry.name === "spawn_agent") {
          const description = nonEmpty(args?.description);
          if (description) spawnDescriptions.set(callId, description);
        } else if (entry.name === "send_message") {
          const target = nonEmpty(args?.thread_id);
          if (target) messageTargets.set(callId, target);
          const message = nonEmpty(args?.message);
          if (target && message) {
            const labels = followUps.get(target) ?? new Set<string>();
            labels.add(followUpLabel(message));
            followUps.set(target, labels);
          }
        }
      }
      continue;
    }
    if (record.role === "toolResult") {
      const json = parseJson(payloadText(payload));
      const callId = nonEmpty(payload.toolCallId);
      const threadId = resultThreadId(
        payload,
        json,
        callId && payload.toolName === "send_message" ? messageTargets.get(callId) : undefined,
      );
      if (!threadId) continue;
      name(
        threadId,
        nonEmpty(asRecord(payload.details)?.description) ??
          (payload.toolName === "spawn_agent" && callId
            ? spawnDescriptions.get(callId)
            : undefined),
      );
      settle(threadId, resultStatus(payload, json));
      continue;
    }
    if (record.role === "user") {
      const text = payloadText(payload);
      const wake = wakeAgent(record);
      if (wake) {
        if (!followUps.get(wake.threadId)?.has(wake.title ?? "")) hint(wake.threadId, wake.title);
        settle(wake.threadId, wake.status);
      }
      const note = agentNoteSender(text);
      if (note) {
        hint(note.threadId, note.title);
        settle(note.threadId, "running");
      }
    }
  }
  for (const [threadId, labels] of followUps) {
    const agent = agentFor(threadId);
    agent.followUpTitles = [...labels];
    if (agent.title && labels.has(agent.title)) delete agent.title;
  }
  for (const [threadId, title] of hinted) {
    const agent = agentFor(threadId);
    if (!agent.title && !followUps.get(threadId)?.has(title)) agent.title = title;
  }
  return agents;
};

export const journalAgentTitles = (
  records: readonly AgentTitleRecord[],
): Map<string, string> => {
  const titles = new Map<string, string>();
  for (const [threadId, agent] of journalAgents(records)) {
    if (agent.title) titles.set(threadId, agent.title);
  }
  return titles;
};
