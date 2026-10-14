import { handleEdit } from "../file.js";
import type { ToolDefinition } from "../types.js";
import {
  EDIT_TOOL_DESCRIPTION,
  EDIT_TOOL_NAME,
  EDIT_TOOL_PARAMETERS,
  EDIT_TOOL_REPLAY,
} from "./edit-def.js";

export const editTool: ToolDefinition = {
  name: EDIT_TOOL_NAME,
  replay: EDIT_TOOL_REPLAY,
  description: EDIT_TOOL_DESCRIPTION,
  parameters: EDIT_TOOL_PARAMETERS,
  promptSnippet: "Replace text inside an existing file",
  execute: (args, context) => handleEdit(args, context),
};
