import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

/** macOS caps `sockaddr_un` paths at 104 bytes including the trailing NUL. */
export const automationSocketsRootDir = (homeDir: string = os.homedir()) =>
  path.join(homeDir, ".stella", "computer-sockets");

export const automationSocketFileName = (stateDir: string, sessionId: string) =>
  `${createHash("sha1")
    .update(`${path.resolve(stateDir)}\n${sessionId}`)
    .digest("hex")
    .slice(0, 16)}.sock`;

export const resolveAutomationSocketPath = (
  stateDir: string,
  sessionId: string,
  options?: { homeDir?: string },
) =>
  path.join(
    automationSocketsRootDir(options?.homeDir),
    automationSocketFileName(stateDir, sessionId),
  );

/**
 * Defensive ceiling kept below the 104-byte BSD `sun_path` limit (UTF-8
 * bytes + NUL, so 103 usable). Exceeding it means the home directory itself
 * is extraordinarily long; callers should fail with a readable error naming
 * the path instead of letting the daemon die with its opaque
 * "Daemon socket path is too long".
 */
export const maxAutomationSocketPathBytes = 100;
