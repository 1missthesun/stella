import crypto from "crypto";
import type {
  Context,
  ImageContent,
  Message,
  TextContent,
  ThinkingContent,
  Tool,
  ToolCall,
} from "@earendil-works/pi-ai";
import { getAgentRuntimeEngine } from "@stella/node-shared/preferences/local-preferences.js";
import type { AgentRuntimeEngine } from "@stella/contracts/agent-engine";
import {
  resolveAgentWorkingDirectory,
  textFromUnknown,
} from "../agent-runtime/shared.js";
import type { ToolMetadata, ToolResult } from "../tools/types.js";
import {
  closeClaudeCodeSessionWhenIdle,
  isClaudeCodeModel,
  runClaudeCodeTurn,
} from "./claude-code-session-runtime.js";
import {
  CLAUDE_CODE_LIGHT_MODEL,
  getClaudeCodeAgentModelId,
  getClaudeCodeRuntimeEffortLevel,
} from "./claude-code-model-config.js";

export type ClaudeCodeAgentRuntimeEngine = AgentRuntimeEngine;
export {
  CLAUDE_CODE_LIGHT_MODEL,
  getClaudeCodeAgentModelId,
  getClaudeCodeRuntimeEffortLevel,
};

export const shouldUseClaudeCodeAgentRuntime = (args: {
  stellaAppDir?: string;
  agentEngine?: ClaudeCodeAgentRuntimeEngine;
  modelId?: string;
}): boolean => {
  if (args.agentEngine === "claude_code_local") {
    return true;
  }
  if (args.agentEngine && args.agentEngine !== "default") {
    return false;
  }
  if (args.modelId && isClaudeCodeModel(args.modelId)) {
    return true;
  }
  if (args.agentEngine === "default") {
    return false;
  }
  const stellaAppDir = args.stellaAppDir?.trim();
  return stellaAppDir
    ? getAgentRuntimeEngine(stellaAppDir) === "claude_code_local"
    : false;
};

type PromptContentPart =
  | TextContent
  | ImageContent
  | ThinkingContent
  | ToolCall;

const contentPartToText = (part: PromptContentPart): string => {
  if (part.type === "text") return part.text;
  if (part.type === "thinking") return part.thinking;
  if (part.type === "image") return `[Image: ${part.mimeType}]`;
  if (part.type === "toolCall") {
    return [`[Tool call: ${part.name}]`, textFromUnknown(part.arguments)]
      .filter(Boolean)
      .join("\n");
  }
  return "";
};

const messageContentToText = (message: Message): string =>
  (typeof message.content === "string"
    ? message.content
    : message.content
        .map(contentPartToText)
        .filter((part) => part.trim().length > 0)
        .join("\n\n")
  ).trim();

const formatPromptMessage = (message: Message, index: number): string => {
  const text = messageContentToText(message);
  if (!text) return "";
  return [`### ${message.role} ${index + 1}`, text].join("\n");
};

const buildPromptFromMessages = (messages: Message[]): string =>
  messages
    .map(formatPromptMessage)
    .filter((message) => message.trim().length > 0)
    .join("\n\n");

const toolsToMetadata = (tools: Tool[] | undefined): ToolMetadata[] =>
  (tools ?? []).map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters as Record<string, unknown>,
  }));

export const runClaudeCodeAgentTextCompletion = async (args: {
  stellaAppDir: string;
  agentType: string;
  context: Context;
  runId?: string;
  sessionKey?: string;
  abortSignal?: AbortSignal;
  stellaModel?: string;
  modelOverride?: string;
  effortLevel?: string;
  cwd?: string;
  executeTool?: (
    toolCallId: string,
    toolName: string,
    toolArgs: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<ToolResult>;
  onModelRound?: (args: { messageId?: string; toolCallCount: number }) => void;
}): Promise<string> => {
  const runId =
    args.runId ?? `claude-code:${args.agentType}:${crypto.randomUUID()}`;
  const modelId = getClaudeCodeAgentModelId(
    args.stellaAppDir,
    args.stellaModel,
    args.agentType,
    args.modelOverride,
  );
  const effortLevel =
    args.effortLevel ?? getClaudeCodeRuntimeEffortLevel(args.stellaAppDir);
  const sessionKey = args.sessionKey ?? `${args.agentType}:one-shot:${runId}`;
  try {
    const result = await runClaudeCodeTurn({
      runId,
      sessionKey,
      modelId,
      ...(effortLevel ? { effortLevel } : {}),
      prompt: buildPromptFromMessages(args.context.messages),
      systemPrompt: args.context.systemPrompt,
      cwd: resolveAgentWorkingDirectory({
        agentType: args.agentType,
        stellaAppDir: args.stellaAppDir,
        workingDirectory: args.cwd,
      }),
      tools: toolsToMetadata(args.context.tools),
      abortSignal: args.abortSignal,
      ...(args.onModelRound ? { onModelRound: args.onModelRound } : {}),
      executeTool: async (
        toolCallId: any,
        toolName: any,
        toolArgs: any,
        signal: any,
      ) => {
        if (!args.executeTool) {
          return { error: `Tool ${toolName} is not available in this run.` };
        }
        return args.executeTool(toolCallId, toolName, toolArgs, signal);
      },
    });
    return result.text;
  } finally {
    if (!args.sessionKey) closeClaudeCodeSessionWhenIdle(sessionKey);
  }
};
