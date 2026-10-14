import type { ToolHandler } from "./types.js";
import type { ToolDefinition } from "../extensions/types.js";

export const registerExtensionToolHandlers = (
  handlers: Record<string, ToolHandler>,
  extensionTools?: ToolDefinition[],
): void => {
  if (!extensionTools) return;
  for (const tool of extensionTools) {
    handlers[tool.name] = (args, context) => tool.execute(args, context);
  }
};
