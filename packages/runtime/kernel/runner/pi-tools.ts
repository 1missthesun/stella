import { AGENT_IDS } from "@stella/contracts/agent-runtime";
import {
  collectVisibleDemotedTools,
  executeModelToolCall,
} from "../agent-runtime/tool-adapters.js";
import type { AgentToolResult } from "../agent-core/types.js";
import { buildDemotedCodeSuffix } from "../tools/code-catalog.js";
import { CODE_TOOL_NAME, toolRequiresExplicitApproval } from "../tools/code-tool.js";
import { CODE_TOOL_ORCHESTRATOR_DESCRIPTION } from "../tools/defs/code-def.js";
import type { ToolMetadata } from "../tools/types.js";
import { resolveAgent, resolveAgentModelRoute } from "./context.js";
import type { RunnerContext } from "./types.js";

const HARNESS_TOOL_NAMES = new Set([
  "spawn_agent",
  "send_message",
  "stop_agent",
  "agent_status",
  "Bash",
  "exec_command",
  "write_stdin",
  "apply_patch",
  "Write",
  "Edit",
  "Grep",
  "multi_tool_use_parallel",
  "NoResponse",
  "node_repl",
  "switch_destination",
]);

export type PiToolAgentType = "orchestrator" | "general";

export type PiToolSpec = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  replay?: "safe" | "keyed" | "unsafe";
  codeOnly?: { searchTerms?: readonly string[] };
};

export type PiToolCall = {
  agentType: PiToolAgentType;
  name: string;
  callId: string;
  args: Record<string, unknown>;
  conversationId: string;
  agentId?: string;
  signal?: AbortSignal;
};

export type RunnerPiTools = {
  specs: (agentType: PiToolAgentType) => PiToolSpec[];
  run: (call: PiToolCall) => Promise<AgentToolResult<unknown>>;
  shellEnvironment: (owner: { conversationId: string; agentId?: string; cwd: string }) => Record<string, string>;
  endAgentBrowserTurn: (agentId: string) => Promise<void>;
  releaseAgentComputerUse: (agentId: string) => Promise<void>;
  cliBridgeSocketPath?: string;
};

const offeredTools = (
  context: RunnerContext,
  agentType: PiToolAgentType,
): ToolMetadata[] => {
  const allowed = new Set(resolveAgent(context, agentType)?.toolsAllowlist ?? []);
  const catalog = context.toolHost.getToolCatalog(agentType);
  const demoted = new Set(
    collectVisibleDemotedTools(catalog, undefined).map((tool) => tool.name),
  );
  return catalog.filter(
    (tool) =>
      !HARNESS_TOOL_NAMES.has(tool.name) &&
      !(agentType === "general" && tool.name === "Read") &&
      (demoted.has(tool.name) || (!tool.demoted && allowed.has(tool.name))),
  );
};

const runIdFor = (owner: string) => `pi-${owner.replace(/[^A-Za-z0-9_-]/g, "_")}`;

const codeReachableDemoted = (offered: readonly ToolMetadata[]) =>
  offered.filter((tool) => tool.demoted && !toolRequiresExplicitApproval(tool.approval));

export const createRunnerPiTools = (context: RunnerContext): RunnerPiTools => ({
  ...(context.cliBridgeSocketPath ? { cliBridgeSocketPath: context.cliBridgeSocketPath } : {}),
  shellEnvironment: ({ conversationId, agentId, cwd }) =>
    context.toolHost.buildAgentShellEnvironment(
      {
        executionHost: "device",
        conversationId,
        deviceId: context.deviceId,
        requestId: runIdFor(agentId ?? conversationId),
        runId: runIdFor(agentId ?? conversationId),
        agentType: agentId ? AGENT_IDS.GENERAL : AGENT_IDS.ORCHESTRATOR,
        stellaAppDir: context.stellaAppDir,
        stellaDataDir: context.stellaDataDir,
        agentWorkingDirectory: cwd,
        ...(agentId ? { agentId } : {}),
      },
      cwd,
    ),
  endAgentBrowserTurn: async (agentId) => {
    await context.toolHost.endBrowserTurn(runIdFor(agentId), "close-tabs");
  },
  releaseAgentComputerUse: async (agentId) => {
    await context.toolHost.releaseAgentComputerSessions(agentId);
  },
  specs: (agentType) => {
    const offered = offeredTools(context, agentType);
    return offered.map((tool) => ({
      name: tool.name,
      description:
        tool.name === CODE_TOOL_NAME
          ? `${agentType === "orchestrator" ? CODE_TOOL_ORCHESTRATOR_DESCRIPTION : tool.description}${buildDemotedCodeSuffix(codeReachableDemoted(offered))}`
          : tool.description,
      parameters: tool.parameters,
      ...(tool.replay ? { replay: tool.replay } : {}),
      ...(tool.demoted && !toolRequiresExplicitApproval(tool.approval)
        ? {
            codeOnly: {
              ...(tool.demoted.searchTerms ? { searchTerms: tool.demoted.searchTerms } : {}),
            },
          }
        : {}),
    }));
  },
  run: async (call) => {
    const offered = offeredTools(context, call.agentType);
    if (!offered.some((tool) => tool.name === call.name)) {
      return {
        content: [{ type: "text", text: `${call.name} is not available here.` }],
        details: undefined,
        isError: true,
      } as AgentToolResult<unknown>;
    }
    const agentType =
      call.agentType === "orchestrator" ? AGENT_IDS.ORCHESTRATOR : AGENT_IDS.GENERAL;
    const model = await resolveAgentModelRoute(context, agentType)
      .then(({ resolvedLlm }) => resolvedLlm.model)
      .catch(() => undefined);
    return await executeModelToolCall(
      {
        executionHost: "device",
        runId: runIdFor(call.agentId ?? call.conversationId),
        conversationId: call.conversationId,
        storageMode: "local",
        agentType,
        ...(call.agentId ? { agentId: call.agentId } : {}),
        deviceId: context.deviceId,
        stellaAppDir: context.stellaAppDir,
        stellaDataDir: context.stellaDataDir,
        store: context.runtimeStore,
        toolExecutor: async (toolName, toolArgs, toolContext, signal, onUpdate) =>
          await context.toolHost.executeTool(toolName, toolArgs, toolContext, signal, onUpdate),
        hookEmitter: context.hookEmitter,
        allowedToolNames: offered.map((tool) => tool.name),
        ...(model
          ? { imageCapTarget: { provider: model.provider, api: model.api, modelId: model.id } }
          : {}),
      },
      {
        toolName: call.name,
        toolCallId: call.callId,
        params: call.args,
        ...(call.signal ? { signal: call.signal } : {}),
      },
    );
  },
});
