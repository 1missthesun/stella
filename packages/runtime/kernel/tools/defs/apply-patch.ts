import { handleApplyPatch } from "../apply-patch.js";
import type { ToolDefinition } from "../types.js";
import {
  APPLY_PATCH_TOOL_DESCRIPTION,
  APPLY_PATCH_TOOL_NAME,
  APPLY_PATCH_TOOL_PARAMETERS,
  APPLY_PATCH_TOOL_PROMPT_SNIPPET,
  APPLY_PATCH_TOOL_REPLAY,
} from "./apply-patch-def.js";

export const applyPatchTool: ToolDefinition = {
  name: APPLY_PATCH_TOOL_NAME,
  replay: APPLY_PATCH_TOOL_REPLAY,
  description: APPLY_PATCH_TOOL_DESCRIPTION,
  promptSnippet: APPLY_PATCH_TOOL_PROMPT_SNIPPET,
  parameters: APPLY_PATCH_TOOL_PARAMETERS,
  execute: (args, context) => handleApplyPatch(args, context),
};
