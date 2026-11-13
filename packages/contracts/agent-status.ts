export const AGENT_STATUSES = [
  "queued",
  "running",
  "waiting_for_helpers",
  "waiting_for_user",
  "waiting",
  "completed",
  "failed",
  "canceled",
] as const;

export type AgentStatus = (typeof AGENT_STATUSES)[number];

/**
 * What the owner stores for an agent (`agent_threads.status`), the one
 * authority every other copy of an agent's status is read from.
 * `waiting_for_user` covers a usage-limit hold, told apart by the row's hold.
 */
export const STORED_AGENT_STATUSES = ["running", "waiting_for_user", "completed", "failed", "canceled"] as const;

export type StoredAgentStatus = (typeof STORED_AGENT_STATUSES)[number];

/** Stored statuses of an agent that has not ended. */
export const LIVE_STORED_AGENT_STATUSES: readonly StoredAgentStatus[] = ["running", "waiting_for_user"];

export const storedAgentStatusOf = (value: unknown): StoredAgentStatus | null =>
  value === "resuming"
    ? "running"
    : value === "paused"
      ? "canceled"
      : (STORED_AGENT_STATUSES as readonly unknown[]).includes(value)
        ? (value as StoredAgentStatus)
        : null;

export const isLiveStoredAgentStatus = (value: unknown): boolean =>
  (LIVE_STORED_AGENT_STATUSES as readonly unknown[]).includes(value);

/** A SQL `IN` list of statuses, for the owner's queries. */
export const agentStatusSqlList = (statuses: readonly StoredAgentStatus[]): string =>
  `(${statuses.map((status) => `'${status}'`).join(", ")})`;

export type AgentAttemptOutcome = "completed" | "failed" | "canceled";

export const AGENT_ATTEMPT_OUTCOMES: readonly AgentAttemptOutcome[] = [
  "completed",
  "failed",
  "canceled",
];

export const LIVE_AGENT_STATUSES: ReadonlySet<AgentStatus> = new Set([
  "queued",
  "running",
  "waiting_for_helpers",
  "waiting_for_user",
  "waiting",
]);

export const isAgentStatus = (value: unknown): value is AgentStatus =>
  typeof value === "string" && (AGENT_STATUSES as readonly string[]).includes(value);

export const isAgentAttemptOutcome = (value: unknown): value is AgentAttemptOutcome =>
  typeof value === "string" && (AGENT_ATTEMPT_OUTCOMES as readonly string[]).includes(value);

export const isLiveAgentStatus = (status: AgentStatus): boolean => LIVE_AGENT_STATUSES.has(status);

const LEGACY_STATUS: Readonly<Record<string, AgentStatus>> = {
  pending: "queued",
  resuming: "running",
  error: "failed",
  cancelled: "canceled",
  paused: "canceled",
};

export const agentStatusOf = (value: string | null | undefined): AgentStatus | null => {
  if (!value) return null;
  if (isAgentStatus(value)) return value;
  return LEGACY_STATUS[value] ?? null;
};

export const AGENT_STOPPED_REASON = "Stopped.";

export const AGENT_STOP_WIRE_REASON = "Paused by orchestrator.";

export const AGENT_STOPPED_ERROR_CODE = "AGENT_PAUSED";

export const isAgentStopReason = (reason: string | null | undefined): boolean => {
  const trimmed = reason?.trim();
  return trimmed === AGENT_STOPPED_REASON || trimmed === AGENT_STOP_WIRE_REASON;
};

export const agentAttemptOutcomeOf = (args: { status: string }): AgentAttemptOutcome => {
  const status = agentStatusOf(args.status);
  if (status === "completed" || status === "canceled") return status;
  return "failed";
};

export const AGENT_REPORT_HEADINGS: Readonly<Record<AgentAttemptOutcome, string>> = {
  completed: "[Agent completed]",
  failed: "[Task failed]",
  canceled: "[Task canceled]",
};

export const LEGACY_STOPPED_REPORT_HEADING = "[Subagent paused]";

export const legacyReportStatus = (text: string): AgentAttemptOutcome => {
  const head = text.trimStart();
  if (head.startsWith(AGENT_REPORT_HEADINGS.completed)) return "completed";
  if (head.startsWith(AGENT_REPORT_HEADINGS.canceled)) return "canceled";
  if (head.startsWith(LEGACY_STOPPED_REPORT_HEADING)) return "canceled";
  return "failed";
};

export const reportStatusOf = (report: { status?: unknown; text?: string }): AgentAttemptOutcome => {
  const status = typeof report.status === "string" ? agentStatusOf(report.status) : null;
  return status && isAgentAttemptOutcome(status) ? status : legacyReportStatus(report.text ?? "");
};
