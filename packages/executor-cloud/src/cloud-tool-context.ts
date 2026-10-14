import type { ToolContext } from "@stella/runtime/kernel/tools/types.js";
import { CLOUD_TOOL_PROCESS_IDENTITY } from "./cloud-process-isolation.js";

export const cloudAgentToolContext = (args: {
  threadId: string;
  workspaceRoot: string;
  workspaceStateDir: string;
  toolHome: string;
  requestId?: string;
  allowedToolNames?: readonly string[];
}): ToolContext => ({
  ...(args.allowedToolNames
    ? { allowedToolNames: [...args.allowedToolNames] }
    : {}),
  executionHost: "sandbox",
  conversationId: args.threadId,
  deviceId: "cloud",
  requestId: args.requestId ?? crypto.randomUUID(),
  agentType: "general",
  workingDirectory: args.workspaceRoot,
  stellaAppDir: args.workspaceRoot,
  stellaDataDir: args.workspaceStateDir,
  toolWorkspaceRoot: args.workspaceRoot,
  toolStateRoot: args.toolHome,
  storageMode: "cloud",
  toolProcessIdentity: {
    ...CLOUD_TOOL_PROCESS_IDENTITY,
    home: args.workspaceRoot,
  },
  agentId: args.threadId,
  agentDepth: 1,
  maxAgentDepth: 1,
});
