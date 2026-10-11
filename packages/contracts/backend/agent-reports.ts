import type { AgentAttemptOutcome } from "../agent-status.js";

export const agentReportId = (
  threadId: string,
  attemptGeneration: number,
): string => `report:${threadId}:${attemptGeneration}`;

export const AGENT_REPORT_RECEIPT_MAX_CHARS = 64;

const fnv1a64 = (text: string): string => {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
};

export const agentReportReceipt = (reportId: string): string =>
  reportId.length <= AGENT_REPORT_RECEIPT_MAX_CHARS
    ? reportId
    : `report:${fnv1a64(reportId)}:${reportId.length}`;

export const parseAgentReportId = (
  value: string,
): { threadId: string; attemptGeneration: number } | null => {
  const match = /^report:(.+):(\d+)$/.exec(value);
  if (!match) return null;
  const attemptGeneration = Number(match[2]);
  return Number.isSafeInteger(attemptGeneration)
    ? { threadId: match[1]!, attemptGeneration }
    : null;
};

export type AgentReportOutcome = Exclude<AgentAttemptOutcome, "paused">;

export type AgentReportRequester =
  | { kind: "agent"; threadId: string }
  | { kind: "conversation"; conversationId: string };

export type DeviceAgentReport = {
  reportId: string;
  kind: "report" | "note";
  threadId: string;
  attemptGeneration: number;
  conversationId: string;
  ownerGeneration: string;
  description: string;
  agentType: string;
  outcome: AgentReportOutcome;
  text: string;
  createdAt: number;
};

export const AGENT_REPORT_OFFER_MS = 2 * 60_000;

export type AgentReportCalls = {
  "agentReports.note": {
    args: {
      ownerGeneration: string;
      noteId: string;
      conversationId: string;
      fromThreadId: string;
      text: string;
    };
    result: { queued: boolean };
  };
  "agentReports.acknowledge": {
    args: { deviceId: string; ownerGeneration: string; reportId: string };
    result: { acknowledged: boolean };
  };
};

export type AgentReportViews = {
  "agentReports.forDevice": {
    args: { deviceId: string; ownerGeneration: string };
    result: DeviceAgentReport[];
  };
};
