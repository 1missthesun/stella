import type {
  AgentReportOutcome,
  DeviceAgentReport,
} from "@stella/contracts/backend/agent-reports";
import type { AgentReportEnvelope } from "@stella/contracts/agent-wake-prompt";
import { boundParentAgentReport } from "./agent-report-bounds.js";
import { forkDelayedCall } from "./cloud-effect-runtime.js";

type AgentReportInboxOptions = {
  deviceId: string;
  getOwnerGeneration: () => Promise<string>;
  watchReports: (
    args: { deviceId: string; ownerGeneration: string },
    onUpdate: (value: unknown) => void,
    onError?: (error: Error) => void,
  ) => (() => void) | null;
  acknowledge: (args: {
    deviceId: string;
    ownerGeneration: string;
    reportId: string;
  }) => Promise<unknown>;
  deliver: (note: {
    conversationId: string;
    requestId: string;
    text: string;
    agentReport?: AgentReportEnvelope;
  }) => Promise<void>;
  canStart?: () => boolean;
};

const RETRY_MS = 5_000;

const OUTCOMES = new Set<AgentReportOutcome>([
  "completed",
  "failed",
  "canceled",
]);

const parseReport = (value: unknown): DeviceAgentReport | null => {
  const record =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : null;
  if (!record) return null;
  const text = (key: string) =>
    typeof record[key] === "string" ? (record[key] as string) : "";
  const outcome = record.outcome as AgentReportOutcome;
  const attemptGeneration = record.attemptGeneration;
  if (
    !text("reportId") ||
    !text("conversationId") ||
    !text("ownerGeneration") ||
    !OUTCOMES.has(outcome) ||
    typeof attemptGeneration !== "number" ||
    !Number.isSafeInteger(attemptGeneration)
  ) {
    return null;
  }
  return {
    reportId: text("reportId"),
    kind: record.kind === "note" ? "note" : "report",
    threadId: text("threadId"),
    attemptGeneration,
    conversationId: text("conversationId"),
    ownerGeneration: text("ownerGeneration"),
    description: text("description") || text("threadId"),
    agentType: text("agentType") || "general",
    outcome,
    text: text("text"),
    createdAt: typeof record.createdAt === "number" ? record.createdAt : 0,
  };
};

const MAX_REPORT_ERROR_CHARS = 30_000;

export const agentReportText = (report: DeviceAgentReport): string => {
  const lines = [
    report.outcome === "completed"
      ? "[Agent completed]"
      : report.outcome === "canceled"
        ? "[Task canceled]"
        : "[Task failed]",
  ];
  if (report.description) lines.push(`description: ${report.description}`);
  if (report.threadId) lines.push(`thread_id: ${report.threadId}`);
  lines.push(`status: ${report.outcome}`);
  if (report.outcome === "completed") {
    lines.push(
      `result: ${boundParentAgentReport(report.text || "The agent completed without a report.", report.threadId)}`,
    );
  } else {
    const error =
      report.text || (report.outcome === "canceled" ? "The agent was canceled." : "The agent failed.");
    lines.push(
      `error: ${
        error.length <= MAX_REPORT_ERROR_CHARS
          ? error
          : `${error.slice(0, MAX_REPORT_ERROR_CHARS)}\n[truncated ${error.length - MAX_REPORT_ERROR_CHARS} chars]`
      }`,
    );
  }
  return lines.join("\n");
};

export const createAgentReportInbox = (options: AgentReportInboxOptions) => {
  let stopped = true;
  let epoch = 0;
  let unsubscribe: (() => void) | null = null;
  let restartCancel: (() => void) | null = null;
  const inFlight = new Set<string>();
  const retries = new Map<string, () => void>();

  const clearRetries = () => {
    for (const cancel of retries.values()) cancel();
    retries.clear();
  };

  const deliver = async (
    report: DeviceAgentReport,
    startEpoch: number,
  ): Promise<void> => {
    if (stopped || startEpoch !== epoch || inFlight.has(report.reportId))
      return;
    inFlight.add(report.reportId);
    try {
      await options.deliver(
        report.kind === "note"
          ? { conversationId: report.conversationId, requestId: report.reportId, text: report.text }
          : {
              conversationId: report.conversationId,
              requestId: `agent-report:${report.reportId}`,
              text: agentReportText(report),
              agentReport: {
                threadId: report.threadId,
                attemptGeneration: report.attemptGeneration,
                outcome: report.outcome,
                ...(report.description ? { description: report.description } : {}),
              },
            },
      );
      await options.acknowledge({
        deviceId: options.deviceId,
        ownerGeneration: report.ownerGeneration,
        reportId: report.reportId,
      });
    } catch (error) {
      console.warn(
        "[agent-report-inbox] delivery will retry",
        report.reportId,
        error instanceof Error ? error.message : error,
      );
      if (!retries.has(report.reportId)) {
        retries.set(
          report.reportId,
          forkDelayedCall(RETRY_MS, () => {
            retries.delete(report.reportId);
            void deliver(report, startEpoch);
          }),
        );
      }
    } finally {
      inFlight.delete(report.reportId);
    }
  };

  const start = () => {
    if (options.canStart?.() === false) {
      stop();
      return;
    }
    stop();
    stopped = false;
    const startEpoch = ++epoch;
    void options
      .getOwnerGeneration()
      .then(async (value) => {
        const ownerGeneration = value.trim();
        if (stopped || startEpoch !== epoch || !ownerGeneration) return;
        unsubscribe = options.watchReports(
          { deviceId: options.deviceId, ownerGeneration },
          (rows) => {
            if (stopped || startEpoch !== epoch || !Array.isArray(rows)) return;
            for (const row of rows) {
              const report = parseReport(row);
              if (report?.ownerGeneration === ownerGeneration) {
                void deliver(report, startEpoch);
              }
            }
          },
          () => {
            if (startEpoch !== epoch) return;
            unsubscribe?.();
            unsubscribe = null;
            restartCancel?.();
            restartCancel = forkDelayedCall(RETRY_MS, () => {
              restartCancel = null;
              if (startEpoch === epoch) start();
            });
          },
        );
      })
      .catch(() => {
        if (startEpoch !== epoch) return;
        restartCancel = forkDelayedCall(RETRY_MS, () => {
          restartCancel = null;
          if (startEpoch === epoch) start();
        });
      });
  };

  const stop = () => {
    stopped = true;
    epoch += 1;
    unsubscribe?.();
    unsubscribe = null;
    restartCancel?.();
    restartCancel = null;
    clearRetries();
  };

  return { start, stop };
};
