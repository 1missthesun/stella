import { AGENT_IDS } from "@stella/contracts/agent-runtime";
import type { AgentRuntimeEngine } from "@stella/contracts/agent-engine";
import type { Api, Model } from "@earendil-works/pi-ai";

export const APPLY_PATCH_TOOL_NAME = "apply_patch";
export const WRITE_TOOL_NAME = "Write";
export const EDIT_TOOL_NAME = "Edit";

export type FileEditToolFamily = "apply_patch" | "write_edit";
export type FileEditAgentEngine = AgentRuntimeEngine;

type ModelIdentity = Pick<Model<Api>, "api" | "provider" | "id" | "name">;

const hasOpenAiPrefix = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "openai" ||
    normalized === "chatgpt" ||
    normalized.startsWith("openai/") ||
    normalized.startsWith("stella/openai/")
  );
};

export const isOpenAiAuthoredModel = (model?: ModelIdentity | null): boolean => {
  if (!model) {
    return true;
  }
  if (
    hasOpenAiPrefix(model.provider) ||
    hasOpenAiPrefix(model.api) ||
    hasOpenAiPrefix(model.id)
  ) {
    return true;
  }
  const id = model.id.trim().toLowerCase();
  return (
    id.startsWith("gpt-") ||
    id.startsWith("o1") ||
    id.startsWith("o3") ||
    id.startsWith("o4")
  );
};

export const getFileEditToolFamily = (args: {
  agentType?: string;
  model?: ModelIdentity | null;
  agentEngine?: FileEditAgentEngine;
}): FileEditToolFamily => {
  if (args.agentEngine === "claude_code_local") {
    return "write_edit";
  }
  if (!args.agentType || args.agentType === AGENT_IDS.ORCHESTRATOR) {
    return "apply_patch";
  }
  return isOpenAiAuthoredModel(args.model) ? "apply_patch" : "write_edit";
};

