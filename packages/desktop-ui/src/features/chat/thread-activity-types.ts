import type { AgentModelConfigSnapshot } from "@stella/contracts/agent-engine";
import type {
  ThreadActivityRecord,
  ThreadActivityUpdatedPayload,
} from "@stella/contracts/local-chat";

export type DesktopThreadActivityRecord = ThreadActivityRecord & {
  source: "stella" | "claude-native";
  attemptGeneration?: number;
  modelConfigSnapshot?: AgentModelConfigSnapshot;
  assistantMessages?: string[];
  assistantMessagesUpdatedAt?: number;
  assistantMessagesUpdatedSequence?: number;
  /** One of pi's agents, from the conversation's pi transcript. */
  pi?: true;
};

export type ThreadActivityAssistantUpdate = {
  threadId: string;
  assistantMessages: string[];
  reasoningSummaries: string[];
  latestMessage: string;
  atMs: number;
  atSequence?: number;
  attemptGeneration: number;
  rootRunId?: string;
};

export type ThreadTranscriptUpdate = {
  source?: "stella" | "claude-native";
  threadId: string;
  entryId: string;
  atMs: number;
};

export type DesktopThreadActivityUpdatedPayload =
  ThreadActivityUpdatedPayload & {
    assistantUpdate?: ThreadActivityAssistantUpdate;
    transcriptUpdate?: ThreadTranscriptUpdate;
  };
