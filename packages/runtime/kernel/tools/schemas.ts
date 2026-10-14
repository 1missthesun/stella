import { getCatastrophicShellCommandReason } from "./shell-command-safety.js";

export function getDangerousCommandReason(
  command: string,
  cwd?: string,
): string | null {
  return getCatastrophicShellCommandReason(command, cwd);
}
