/**
 * Claude Code's PostToolUse command hook in the cloud: it reads the hook
 * event on stdin and answers on stdout with the tool output redacted, as the
 * desktop's HTTP hook does. Claude Code runs it inside its sandbox for its own
 * built-ins only (the settings' matcher leaves Stella's tools out; Stella's
 * host redacts those). A command, not an HTTP endpoint, so a parked process
 * picked up by a later turn still reaches it.
 *
 * The secure values this task was given are redacted by their fingerprints,
 * which the executor keeps in a read-only file inside the sandbox
 * (secure-value-fingerprints.ts). When the file is named but can't be read,
 * the output is withheld rather than shown unchecked.
 */
import { readFile } from "node:fs/promises";
import { claudeCodePostToolUseHookResponse } from "@stella/runtime/kernel/integrations/claude-code-output-redaction.js";
import { setSecureValueFingerprintSource } from "@stella/runtime/kernel/shared/secure-value-redaction.js";
import {
  SANDBOX_FINGERPRINTS_ENV,
  parseFingerprintsFile,
} from "./secure-value-fingerprints.js";

const WITHHELD =
  "[Output withheld: Stella could not check it for private values. Run the command again.]";

const withhold = (value: unknown, depth = 0): unknown => {
  if (typeof value === "string") return WITHHELD;
  if (depth > 12 || !value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((entry) => withhold(entry, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, withhold(entry, depth + 1)]),
  );
};

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
let event: unknown = null;
try {
  event = JSON.parse(Buffer.concat(chunks).toString("utf8"));
} catch {
  event = null;
}
const fingerprintsPath = process.env[SANDBOX_FINGERPRINTS_ENV];
const fingerprints = fingerprintsPath
  ? parseFingerprintsFile(await readFile(fingerprintsPath, "utf8").catch(() => ""))
  : null;
let response: Record<string, unknown>;
const body = event as { hook_event_name?: unknown; tool_response?: unknown } | null;
if (
  fingerprintsPath &&
  !fingerprints &&
  body?.hook_event_name === "PostToolUse" &&
  body.tool_response !== undefined
) {
  response = {
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      updatedToolOutput: withhold(body.tool_response),
    },
  };
} else {
  if (fingerprints) setSecureValueFingerprintSource(async () => fingerprints);
  response = await claudeCodePostToolUseHookResponse(event, () => false);
}
process.stdout.write(JSON.stringify(response));
