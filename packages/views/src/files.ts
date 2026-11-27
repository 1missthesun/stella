// Where a view's files live, shared by every process that touches one: the host that runs it (it
// writes the live status) and the agent tool that writes it (it reads that status back). Node only.
import { readFile } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";

export { VIEW_FILE_RE, isViewPath, viewDataPath, viewKey, viewSourceHash, viewTitle } from "./paths";
import { viewKey, viewSourceHash } from "./paths";

/** The uid on POSIX: Bun's `userInfo().username` follows `$USER`, which a host's child processes may not have. */
const user = (() => {
  const uid = process.getuid?.();
  if (typeof uid === "number" && uid >= 0) return String(uid);
  try {
    return userInfo().username.replace(/[^\w.-]+/gu, "_") || "user";
  } catch {
    return "user";
  }
})();

/** The running view's status, rewritten by its host while it is open (temporary, per user). */
export const viewStatusPath = (filePath: string): string => join(tmpdir(), `stella-views-${user}`, `${viewKey(filePath)}.json`);

export type ViewStatusFile = {
  filePath: string;
  /** `viewSourceHash` of the source this status is for. */
  source: string;
  status: "loading" | "running" | "failed" | "stopped";
  problem: { phase: string; message: string; line?: number; column?: number } | null;
  /** Whether a surface (a chat card, the panel) is showing it, rather than the host running it ahead of one. */
  shown?: boolean;
  /** Milliseconds from reading that source to its first tree. */
  renderMs: number | null;
  at: number;
};

export const readViewStatus = async (filePath: string): Promise<ViewStatusFile | null> => {
  try {
    return JSON.parse(await readFile(viewStatusPath(filePath), "utf8")) as ViewStatusFile;
  } catch {
    return null;
  }
};

/** The marker a views host keeps while it runs views for a data dir, so a tool knows one will pick a new view up. */
export const viewHostMarkerPath = (dataDir: string): string => join(tmpdir(), `stella-views-${user}`, `host-${viewKey(dataDir)}.json`);
export type ViewHostMarker = { pid: number; dataDir: string; at: number };

/** Whether a views host is running for `dataDir` on this device (it runs each new view in `outputs/views` as it is written). */
export async function liveViewHost(dataDir: string): Promise<boolean> {
  try {
    const marker = JSON.parse(await readFile(viewHostMarkerPath(dataDir), "utf8")) as ViewHostMarker;
    if (marker.dataDir !== dataDir) return false;
    process.kill(marker.pid, 0);
    return true;
  } catch (error) {
    // EPERM: alive, someone else's.
    return (error as NodeJS.ErrnoException | undefined)?.code === "EPERM";
  }
}

/**
 * The open view's status once it has run `source`, or null when the view isn't open anywhere on
 * this device or doesn't pick the source up within `waitMs`. With `appear`, a view not open yet
 * (one just written, which the host is about to run) is waited for too.
 */
export async function awaitViewStatus(filePath: string, source: string, waitMs: number, options: { appear?: boolean } = {}): Promise<ViewStatusFile | null> {
  if (!options.appear && !(await readViewStatus(filePath))) return null;
  const want = viewSourceHash(source);
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const status = await readViewStatus(filePath);
    if (status?.source === want && status.status !== "loading") return status;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
}
