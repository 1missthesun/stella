import { promises as fs } from "node:fs";
import path from "node:path";

export type MergeFrom = "upstream" | "remote" | "draft";

export type DispatchedAgent = { conversationId: string; threadId: string };

/** The one merge Stella sent an agent to draft. Kept in the git common dir. */
export type MergeRecord = {
  draft: string;
  from: MergeFrom;
  /** For a stale draft: its tip when the agent was sent, to tell it apart from the agent's result. */
  tip: string;
  since: number;
  agent: DispatchedAgent | null;
};

export type MergeStatus = "dispatched" | "drafting" | "ready" | "stale" | "abandoned";

/** What git and the runtime say about the record's draft right now. */
export type MergeFacts = {
  worktree: boolean;
  tip: string | null;
  descendsFromHead: boolean;
  offered: boolean;
  agentRunning: boolean | null;
  now: number;
};

export const MERGE_START_GRACE_MS = 2 * 60_000;
export const MERGE_WAIT_MS = 60 * 60_000;

export const classifyMerge = (record: MergeRecord, facts: MergeFacts): MergeStatus => {
  const age = facts.now - record.since;
  if (age > MERGE_WAIT_MS && !(facts.tip && facts.descendsFromHead && facts.offered)) {
    return "abandoned";
  }
  if (facts.worktree) return facts.agentRunning === false ? "abandoned" : "drafting";
  if (facts.tip && facts.descendsFromHead) return facts.offered ? "ready" : "drafting";
  const untouched = !facts.tip || (record.from === "draft" && facts.tip === record.tip);
  if (!untouched) return "stale";
  if (facts.agentRunning === true) return "dispatched";
  if (facts.agentRunning === false) return "abandoned";
  return age < MERGE_START_GRACE_MS ? "dispatched" : "abandoned";
};

export const isMerging = (status: MergeStatus) =>
  status === "dispatched" || status === "drafting";

const FILE = "stella-merge.json";

const parse = (text: string): MergeRecord | null => {
  const value = JSON.parse(text) as Partial<MergeRecord> | null;
  if (
    !value ||
    typeof value.draft !== "string" ||
    (value.from !== "upstream" && value.from !== "remote" && value.from !== "draft") ||
    typeof value.tip !== "string" ||
    typeof value.since !== "number"
  ) {
    return null;
  }
  const agent = value.agent;
  return {
    draft: value.draft,
    from: value.from,
    tip: value.tip,
    since: value.since,
    agent:
      agent && typeof agent.conversationId === "string" && typeof agent.threadId === "string"
        ? { conversationId: agent.conversationId, threadId: agent.threadId }
        : null,
  };
};

export const readMergeRecord = async (commonDir: string): Promise<MergeRecord | null> => {
  const text = await fs.readFile(path.join(commonDir, FILE), "utf8").catch(() => null);
  if (text === null) return null;
  try {
    return parse(text);
  } catch {
    return null;
  }
};

export const writeMergeRecord = async (commonDir: string, record: MergeRecord | null) => {
  const file = path.join(commonDir, FILE);
  if (!record) {
    await fs.rm(file, { force: true });
    return;
  }
  await fs.writeFile(`${file}.tmp`, JSON.stringify(record));
  await fs.rename(`${file}.tmp`, file);
};
