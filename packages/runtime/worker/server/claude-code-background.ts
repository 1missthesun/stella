import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ClaudeCodeBackgroundTaskInfo } from "../../kernel/integrations/claude-code-session-runtime.js";

/**
 * The background commands and monitors each task's Claude Code process runs,
 * kept on disk as they change. They end with the process, so what a quit or a
 * crash leaves here is what the restart stopped; each task hears that after
 * the next start. Entries name the worker that wrote them: the next worker
 * takes only its predecessors'.
 */
type Entry = {
  conversationId: string;
  threadId: string;
  tasks: ClaudeCodeBackgroundTaskInfo[];
  worker: string;
  at: number;
};

export type StoppedClaudeCodeBackground = Omit<Entry, "worker">;

const WORKER = `${process.pid}:${Date.now()}`;

const fileOf = (stellaDataDir: string) => path.join(stellaDataDir, "agent", "claude-code-background.json");

const read = (file: string): Record<string, Entry> => {
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, Entry>) : {};
  } catch {
    return {};
  }
};

const write = (file: string, entries: Record<string, Entry>) => {
  mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(entries));
  renameSync(tmp, file);
};

const live = new Map<string, Entry>();

export const noteClaudeCodeBackground = (
  stellaDataDir: string,
  ref: { sessionKey: string; conversationId: string; threadId?: string },
  tasks: readonly ClaudeCodeBackgroundTaskInfo[],
): void => {
  if (!ref.threadId) return;
  const file = fileOf(stellaDataDir);
  const entries = read(file);
  if (tasks.length === 0) {
    live.delete(ref.sessionKey);
    if (entries[ref.sessionKey]?.worker !== WORKER) return;
    delete entries[ref.sessionKey];
  } else {
    const entry: Entry = { conversationId: ref.conversationId, threadId: ref.threadId, tasks: [...tasks], worker: WORKER, at: Date.now() };
    live.set(ref.sessionKey, entry);
    const earlier = entries[ref.sessionKey];
    // A predecessor's entry for this session is what its quit stopped: keep it to be told.
    if (earlier && earlier.worker !== WORKER) entries[`${ref.sessionKey}@${earlier.worker}`] = earlier;
    entries[ref.sessionKey] = entry;
  }
  try {
    write(file, entries);
  } catch (error) {
    console.warn("[claude-code-engine] recording background work failed", error);
  }
};

/** What a task's Claude Code process runs in the background right now. */
export const claudeCodeBackgroundOf = (threadId: string): ClaudeCodeBackgroundTaskInfo[] =>
  [...live.values()].filter((entry) => entry.threadId === threadId).flatMap((entry) => entry.tasks);

/** Takes what earlier runs of Stella left running: their quit or crash stopped it. */
export const takeStoppedClaudeCodeBackground = (stellaDataDir: string): StoppedClaudeCodeBackground[] => {
  const file = fileOf(stellaDataDir);
  const entries = read(file);
  const stopped: StoppedClaudeCodeBackground[] = [];
  for (const [key, entry] of Object.entries(entries)) {
    if (entry.worker === WORKER) continue;
    delete entries[key];
    if (entry.threadId && Array.isArray(entry.tasks) && entry.tasks.length > 0) {
      stopped.push({ conversationId: entry.conversationId, threadId: entry.threadId, tasks: entry.tasks, at: entry.at });
    }
  }
  if (stopped.length > 0) {
    try {
      write(file, entries);
    } catch (error) {
      console.warn("[claude-code-engine] clearing stopped background work failed", error);
    }
  }
  return stopped;
};
