import type {
  AgentTool,
} from "@stella/runtime/kernel/agent-core/types.js";
import type { ToolReplayPolicy } from "@stella/runtime/kernel/tools/defs/replay-policy.js";

export type { ToolReplayPolicy };

export type ReplayableAgentTool = AgentTool & { replay?: ToolReplayPolicy };
