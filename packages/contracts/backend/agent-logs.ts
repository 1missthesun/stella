/**
 * Every agent's conversation, kept in the owner's cloud the way the
 * orchestrator's journal is: whichever host runs the agent (its holder)
 * writes what the agent's transcript gains, step by step, as append-only
 * records numbered by `seq`; nobody else receives them live. A host that
 * takes the agent over (a `switch_destination`, a takeover) reads only the
 * records after the newest seq it already has, into its own transcript, and
 * carries on there. The holder is the one writer: a move names the next one,
 * and the cloud refuses records from any other.
 */

/** What a record holds: a transcript message, or a compaction's summary. */
export type AgentLogRole = "user" | "assistant" | "toolResult" | "checkpoint";

export type AgentLogRecordDraft = {
  /** The writer's id for the record, unique per agent, so a retried append writes it once. */
  key: string;
  role: AgentLogRole;
  /**
   * The message as JSON; for a checkpoint, `AgentLogCheckpointPayload` with
   * the first message it kept named by `firstKeptKey`.
   */
  payloadJson: string;
};

export type AgentLogRecord = AgentLogRecordDraft & { seq: number; createdAt: number };

/** A compaction: its summary opens the context, followed by everything from `firstKeptSeq`. */
export type AgentLogCheckpointPayload = { summary: string; firstKeptSeq?: number; firstKeptKey?: string };

/** Where a new transcript of the agent starts: after `throughSeq`, opened by `summary`. */
export type AgentLogCheckpoint = { summary: string; throughSeq: number };

/** The holder that writes an agent's records: one of the owner's computers, or the cloud. */
export const agentLogDeviceHolder = (deviceId: string): string => `device:${deviceId}`;
export const AGENT_LOG_CLOUD_HOLDER = "cloud";

export const AGENT_LOG_RECORD_MAX_BYTES = 256 * 1024;
export const AGENT_LOG_APPEND_MAX_BODY_BYTES = 1024 * 1024;
export const AGENT_LOG_READ_MAX_RECORDS = 200;
/** The refusal of a record from a host that no longer holds the agent. */
export const AGENT_LOG_MOVED_REASON = "agent_log_moved";

export type AgentLogCalls = {
  /** Records the holder's transcript gained; idempotent per key. */
  "agentLogs.append": {
    args: { threadId: string; conversationId: string; holder: string; records: AgentLogRecordDraft[] };
    result: { seqs: number[]; throughSeq: number };
  };
  /**
   * Records after `afterSeq`, oldest first. A first read (`afterSeq` -1) of
   * an agent that compacted starts at its newest checkpoint.
   */
  "agentLogs.read": {
    args: { threadId: string; afterSeq: number; limit?: number };
    result: {
      records: AgentLogRecord[];
      complete: boolean;
      checkpoint?: AgentLogCheckpoint;
      /** Who holds the agent now. */
      holder?: string;
      /** The folder it worked in where it ran last, which a new holder uses when it has one at that path. */
      cwd?: string;
    };
  };
};
