// Where a view's files live, shared by every process that touches one: the host that runs it (it
// writes the live status) and the agent tool that writes it (it reads that status back). Node only.
import { readFile } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { basename, join } from "node:path";

export const VIEW_FILE_RE = /\.view\.(tsx|ts|jsx|js)$/iu;

export const isViewPath = (filePath: string): boolean => VIEW_FILE_RE.test(filePath);

/** A short stable id for a view's path (FNV-1a), naming its storage and status. */
export const viewKey = (filePath: string): string => {
  let h = 0x811c9dc5;
  for (let i = 0; i < filePath.length; i++) h = Math.imul(h ^ filePath.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
};

/** A content hash of a view's source, so a status names the source it came from. */
export const viewSourceHash = (source: string): string => {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < source.length; i++) {
    const c = source.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
  }
  return (a >>> 0).toString(36) + (b >>> 0).toString(36);
};

/** The view's data file: `name.view.tsx` → `name.data.json` beside it. */
export const viewDataPath = (filePath: string): string => filePath.replace(VIEW_FILE_RE, ".data.json");

export const viewTitle = (filePath: string): string =>
  basename(filePath)
    .replace(VIEW_FILE_RE, "")
    .replace(/[-_]+/gu, " ")
    .replace(/^\w/u, (c) => c.toUpperCase());

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
