import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Linux kernel start ticks or macOS `ps lstart`; null on Windows or when unreadable. */
export const readProcessIdentity = (pid: number): string | null => {
  try {
    if (process.platform === "linux") {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
      return fields[19] ?? null;
    }
    if (process.platform === "win32") return null;
    const started = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], {
      encoding: "utf8",
      timeout: 2_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return started || null;
  } catch {
    return null;
  }
};

export const pidIsAlive = (pid: number): boolean => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === "EPERM";
  }
};

export const processIdentityIsLive = (
  pid: number,
  identity: string | null,
): boolean => {
  if (!pidIsAlive(pid)) return false;
  if (identity === null) return true;
  const current = readProcessIdentity(pid);
  return current === null || current === identity;
};
