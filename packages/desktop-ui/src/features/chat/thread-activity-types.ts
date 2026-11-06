import type { AgentModelConfigSnapshot } from "@stella/contracts/agent-engine";
import type { ThreadActivityRecord } from "@stella/contracts/local-chat";

export type DesktopThreadActivityRecord = ThreadActivityRecord & {
  source: "stella" | "claude-native";
  attemptGeneration?: number;
  modelConfigSnapshot?: AgentModelConfigSnapshot;
  assistantMessages?: string[];
  assistantMessagesUpdatedAt?: number;
  assistantMessagesUpdatedSequence?: number;
  pi?: true;
};
