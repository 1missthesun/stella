import type { AgentReportTarget } from "./owner-store/registry.js";

export const AGENT_REPORT_TARGET_PATH = "/internal/agent-report-target";

export const parseAgentReportTarget = (value: unknown): AgentReportTarget => {
  const record =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : {};
  if (
    record.kind === "device" &&
    typeof record.deviceId === "string" &&
    record.deviceId &&
    typeof record.epoch === "number" &&
    Number.isSafeInteger(record.epoch)
  ) {
    return { kind: "device", deviceId: record.deviceId, epoch: record.epoch };
  }
  if (record.kind === "cloud") return { kind: "cloud" };
  return { kind: "sender" };
};
