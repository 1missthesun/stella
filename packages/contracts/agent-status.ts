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
  "paused",
  "completed",
  "failed",
  "canceled",
] as const;

export type AgentStatus = (typeof AGENT_STATUSES)[number];

/**
 * How one attempt of an agent ended. `paused` ends the attempt but not the
 * agent: a message resumes it. `canceled` means it was stopped for good
 * (shutdown, a canceled dispatch), `failed` that it could not finish.
 */
export type AgentAttemptOutcome = "completed" | "failed" | "canceled" | "paused";

export const AGENT_ATTEMPT_OUTCOMES: readonly AgentAttemptOutcome[] = [
  "completed",
  "failed",
  "canceled",
  "paused",
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
};

/** Any host's status word in this vocabulary; null for one no host writes. */
export const agentStatusOf = (value: string | null | undefined): AgentStatus | null => {
  if (!value) return null;
  if (isAgentStatus(value)) return value;
  return LEGACY_STATUS[value] ?? null;
};

/**
 * Why an attempt someone paused ended, as builds before the shared vocabulary
 * reported it: a `canceled` outcome with this reason. Still sent where an
 * older peer reads only that, and read where an older peer sends it.
 */
export const AGENT_PAUSED_REASON = "Paused by orchestrator.";

/** The dispatch error code a device reports with a `canceled` agent attempt it paused. */
export const AGENT_PAUSED_ERROR_CODE = "AGENT_PAUSED";

/** Whether a cancel reason is the one a pause carries. */
export const isAgentPauseReason = (reason: string | null | undefined): boolean =>
  reason?.trim() === AGENT_PAUSED_REASON;

/**
 * An attempt's outcome from what its runtime reported: a structured status
 * wins; a `canceled` outcome an older peer tagged as a pause (its reason or
 * dispatch error code) is `paused`.
 */
export const agentAttemptOutcomeOf = (args: {
  status: string;
  reason?: string | null;
  errorCode?: string | null;
}): AgentAttemptOutcome => {
  const status = agentStatusOf(args.status);
  if (status === "canceled") {
    return args.errorCode === AGENT_PAUSED_ERROR_CODE || isAgentPauseReason(args.reason) ? "paused" : "canceled";
  }
  if (status === "completed" || status === "paused") return status;
  return "failed";
};

/** The heading of an agent's report to whoever started it. */
export const AGENT_REPORT_HEADINGS: Readonly<Record<AgentAttemptOutcome, string>> = {
  completed: "[Agent completed]",
  failed: "[Task failed]",
  canceled: "[Task canceled]",
  paused: "[Subagent paused]",
};

/**
 * The outcome of a report an older build wrote with no status of its own,
 * from its heading. Reports from current builds carry `status`; read that.
 */
export const legacyReportStatus = (text: string): AgentAttemptOutcome => {
  const head = text.trimStart();
  if (head.startsWith(AGENT_REPORT_HEADINGS.completed)) return "completed";
  if (head.startsWith(AGENT_REPORT_HEADINGS.canceled)) return "canceled";
  if (head.startsWith(AGENT_REPORT_HEADINGS.paused)) return "paused";
  return "failed";
};

/** A report's outcome: its own status, or for an older build's report, its heading. */
export const reportStatusOf = (report: { status?: unknown; text?: string }): AgentAttemptOutcome =>
  isAgentAttemptOutcome(report.status) ? report.status : legacyReportStatus(report.text ?? "");
