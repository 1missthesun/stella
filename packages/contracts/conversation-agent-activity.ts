import { agentTaskStatus } from "./agent-ledger.js";
import { wakePromptOf } from "./agent-wake-prompt.js";
import {
  cloudAgentLifecycleStatus,
  parseCloudAgentLifecycleCard,
} from "./cloud-agent-lifecycle.js";

export type AgentActivityStatus =
  | "running"
  | "completed"
  | "error"
  | "canceled";

export type AgentActivityEntry = {
  agentId: string;
  title: string;
  agentType?: string;
  status: AgentActivityStatus;
  statusText?: string;
  createdAtMs: number;
  updatedAtMs: number;
  completedAtMs?: number;
  attemptGeneration?: number;
  result?: string;
  error?: string;
};

export type AgentActivityState = {
  entries: Map<string, AgentActivityEntry>;
  generations: Map<string, number>;
  settledGenerations: Map<string, number>;
  carded: Set<string>;
};

export type AgentActivityRecordInput = {
  kind: string;
  createdAtMs: number;
  role?: string | undefined;
  hidden?: boolean | undefined;
  clientMsgId?: string | undefined;
  payload?: Record<string, unknown> | undefined;
  card?: unknown;
};

export const emptyAgentActivityState = (): AgentActivityState => ({
  entries: new Map(),
  generations: new Map(),
  settledGenerations: new Map(),
  carded: new Set(),
});

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

export const agentActivityMessageText = (
  payload: Record<string, unknown> | undefined,
): string => {
  const content = payload?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((entry) => {
      const block = asRecord(entry);
      return typeof block?.text === "string" ? block.text : "";
    })
    .join("\n");
};

export const bareToolName = (name: string): string =>
  name.includes("__") ? (name.split("__").at(-1) ?? name) : name;

export const agentToolResultThreadId = (
  payload: Record<string, unknown> | undefined,
): string | null => {
  const details = asRecord(payload?.details);
  if (typeof details?.thread_id === "string" && details.thread_id) {
    return details.thread_id;
  }
  try {
    const parsed = asRecord(JSON.parse(agentActivityMessageText(payload)));
    return typeof parsed?.thread_id === "string" && parsed.thread_id
      ? parsed.thread_id
      : null;
  } catch {
    return null;
  }
};

const toolResultField = (
  payload: Record<string, unknown> | undefined,
  field: string,
): string | undefined => {
  const details = asRecord(payload?.details);
  if (typeof details?.[field] === "string") return details[field] as string;
  try {
    const parsed = asRecord(JSON.parse(agentActivityMessageText(payload)));
    return typeof parsed?.[field] === "string" ? (parsed[field] as string) : undefined;
  } catch {
    return undefined;
  }
};

export type AgentActivityToolCall = {
  name: string;
  description?: string;
  threadId?: string;
};

type ToolCall = AgentActivityToolCall;

const collectToolCalls = (
  records: readonly AgentActivityRecordInput[],
  into: Map<string, ToolCall>,
): Map<string, ToolCall> => {
  for (const record of records) {
    if (record.kind !== "message" || record.role !== "assistant") continue;
    const content = record.payload?.content;
    if (!Array.isArray(content)) continue;
    for (const entry of content) {
      const block = asRecord(entry);
      if (block?.type !== "toolCall" || typeof block.id !== "string") continue;
      if (typeof block.name !== "string") continue;
      const args = asRecord(block.arguments);
      into.set(block.id, {
        name: bareToolName(block.name),
        ...(typeof args?.description === "string" && args.description.trim()
          ? { description: args.description.trim() }
          : {}),
        ...(typeof args?.thread_id === "string" && args.thread_id
          ? { threadId: args.thread_id }
          : {}),
      });
    }
  }
  return into;
};

