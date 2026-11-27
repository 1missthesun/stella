// Where a view's files live, shared by every process that touches one: the host that runs it (it
// writes the live status) and the agent tool that writes it (it reads that status back). Node only.
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

export { VIEW_FILE_RE, conversationViewRelPath, isViewPath, viewDataPath, viewIdentityFromPath, viewKey, viewSourceHash, viewTitle } from "./paths";
import { conversationViewRelPath, viewKey, viewSourceHash } from "./paths";

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

/** Which synced view (`<conversationId>/<slug>`) each view file on this device is, as its host learned it (kept by the desktop's views host). */
export const viewIdentityIndexPath = (dataDir: string): string => join(dataDir, "views", "identity.json");
export type ViewIdentityIndex = { byPath: Record<string, string>; bySource: Record<string, string> };

/**
 * Where the `view` tool saves a view: `outputs/views/<conversation>/<slug>.view.tsx`, so the same slug
 * in two chats is two views. A view this chat made before views had a folder per chat
 * (`outputs/views/<slug>.view.tsx`, which its host knows as this chat's) keeps its path, so its
 * cards and saved data stay one view. With no conversation, the flat path.
 */
export async function viewFilePathFor(dataDir: string, conversationId: string | null | undefined, slug: string): Promise<string> {
  const flat = join(dataDir, "outputs", "views", `${slug}.view.tsx`);
  const id = conversationId?.trim();
  if (!id) return flat;
  try {
    const index = JSON.parse(await readFile(viewIdentityIndexPath(dataDir), "utf8")) as Partial<ViewIdentityIndex>;
    if (index.byPath?.[flat] === `${id}/${slug}`) return flat;
  } catch {
    // No views opened here yet.
  }
  return join(dataDir, ...conversationViewRelPath(id, slug).split("/"));
}

/**
 * The newest restore applied to a view's file on this computer, kept beside the views' data: it
 * makes a restore from another device land once (and not over a newer edit), and tells the `view`
 * tool when an agent's next call would undo it without knowing (`told` names who already knows).
 */
export type ViewRestoreMark = {
  filePath: string;
  /** The restore's own version (`createdAt`), so the same restore lands once. */
  createdAt: number;
  /** The `createdAt` of the version it brought back. */
  restoredFrom: number;
  /** `viewSourceHash` of the restored source. */
  source: string;
  told: string[];
};

export const viewRestoreMarkPath = (dataDir: string, filePath: string): string => join(dataDir, "views", "restores", `${viewKey(filePath)}.json`);

export const readViewRestoreMark = async (dataDir: string, filePath: string): Promise<ViewRestoreMark | null> => {
  try {
    const mark = JSON.parse(await readFile(viewRestoreMarkPath(dataDir, filePath), "utf8")) as ViewRestoreMark;
    return mark && mark.filePath === filePath && typeof mark.createdAt === "number" ? { ...mark, told: Array.isArray(mark.told) ? mark.told : [] } : null;
  } catch {
    return null;
  }
};

const writeAtomic = async (file: string, text: string) => {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, file);
};

export const writeViewRestoreMark = (dataDir: string, mark: ViewRestoreMark): Promise<void> => writeAtomic(viewRestoreMarkPath(dataDir, mark.filePath), JSON.stringify(mark));

/** Notes that `who` (an agent, or "orchestrator") knows about the view's latest restore. */
export async function tellViewRestore(dataDir: string, filePath: string, createdAt: number, who: string): Promise<void> {
  const mark = await readViewRestoreMark(dataDir, filePath);
  if (!mark || mark.createdAt !== createdAt || mark.told.includes(who)) return;
  await writeViewRestoreMark(dataDir, { ...mark, told: [...mark.told, who] });
}

/**
 * Puts a restored version into the view's file on this computer, when the file is here and nothing
 * newer was written to it since the restore was made. Whole-file rename, so an open view never reads
 * half a file (its host sees the change and swaps, keeping state).
 */
export async function applyViewRestore(
  dataDir: string,
  restore: { filePath: string; source: string; createdAt: number; restoredFrom: number; told?: string },
): Promise<"written" | "current" | "newer" | "missing"> {
  const { filePath, source, createdAt, restoredFrom } = restore;
  if (!isAbsolute(filePath)) return "missing";
  let current: string;
  let modifiedAt: number;
  try {
    [current, modifiedAt] = await Promise.all([readFile(filePath, "utf8"), stat(filePath).then((s) => s.mtimeMs)]);
  } catch {
    return "missing";
  }
  const mark = await readViewRestoreMark(dataDir, filePath);
  const told = restore.told ? [restore.told] : [];
  if (mark?.createdAt === createdAt) {
    if (restore.told) await tellViewRestore(dataDir, filePath, createdAt, restore.told);
    return "current";
  }
  // An older restore (a newer one landed already), or one made before the file's latest write.
  if ((mark && mark.createdAt > createdAt) || modifiedAt > createdAt) return "newer";
  const next: ViewRestoreMark = { filePath, createdAt, restoredFrom, source: viewSourceHash(source), told };
  if (current !== source) await writeAtomic(filePath, source);
  await writeViewRestoreMark(dataDir, next);
  return current === source ? "current" : "written";
}
