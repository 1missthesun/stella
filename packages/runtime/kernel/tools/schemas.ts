/**
 * Shared shell-safety patterns.
 *
 * Stella's tool surface lives entirely in `runtime/kernel/tools/defs/` —
 * one self-contained `ToolDefinition` per tool, owning its own name,
 * description, JSON schema, and handler. The host imports them through
 * `defs/index.ts::buildBuiltinTools`.
 *
 * What remains in this file: `getDangerousCommandReason`, the
 * catastrophic-operation guard consumed by `Bash` and other shell paths.
 */

import { getCatastrophicShellCommandReason } from "./shell-command-safety.js";

export function getDangerousCommandReason(
  command: string,
  cwd?: string,
): string | null {
  return getCatastrophicShellCommandReason(command, cwd);
}
