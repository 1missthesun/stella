import type { AgentThreadLookup } from "./agent-threads.js";

export type AgentThreadViewer =
  | { host: "cloud" }
  | { host: "desktop"; deviceId: string };

const REPORT_MAX_CHARS = 8_000;

export const isAgentThreadLookupActive = (thread: AgentThreadLookup): boolean =>
  thread.status === "running" || thread.status === "resuming";

const deviceName = (label: string | undefined, deviceId: string | undefined): string =>
  label?.trim() || deviceId || "another computer";

export const agentThreadLookupLocation = (thread: AgentThreadLookup): string =>
  thread.executorDeviceId
    ? `on ${deviceName(thread.executorDeviceLabel, thread.executorDeviceId)}`
    : thread.placement === "computer"
      ? `locally on ${deviceName(thread.originDeviceLabel, thread.originDeviceId)}`
      : "in Stella's cloud";

export const agentThreadLookupControllable = (thread: AgentThreadLookup): boolean =>
  thread.placement !== "computer" || Boolean(thread.executorDeviceId || thread.originDeviceId);

/**
 * Who hears from the thread, and that any host reaches it: control goes
 * through the owner's agent threads, so neither where the conversation runs
 * now nor which device started the thread decides whether `send_message` or
 * `pause_agent` can reach it.
 */
export const agentThreadLookupController = (
  thread: AgentThreadLookup,
  viewer: AgentThreadViewer,
): string => {
  const reach = agentThreadLookupControllable(thread)
    ? "From here or any other of your devices, send_message steers it or resumes it once it stops, and pause_agent pauses it: Stella's cloud routes both to wherever it runs, and holds them for a computer that is offline."
    : "No computer is on record for it, so nothing can reach it to message or pause it.";
  if (thread.parentThreadId) {
    return `Another agent of this conversation started it (thread ${thread.parentThreadId}) and gets its report. ${reach}`;
  }
  if (thread.originDeviceId) {
    const origin = deviceName(thread.originDeviceLabel, thread.originDeviceId);
    return viewer.host === "desktop" && viewer.deviceId === thread.originDeviceId
      ? `This computer started it, and its report comes back to this conversation through this computer. ${reach}`
      : `It was started from ${origin}, and its report comes back to this conversation through ${origin}. ${reach}`;
  }
  return `Its report comes back to this conversation. ${reach}`;
};

export const agentThreadLookupReport = (thread: AgentThreadLookup): string | undefined => {
  if (!thread.resultJson) return undefined;
  let text = thread.resultJson;
  try {
    const parsed = JSON.parse(thread.resultJson) as unknown;
    if (typeof parsed === "string") {
      text = parsed;
    } else if (
      parsed &&
      typeof parsed === "object" &&
      typeof (parsed as { finalText?: unknown }).finalText === "string"
    ) {
      text = (parsed as { finalText: string }).finalText;
    }
  } catch {
    text = thread.resultJson;
  }
  return text.length > REPORT_MAX_CHARS
    ? `${text.slice(0, REPORT_MAX_CHARS)}\n[Report truncated]`
    : text;
};

export const describeAgentThreadLookup = (
  thread: AgentThreadLookup,
  viewer: AgentThreadViewer,
): string => {
  const active = isAgentThreadLookupActive(thread);
  const report = active ? undefined : agentThreadLookupReport(thread);
  return [
    `Thread ${thread.threadId} (${thread.description}) runs ${agentThreadLookupLocation(thread)} and is ${thread.status} (attempt ${thread.attemptGeneration}, last change ${new Date(thread.updatedAt).toISOString()}).`,
    agentThreadLookupController(thread, viewer),
    report !== undefined
      ? `Report for this attempt:\n${report}`
      : !active && thread.errorMessage
        ? `Error: ${thread.errorMessage}`
        : "",
  ]
    .filter(Boolean)
    .join(" ");
};
