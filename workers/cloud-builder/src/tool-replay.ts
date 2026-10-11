/**
 * A tool's declared replay policy (`ToolReplayPolicy`, the field desktop
 * `ToolDefinition`s carry): whether a call its process never answered may
 * run again. An undeclared tool is `unsafe`.
 */

import type {
  AgentTool,
} from "@stella/runtime/kernel/agent-core/types.js";
import type { ToolReplayPolicy } from "@stella/runtime/kernel/tools/defs/replay-policy.js";

export type { ToolReplayPolicy };

export type ReplayableAgentTool = AgentTool & { replay?: ToolReplayPolicy };

export const replayPolicyOf = (
  tools: readonly AgentTool[],
  toolName: string,
): ToolReplayPolicy =>
  (tools.find((tool) => tool.name === toolName) as
    | ReplayableAgentTool
    | undefined)?.replay ?? "unsafe";
