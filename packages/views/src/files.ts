// Where a view's files live, shared by every process that touches one: the host that runs it (it
// writes the live status) and the agent tool that writes it (it reads that status back). Node only.
import { readFile } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";

export { VIEW_FILE_RE, isViewPath, viewDataPath, viewKey, viewSourceHash, viewTitle } from "./paths";
import { viewKey, viewSourceHash } from "./paths";

const user = (() => {
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
  problem: { phase: string; message: string } | null;
  /** Milliseconds from reading that source to its first tree. */
  renderMs: number | null;
  at: number;
};

const readStatus = async (filePath: string): Promise<ViewStatusFile | null> => {
  try {
    return JSON.parse(await readFile(viewStatusPath(filePath), "utf8")) as ViewStatusFile;
  } catch {
    return null;
  }
};

/**
 * The open view's status once it has run `source`, or null when the view isn't open anywhere on
 * this device or doesn't pick the source up within `waitMs`.
 */
export async function awaitViewStatus(filePath: string, source: string, waitMs: number): Promise<ViewStatusFile | null> {
  if (!(await readStatus(filePath))) return null;
  const want = viewSourceHash(source);
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const status = await readStatus(filePath);
    if (status?.source === want && status.status !== "loading") return status;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return null;
}
