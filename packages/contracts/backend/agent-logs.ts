export type AgentLogRole = "user" | "assistant" | "toolResult" | "checkpoint";

export type AgentLogRecordDraft = {
  key: string;
  role: AgentLogRole;
  payloadJson: string;
};

export type AgentLogRecord = AgentLogRecordDraft & { seq: number; createdAt: number };

export type AgentLogCheckpointPayload = { summary: string; firstKeptSeq?: number; firstKeptKey?: string };

export type AgentLogCheckpoint = { summary: string; throughSeq: number };

export const agentLogDeviceHolder = (deviceId: string): string => `device:${deviceId}`;
export const AGENT_LOG_CLOUD_HOLDER = "cloud";

export const AGENT_LOG_RECORD_MAX_BYTES = 256 * 1024;
export const AGENT_LOG_APPEND_MAX_BODY_BYTES = 1024 * 1024;
export const AGENT_LOG_READ_MAX_RECORDS = 200;
export const AGENT_LOG_MOVED_REASON = "agent_log_moved";

export type AgentLogCalls = {
  "agentLogs.append": {
    args: { threadId: string; conversationId: string; holder: string; records: AgentLogRecordDraft[] };
    result: { seqs: number[]; throughSeq: number };
  };
  "agentLogs.read": {
    args: { threadId: string; afterSeq: number; limit?: number };
    result: {
      records: AgentLogRecord[];
      complete: boolean;
      checkpoint?: AgentLogCheckpoint;
      holder?: string;
      cwd?: string;
    };
  };
};
