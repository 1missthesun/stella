import { handleRead } from "../file.js";
import type { ToolDefinition } from "../types.js";
import {
  READ_TOOL_DESCRIPTION,
  READ_TOOL_NAME,
  READ_TOOL_PARAMETERS,
  READ_TOOL_REPLAY,
} from "./read-def.js";

export const readTool: ToolDefinition = {
  name: READ_TOOL_NAME,
  replay: READ_TOOL_REPLAY,
  description: READ_TOOL_DESCRIPTION,
  parameters: READ_TOOL_PARAMETERS,
  execute: (args, context) => handleRead(args, context),
};