export const foldAgentActivity = (
  state: AgentActivityState,
  records: readonly AgentActivityRecordInput[],
  options?: { toolCalls?: Map<string, ToolCall>; outcomes?: boolean },
): AgentActivityState => {
  for (const record of records) {
    if (record.kind !== "card") continue;
    const card = parseCloudAgentLifecycleCard(record.card);
    if (card?.event.type === "agent-started") {
      state.carded.add(card.event.payload.agentId);
    }
  }
  const calls = collectToolCalls(records, options?.toolCalls ?? new Map());

  const start = (
    agentId: string,
    title: string | undefined,
    at: number,
    extra: Partial<AgentActivityEntry> = {},
  ): void => {
    const existing = state.entries.get(agentId);
    const resolvedTitle = title?.trim() || existing?.title;
    if (!resolvedTitle) return;
    state.entries.set(agentId, {
      agentId,
      title: resolvedTitle,
      status: "running",
      createdAtMs: at,
      updatedAtMs: at,
      ...(existing?.agentType ? { agentType: existing.agentType } : {}),
      ...extra,
    });
  };

  const settle = (
    agentId: string,
    status: AgentActivityStatus,
    at: number,
    outcome: { result?: string; error?: string } = {},
  ): void => {
    const existing = state.entries.get(agentId);
    if (!existing || existing.status !== "running") return;
    const { statusText: _statusText, ...rest } = existing;
    const result = options?.outcomes ? outcome.result?.trim() : undefined;
    const error = options?.outcomes ? outcome.error?.trim() : undefined;
    state.entries.set(agentId, {
      ...rest,
      status,
      completedAtMs: at,
      updatedAtMs: at,
      ...(result ? { result } : {}),
      ...(error ? { error } : {}),
    });
  };

  for (const record of records) {
    if (record.kind === "card") {
      const card = parseCloudAgentLifecycleCard(record.card);
      if (!card) continue;
      const { event } = card;
      const agentId = event.payload.agentId;
      const generation = event.payload.attemptGeneration;
      const current = state.generations.get(agentId) ?? 0;
      if (event.type === "agent-started") {
        if (generation < current) continue;
        if (generation <= (state.settledGenerations.get(agentId) ?? 0)) {
          continue;
        }
        state.generations.set(agentId, generation);
        start(agentId, event.payload.description, record.createdAtMs, {
          ...(event.payload.agentType
            ? { agentType: event.payload.agentType }
            : {}),
          ...(event.payload.statusText?.trim()
            ? { statusText: event.payload.statusText.trim() }
            : {}),
          attemptGeneration: generation,
        });
        continue;
      }
      if (event.type !== "agent-progress") {
        state.settledGenerations.set(
          agentId,
          Math.max(generation, state.settledGenerations.get(agentId) ?? 0),
        );
      }
      if (generation !== current && state.generations.has(agentId)) continue;
      if (event.type === "agent-progress") {
        if (!state.generations.has(agentId)) continue;
        const existing = state.entries.get(agentId);
        const statusText = event.payload.statusText.trim();
        if (existing?.status === "running" && statusText) {
          state.entries.set(agentId, {
            ...existing,
            statusText,
            updatedAtMs: record.createdAtMs,
          });
        }
        continue;
      }
      settle(
        agentId,
        agentTaskStatus(cloudAgentLifecycleStatus(event)),
        record.createdAtMs,
        event.type === "agent-completed" ? { result: event.payload.result } : { error: event.payload.error },
      );
      continue;
    }
    if (record.kind !== "message") continue;

    if (record.role === "user" && record.hidden) {
      const wake = wakePromptOf(record.payload, record.clientMsgId);
      if (!wake || state.carded.has(wake.threadId)) continue;
      settle(
        wake.threadId,
        agentTaskStatus(wake.outcome),
        record.createdAtMs,
        wake.outcome === "completed" ? { result: wake.body } : { error: wake.body },
      );
      continue;
    }

    if (record.role !== "toolResult" || record.payload?.isError === true) {
      continue;
    }
    const callId =
      typeof record.payload?.toolCallId === "string"
        ? record.payload.toolCallId
        : "";
    const call = calls.get(callId);
    const toolName =
      typeof record.payload?.toolName === "string"
        ? bareToolName(record.payload.toolName)
        : call?.name;
    if (toolName !== "spawn_agent" && toolName !== "send_message") continue;
    const threadId = agentToolResultThreadId(record.payload) ?? call?.threadId ?? null;
    if (!threadId || state.carded.has(threadId)) continue;
    if (toolName === "send_message") {
      const delivered = toolResultField(record.payload, "delivered");
      if (delivered !== undefined && delivered !== "resumed") continue;
      if (delivered === "resumed" && !state.entries.has(threadId)) continue;
      if (state.entries.get(threadId)?.status === "running") continue;
      start(threadId, undefined, record.createdAtMs);
      continue;
    }
    const details = asRecord(record.payload?.details);
    start(
      threadId,
      call?.description ??
        (typeof details?.description === "string"
          ? details.description
          : undefined),
      record.createdAtMs,
      { agentType: "general" },
    );
  }
  return state;
};

