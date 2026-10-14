import {
  maybeOfferBrowserExtensionConnect,
  type BrowserExtensionConnectRequester,
} from "../browser-extension-offer.js";
import { handleExecCommand, type ShellState } from "../shell.js";
import type { ToolDefinition } from "../types.js";
import {
  EXEC_COMMAND_TOOL_DESCRIPTION,
  EXEC_COMMAND_TOOL_NAME,
  EXEC_COMMAND_TOOL_PARAMETERS,
  EXEC_COMMAND_TOOL_PROMPT_SNIPPET,
  EXEC_COMMAND_TOOL_REPLAY,
} from "./exec-command-def.js";

export type ExecCommandToolOptions = {
  requestBrowserExtensionConnect?: BrowserExtensionConnectRequester;
};

export const createExecCommandTool = (
  shellState: ShellState,
  options: ExecCommandToolOptions = {},
): ToolDefinition => ({
  name: EXEC_COMMAND_TOOL_NAME,
  replay: EXEC_COMMAND_TOOL_REPLAY,
  description: EXEC_COMMAND_TOOL_DESCRIPTION,
  promptSnippet: EXEC_COMMAND_TOOL_PROMPT_SNIPPET,
  parameters: EXEC_COMMAND_TOOL_PARAMETERS,
  execute: async (args, context, extras) => {
    const run = () =>
      handleExecCommand(
        shellState,
        args,
        context,
        extras?.signal,
        extras?.onUpdate,
      );
    const result = await run();
    const command = typeof args.cmd === "string" ? args.cmd : "";
    if (!command || !options.requestBrowserExtensionConnect) return result;
    return await maybeOfferBrowserExtensionConnect({
      result,
      command,
      requestConnect: options.requestBrowserExtensionConnect,
      rerun: run,
      ...(context?.conversationId
        ? { conversationId: context.conversationId }
        : {}),
      ...(context?.agentId ? { agentId: context.agentId } : {}),
      signal: extras?.signal,
    });
  },
});
