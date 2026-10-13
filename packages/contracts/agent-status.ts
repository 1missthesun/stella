/**
 * The one vocabulary every host uses for an agent's status: the owner's
 * agent threads, the device kernel, pi, the placement bridge, lifecycle
 * cards, reports and the directory. Older hosts wrote other words for the
 * same states; `agentStatusOf` reads those, and nothing reads a status from
 * report text except `legacyReportStatus`, for reports an older build wrote.
 */

export const AGENT_STATUSES = [
  "queued",
  "running",
  "waiting_for_helpers",
  "waiting_for_user",
  "completed",
  "failed",
  "canceled",
] as const;

export type AgentStatus = (typeof AGENT_STATUSES)[number];

/**
 * How one attempt of an agent ended. `canceled` means it was stopped
 * (`stop_agent`, shutdown, a canceled dispatch), `failed` that it could not
 * finish. Every ended agent keeps its history, and a message resumes it.
 */
export type AgentAttemptOutcome = "completed" | "failed" | "canceled";

export const AGENT_ATTEMPT_OUTCOMES: readonly AgentAttemptOutcome[] = [
  "completed",
  "failed",
  "canceled",
];

/** Statuses an agent is still working, or waiting to work, in. */
export const LIVE_AGENT_STATUSES: ReadonlySet<AgentStatus> = new Set([
  "queued",
  "running",
  "waiting_for_helpers",
  "waiting_for_user",
]);

export const isAgentStatus = (value: unknown): value is AgentStatus =>
  typeof value === "string" && (AGENT_STATUSES as readonly string[]).includes(value);

export const isAgentAttemptOutcome = (value: unknown): value is AgentAttemptOutcome =>
  typeof value === "string" && (AGENT_ATTEMPT_OUTCOMES as readonly string[]).includes(value);

export const isLiveAgentStatus = (status: AgentStatus): boolean => LIVE_AGENT_STATUSES.has(status);

/** The words older hosts used for the same states. */
const LEGACY_STATUS: Readonly<Record<string, AgentStatus>> = {
  pending: "queued",
  resuming: "running",
  waiting: "waiting_for_user",
  error: "failed",
  cancelled: "canceled",
  paused: "canceled",
};

/** Any host's status word in this vocabulary; null for one no host writes. */
export const agentStatusOf = (value: string | null | undefined): AgentStatus | null => {
  if (!value) return null;
  if (isAgentStatus(value)) return value;
  return LEGACY_STATUS[value] ?? null;
};

/** Why an attempt `stop_agent` ended. */
export const AGENT_STOPPED_REASON = "Stopped.";

/**
 * The reason a stop carries on the wire to a device, and the one builds
 * from before `stop_agent` (`pause_agent`) sent with a stopped attempt.
 */
export const AGENT_STOP_WIRE_REASON = "Paused by orchestrator.";

/** The dispatch error code a device reports with an agent attempt `stop_agent` ended. */
export const AGENT_STOPPED_ERROR_CODE = "AGENT_PAUSED";

/**
 * Whether a cancel reason is one a stop carries. A stopped attempt reports to
 * no one: whoever stopped it knows, and its parent is stopped with it.
 */
export const isAgentStopReason = (reason: string | null | undefined): boolean => {
  const trimmed = reason?.trim();
  return trimmed === AGENT_STOPPED_REASON || trimmed === AGENT_STOP_WIRE_REASON;
};

/** An attempt's outcome from what its runtime reported, in any host's words. */
export const agentAttemptOutcomeOf = (args: { status: string }): AgentAttemptOutcome => {
  const status = agentStatusOf(args.status);
  if (status === "completed" || status === "canceled") return status;
  return "failed";
};

/** The heading of an agent's report to whoever started it. */
export const AGENT_REPORT_HEADINGS: Readonly<Record<AgentAttemptOutcome, string>> = {
  completed: "[Agent completed]",
  failed: "[Task failed]",
  canceled: "[Task canceled]",
};

/** The heading builds before `stop_agent` gave a stopped agent's report. */
export const LEGACY_STOPPED_REPORT_HEADING = "[Subagent paused]";

/**
 * The outcome of a report an older build wrote with no status of its own,
 * from its heading. Reports from current builds carry `status`; read that.
 */
export const legacyReportStatus = (text: string): AgentAttemptOutcome => {
  const head = text.trimStart();
  if (head.startsWith(AGENT_REPORT_HEADINGS.completed)) return "completed";
  if (head.startsWith(AGENT_REPORT_HEADINGS.canceled)) return "canceled";
  if (head.startsWith(LEGACY_STOPPED_REPORT_HEADING)) return "canceled";
  return "failed";
};

/** A report's outcome: its own status, or for an older build's report, its heading. */
export const reportStatusOf = (report: { status?: unknown; text?: string }): AgentAttemptOutcome => {
  const status = typeof report.status === "string" ? agentStatusOf(report.status) : null;
  return status && isAgentAttemptOutcome(status) ? status : legacyReportStatus(report.text ?? "");
};