const MAX_SETTLED_ENTRIES = 256;
const MAX_PENDING_TOOL_CALLS = 512;

export const trimAgentActivity = (
  state: AgentActivityState,
  toolCalls?: Map<string, AgentActivityToolCall>,
): void => {
  const settled = [...state.entries.values()].filter(
    (entry) => entry.status !== "running",
  );
  if (settled.length > MAX_SETTLED_ENTRIES) {
    settled.sort((a, b) => a.updatedAtMs - b.updatedAtMs);
    for (const entry of settled.slice(0, settled.length - MAX_SETTLED_ENTRIES)) {
      state.entries.delete(entry.agentId);
      state.generations.delete(entry.agentId);
      state.settledGenerations.delete(entry.agentId);
      state.carded.delete(entry.agentId);
    }
  }
  if (state.carded.size > MAX_SETTLED_ENTRIES) {
    for (const agentId of state.carded) {
      if (!state.entries.has(agentId)) state.carded.delete(agentId);
    }
  }
  if (state.generations.size > MAX_SETTLED_ENTRIES) {
    for (const agentId of state.generations.keys()) {
      if (!state.entries.has(agentId)) state.generations.delete(agentId);
    }
  }
  if (state.settledGenerations.size > MAX_SETTLED_ENTRIES) {
    for (const agentId of state.settledGenerations.keys()) {
      if (!state.entries.has(agentId)) state.settledGenerations.delete(agentId);
    }
  }
  if (toolCalls && toolCalls.size > MAX_PENDING_TOOL_CALLS) {
    for (const key of [...toolCalls.keys()].slice(
      0,
      toolCalls.size - MAX_PENDING_TOOL_CALLS,
    )) {
      toolCalls.delete(key);
    }
  }
};

export const runningAgentEntries = (
  state: AgentActivityState,
  limit?: number,
): AgentActivityEntry[] => {
  const running = [...state.entries.values()].filter(
    (entry) => entry.status === "running",
  );
  return limit !== undefined && running.length > limit
    ? running.slice(running.length - limit)
    : running;
};

export const READY_RUNNING_AGENTS_LIMIT = 64;

export const parseAgentActivityEntry = (
  value: unknown,
): AgentActivityEntry | null => {
  const raw = asRecord(value);
  if (!raw) return null;
  const agentId = typeof raw.agentId === "string" ? raw.agentId : "";
  const title = typeof raw.title === "string" ? raw.title : "";
  if (!agentId || !title) return null;
  const createdAtMs =
    typeof raw.createdAtMs === "number" && Number.isFinite(raw.createdAtMs)
      ? raw.createdAtMs
      : 0;
  const updatedAtMs =
    typeof raw.updatedAtMs === "number" && Number.isFinite(raw.updatedAtMs)
      ? raw.updatedAtMs
      : createdAtMs;
  return {
    agentId,
    title,
    status: "running",
    createdAtMs,
    updatedAtMs,
    ...(typeof raw.agentType === "string" && raw.agentType
      ? { agentType: raw.agentType }
      : {}),
    ...(typeof raw.statusText === "string" && raw.statusText.trim()
      ? { statusText: raw.statusText.trim() }
      : {}),
  };
};
