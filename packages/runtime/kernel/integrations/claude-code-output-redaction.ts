import {
  redactSecretFingerprints,
  type SecretFingerprints,
} from "@stella/contracts/secret-redaction";
import { sanitizeToolVisibleText } from "../tools/safety.js";
import { currentSecureValueFingerprints } from "../shared/secure-value-redaction.js";

const FILE_TOOLS = new Set(["Read", "Grep", "Glob", "NotebookRead"]);
const BINARY_KEYS = new Set(["base64", "data"]);
const MAX_DEPTH = 12;

const redactValue = (
  value: unknown,
  codeFile: boolean,
  fingerprints: SecretFingerprints,
  depth: number,
): unknown => {
  if (depth > MAX_DEPTH) return value;
  if (typeof value === "string") {
    const redacted = redactSecretFingerprints(
      sanitizeToolVisibleText(value, { codeFile }),
      fingerprints,
    );
    return redacted === value ? value : redacted;
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((entry) => {
      const redacted = redactValue(entry, codeFile, fingerprints, depth + 1);
      if (redacted !== entry) changed = true;
      return redacted;
    });
    return changed ? next : value;
  }
  if (value && typeof value === "object") {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      const redacted = BINARY_KEYS.has(key)
        ? entry
        : redactValue(entry, codeFile, fingerprints, depth + 1);
      if (redacted !== entry) changed = true;
      next[key] = redacted;
    }
    return changed ? next : value;
  }
  return value;
};

export const redactClaudeCodeToolOutput = async (
  toolName: string,
  output: unknown,
): Promise<{ changed: boolean; output: unknown }> => {
  const fingerprints = await currentSecureValueFingerprints();
  const next = redactValue(output, FILE_TOOLS.has(toolName), fingerprints, 0);
  return { changed: next !== output, output: next };
};

export const claudeCodePostToolUseHookResponse = async (
  input: unknown,
): Promise<Record<string, unknown>> => {
  const body = input as {
    hook_event_name?: unknown;
    tool_name?: unknown;
    tool_response?: unknown;
  } | null;
  if (
    !body ||
    body.hook_event_name !== "PostToolUse" ||
    typeof body.tool_name !== "string" ||
    body.tool_name.startsWith("mcp__") ||
    body.tool_response === undefined
  ) {
    return {};
  }
  const { changed, output } = await redactClaudeCodeToolOutput(
    body.tool_name,
    body.tool_response,
  );
  if (!changed) return {};
  return {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      updatedToolOutput: output,
    },
  };
};
