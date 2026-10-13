import {
  CLOUD_MODEL_DIAGNOSTIC_SENTINELS,
  type CloudModelDiagnosticCode,
} from "@stella/contracts/cloud-model-diagnostic";

export type AgentFailureDiagnosticCode =
  | "execution_missing"
  | "tool_state_boundary"
  | "broker_handoff"
  | "turn_input"
  | "workspace_boundary"
  | "privilege_probe"
  | "conversation_history"
  | "model_resolution"
  | CloudModelDiagnosticCode
  | "broker_response"
  | "capture_wrapper"
  | "capture_exit"
  | "code_install"
  | "container_start"
  | "unknown";

/**
 * Collapse executor/turn failures to an allowlisted status code. The source
 * text can contain provider or user-controlled details, so callers must never
 * surface it directly in acceptance receipts or client-visible errors.
 */
export const classifyAgentFailureDiagnostic = (
  detail: string,
): AgentFailureDiagnosticCode => {
  const lines = new Set(detail.split(/\r?\n/u).map((line) => line.trim()));
  for (const [code, sentinel] of Object.entries(
    CLOUD_MODEL_DIAGNOSTIC_SENTINELS,
  ) as Array<[CloudModelDiagnosticCode, string]>) {
    if (
      lines.has(sentinel) ||
      lines.has(`error: ${sentinel}`) ||
      lines.has(`Error: ${sentinel}`) ||
      lines.has(`error: (FiberFailure) Error: ${sentinel}`)
    ) {
      return code;
    }
  }
  const value = detail.toLowerCase();
  if (value.includes("could not install stella's code bundle")) {
    return "code_install";
  }
  if (
    value.includes("sandbox container did not become ready") ||
    value.includes("agent container prewarm did not settle")
  ) {
    return "container_start";
  }
  if (
    /cannot read (?:properties|property) of undefined.*(?:engine|execution)/u.test(
      value,
    ) ||
    /execution.*(?:missing|undefined|invalid)/u.test(value)
  ) {
    return "execution_missing";
  }
  if (
    value.includes("cloud tool directory") ||
    value.includes("drive hydration state")
  ) {
    return "tool_state_boundary";
  }
  if (
    value.includes("turn broker handoff") ||
    value.includes("turn broker credentials")
  ) {
    return "broker_handoff";
  }
  if (
    value.includes("turn-input.json") ||
    value.includes("turn input")
  ) {
    return "turn_input";
  }
  if (
    value.includes("cloud workspace") ||
    value.includes("workspace root")
  ) {
    return "workspace_boundary";
  }
  if (
    value.includes("cloud privilege") ||
    value.includes("setpriv") ||
    value.includes("no_new_privs")
  ) {
    return "privilege_probe";
  }
  if (value.includes("conversation history")) {
    return "conversation_history";
  }
  if (
    value.includes("cloud model") ||
    value.includes("managed model") ||
    value.includes("model resolver") ||
    value.includes("execution route")
  ) {
    return "model_resolution";
  }
  if (
    value.includes("turn credential broker response") ||
    value.includes("turn credential broker denied")
  ) {
    return "broker_response";
  }
  if (
    value.includes("captured session wrapper") ||
    value.includes("capture wrapper")
  ) {
    return "capture_wrapper";
  }
  if (
    value.includes("captured session exit code") ||
    value.includes("capture exit")
  ) {
    return "capture_exit";
  }
  return "unknown";
};

const AGENT_FAILURE_REASONS: Partial<Record<AgentFailureDiagnosticCode, string>> = {
  code_install:
    "its cloud workspace could not load Stella's code, which happens while a Stella update is being deployed",
  container_start: "its cloud workspace did not start in time",
  execution_missing: "the cloud could not tell which engine should run it",
  tool_state_boundary: "its cloud tools could not be prepared",
  broker_handoff: "its cloud workspace did not receive its credentials",
  broker_response: "its cloud workspace's credentials were refused",
  turn_input: "its cloud workspace did not receive its instructions",
  workspace_boundary: "its cloud workspace could not be prepared",
  privilege_probe: "its cloud workspace failed a security check",
  conversation_history: "its conversation history could not be loaded",
  model_resolution: "the cloud could not resolve its model",
  capture_wrapper: "its session could not be recorded",
  capture_exit: "its session exited unexpectedly",
};

/**
 * The sentence a person sees for a failed cloud turn: a reason written for
 * them from the allowlisted code, never the source text, and the turn id so
 * the failure can be found in the logs.
 */
export const agentFailureMessage = (
  code: AgentFailureDiagnosticCode,
  turnId: string,
): string => {
  const reason =
    AGENT_FAILURE_REASONS[code] ??
    (code.startsWith("model_")
      ? "it could not reach its model from the cloud"
      : null);
  return reason
    ? `The agent stopped because ${reason}. Try again. (cloud turn ${turnId})`
    : `The agent hit a problem in the cloud and stopped. Try again. (cloud turn ${turnId}, ${code})`;
};
