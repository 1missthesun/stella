/**
 * Claude Code's PostToolUse command hook in the cloud: it reads the hook
 * event on stdin and answers on stdout with the tool output redacted, as the
 * desktop's HTTP hook does. Claude Code runs it inside its sandbox for its own
 * built-ins only (the settings' matcher leaves Stella's tools out; Stella's
 * host redacts those). A command, not an HTTP endpoint, so a parked process
 * picked up by a later turn still reaches it.
 */
import { claudeCodePostToolUseHookResponse } from "@stella/runtime/kernel/integrations/claude-code-output-redaction.js";

const chunks: Buffer[] = [];
for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
let event: unknown = null;
try {
  event = JSON.parse(Buffer.concat(chunks).toString("utf8"));
} catch {
  event = null;
}
const response = await claudeCodePostToolUseHookResponse(event, () => false);
process.stdout.write(JSON.stringify(response));
