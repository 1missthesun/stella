import type { AgentAttemptOutcome } from "../agent-status.js";

export const agentReportId = (
  threadId: string,
  attemptGeneration: number,
): string => `report:${threadId}:${attemptGeneration}`;

export const AGENT_REPORT_RECEIPT_MAX_CHARS = 64;

export const AGENT_REPORT_MAX_CHARS = 200_000;
export const AGENT_REPORT_NOTE_MAX_CHARS = 1_000;

const TWO_32 = 0x1_0000_0000;

const fnv1a64 = (text: string): string => {
  let hi = 0xcbf29ce4;
  let lo = 0x84222325;
  for (let index = 0; index < text.length; index += 1) {
    lo = (lo ^ text.charCodeAt(index)) >>> 0;
    const low = lo * 0x1b3;
    const high = hi * 0x1b3 + Math.floor(low / TWO_32) + ((lo * 0x100) % TWO_32);
    lo = low % TWO_32;
    hi = high % TWO_32;
  }
  return hi.toString(16).padStart(8, "0") + lo.toString(16).padStart(8, "0");
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

export type AgentReportOutcome = AgentAttemptOutcome;

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

export const AGENT_NO_FINAL_MESSAGE =
  "The agent's run ended without a closing message.";

export const silentRunReport = (args: {
  lastMessage?: string;
  lastTools?: readonly string[];
  stillWorking?: boolean;
}): string => {
  const last = args.lastMessage?.trim();
  return [
    AGENT_NO_FINAL_MESSAGE,
    last
      ? `Its last message was:\n\n${last}`
      : args.lastTools?.length
        ? `It wrote no message; its last step called ${args.lastTools.join(", ")}.`
        : "It wrote no message at all.",
    args.stillWorking
      ? "It is still working on a newer message; its next report follows."
      : "Check its work (agent_status, or message it) before relying on this.",
  ].join("\n\n");
};

// An empty result, or the stand-in a silent run reports, which a later
// result for the same attempt may replace before the report is delivered.
export const isPlaceholderAgentResult = (resultJson: string | null | undefined): boolean => {
  if (!resultJson?.trim()) return true;
  let text: unknown = resultJson;
  try {
    const parsed = JSON.parse(resultJson) as { finalText?: unknown };
    if (parsed && typeof parsed === "object" && "finalText" in parsed) text = parsed.finalText;
  } catch {
    text = resultJson;
  }
  return typeof text !== "string" || !text.trim() || text.trim().startsWith(AGENT_NO_FINAL_MESSAGE);
};
