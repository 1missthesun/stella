import { isAgentAttemptOutcome, type AgentAttemptOutcome } from "./agent-status.js";
import { parseAgentReportId } from "./backend/agent-reports.js";

export type AgentReportEnvelope = {
  threadId: string;
  attemptGeneration: number;
  outcome: AgentAttemptOutcome;
  description?: string;
};

export type WakePrompt = {
  threadId: string;
  attemptGeneration?: number;
  description?: string;
  outcome: AgentAttemptOutcome;
  body: string;
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const nonEmpty = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

export const parseAgentReportEnvelope = (value: unknown): AgentReportEnvelope | null => {
  const raw = asRecord(value);
  const threadId = nonEmpty(raw?.threadId);
  const attemptGeneration = raw?.attemptGeneration;
  if (
    !threadId ||
    typeof attemptGeneration !== "number" ||
    !Number.isSafeInteger(attemptGeneration) ||
    attemptGeneration < 1 ||
    !isAgentAttemptOutcome(raw?.outcome)
  ) {
    return null;
  }
  const description = nonEmpty(raw?.description);
  return { threadId, attemptGeneration, outcome: raw.outcome, ...(description ? { description } : {}) };
};

const promptText = (payload: Record<string, unknown> | undefined): string => {
  const content = payload?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      const entry = asRecord(block);
      return entry?.type === "text" && typeof entry.text === "string" ? entry.text : "";
    })
    .join("\n");
};

const HEADINGS: Readonly<Record<string, AgentAttemptOutcome>> = {
  "Agent completed": "completed",
  "Agent failed": "failed",
  "Agent canceled": "canceled",
  "Task failed": "failed",
  "Task canceled": "canceled",
  "Subagent paused": "canceled",
};
const HEADING_RE =
  /^\[(Agent completed|Agent failed|Agent canceled|Task failed|Task canceled|Subagent paused)\]/m;
const THREAD_RE =
  /^\[(?:Agent completed|Agent failed|Agent canceled|Task failed|Task canceled|Subagent paused)\][\s\S]*?(?:^thread_id:\s*(\S+)|\(thread ([^)]+)\))/mu;
const DESCRIPTION_RE =
  /^\[(?:Agent completed|Agent failed|Agent canceled|Task failed|Task canceled|Subagent paused)\][\s\S]*?^description:\s*(.+)$/mu;
const TRAILER_RE = /^(?:agent_state|presentation|routing|error):/;

const reportBody = (text: string, outcome: AgentAttemptOutcome): string => {
  const lines = text.split(/\r?\n/);
  const startIndex = lines.findIndex((line) =>
    outcome === "completed" ? line.startsWith("result:") : line.startsWith("error:"),
  );
  if (startIndex === -1) return "";
  const first = lines[startIndex]!.replace(/^(?:result|error):\s?/, "");
  const rest: string[] = [];
  for (const line of lines.slice(startIndex + 1)) {
    if (TRAILER_RE.test(line)) break;
    rest.push(line);
  }
  return [first, ...rest].join("\n").trim();
};

const legacyWakePrompt = (text: string, clientMsgId: string | undefined): WakePrompt | null => {
  const heading = HEADING_RE.exec(text)?.[1];
  const match = THREAD_RE.exec(text);
  const threadId = nonEmpty(match?.[1] ?? match?.[2]);
  if (!heading || !threadId) return null;
  const outcome = HEADINGS[heading] ?? "failed";
  const description = nonEmpty(DESCRIPTION_RE.exec(text)?.[1]);
  const receipt = clientMsgId ? parseAgentReportId(clientMsgId) : null;
  return {
    threadId,
    ...(receipt?.threadId === threadId ? { attemptGeneration: receipt.attemptGeneration } : {}),
    ...(description ? { description } : {}),
    outcome,
    body: reportBody(text, outcome),
  };
};

export const wakePromptOf = (
  payload: Record<string, unknown> | undefined,
  clientMsgId?: string,
): WakePrompt | null => {
  const text = promptText(payload);
  const envelope = parseAgentReportEnvelope(payload?.agentReport);
  if (!envelope) return legacyWakePrompt(text, clientMsgId);
  return {
    threadId: envelope.threadId,
    attemptGeneration: envelope.attemptGeneration,
    ...(envelope.description ? { description: envelope.description } : {}),
    outcome: envelope.outcome,
    body: reportBody(text, envelope.outcome),
  };
};
