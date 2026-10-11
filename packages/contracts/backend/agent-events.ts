import type { AgentAttemptOutcome } from "../agent-status.js";

export const AGENT_EVENT_KINDS = [
  "backfilled",
  "spawned",
  "attempt_started",
  "resumed",
  "turn_recorded",
  "attempt_dispatched",
  "steered",
  "input_queued",
  "resume_requested",
  "pause_requested",
  "pause_held",
  "paused",
  "completed",
  "failed",
  "canceled",
  "waiting_for_user",
  "attempt_ended",
  "parent_linked",
  "delivery_acknowledged",
] as const;

export type AgentEventKind = (typeof AGENT_EVENT_KINDS)[number];

export type AgentEventRecord = {
  seq: number;
  key: string;
  kind: string;
  threadId: string | null;
  conversationId: string | null;
  turnId: string | null;
  attemptGeneration: number | null;
  brainEpoch: number | null;
  status: string | null;
  outcome: AgentAttemptOutcome | null;
  source: string;
  threadPatch: Record<string, unknown> | null;
  turnPatch: Record<string, unknown> | null;
  detail: Record<string, unknown> | null;
  createdAt: number;
};

export const AGENT_EVENTS_PAGE_MAX = 200;

export type AgentEventViews = {
  "agentEvents.forThread": {
    args: { threadId: string; after?: number; limit?: number };
    result: { events: AgentEventRecord[]; hasMore: boolean };
  };
  "agentEvents.recent": {
    args: { before?: number; limit?: number };
    result: { events: AgentEventRecord[]; hasMore: boolean };
  };
};
