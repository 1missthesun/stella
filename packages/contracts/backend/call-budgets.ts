import { REQUEST_BUDGET_MS } from "../request-deadline.js";
import type { CallName } from "./api.js";

export type CallBudget = { timeoutMs: number; idempotent: boolean };

const SLOW_CALLS = new Set<string>([
  "mcpServers.call",
  "integrations.run",
  "x.request",
  "search.web",
  "data.export",
  "emailDigest.checkNow",
  "media.generate",
  "tts.prepare",
  "feedback.submit",
  "memory.startWipe",
  "account.reset",
  "claudeSessions.append",
  "claudeSessions.readChunk",
  "memory.files.write",
  "memory.files.read",
  "drive.finalizeUpload",
  "skills.heads",
]);

const LOOKUP_SUFFIXES = [
  "get",
  "list",
  "recent",
  "status",
  "latest",
  "identity",
  "ping",
  "directory",
  "running",
  "pending",
  "detail",
  "catalog",
  "connections",
  "actions",
  "models",
  "listModels",
  "policy",
  "zone",
  "reminders",
  "wipeStatus",
  "preference",
  "github",
  "access",
  "webRenderer",
  "feed",
  "forConversation",
  "forDevice",
  "forThread",
  "job",
  "jobs",
  "files",
  "fileUrl",
  "realtimeConfig",
  "locateDeviceFiles",
  "read",
];

const IDEMPOTENT_CALLS = new Set<string>([
  "conversations.bootstrap",
  "agentThreads.handoff",
  "devices.register",
  "devices.identity",
  "agentReports.acknowledge",
  "agentThreads.acknowledgeDelivery",
  "usageLimits.note",
  "schedules.reportZone",
  "engines.reportClaudeLogins",
  "drive.prepareUpload",
  "drive.recordDeviceFiles",
  "preferences.set",
  "memory.files.read",
  "claudeSessions.readChunk",
  "skills.heads",
]);

const isLookup = (name: string): boolean => {
  const verb = name.slice(name.lastIndexOf(".") + 1);
  return LOOKUP_SUFFIXES.includes(verb);
};

/** Default deadline for a backend call; callers with their own deadline pass it instead. */
export const backendCallBudget = (name: CallName | string): CallBudget => {
  if (SLOW_CALLS.has(name)) {
    return { timeoutMs: REQUEST_BUDGET_MS.slow, idempotent: IDEMPOTENT_CALLS.has(name) };
  }
  if (isLookup(name)) return { timeoutMs: REQUEST_BUDGET_MS.lookup, idempotent: true };
  return { timeoutMs: REQUEST_BUDGET_MS.call, idempotent: IDEMPOTENT_CALLS.has(name) };
};
