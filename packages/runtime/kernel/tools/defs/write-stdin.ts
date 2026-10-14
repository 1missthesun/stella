import {
  maybeOfferBrowserExtensionConnect,
  type BrowserExtensionConnectRequester,
} from "../browser-extension-offer.js";
import {
  handleExecCommand,
  handleWriteStdin,
  type ShellState,
} from "../shell.js";
import type { ToolDefinition } from "../types.js";
import {
  WRITE_STDIN_TOOL_DESCRIPTION,
  WRITE_STDIN_TOOL_NAME,
  WRITE_STDIN_TOOL_PARAMETERS,
  WRITE_STDIN_TOOL_PROMPT_SNIPPET,
  WRITE_STDIN_TOOL_REPLAY,
} from "./write-stdin-def.js";

export type WriteStdinToolOptions = {
  requestBrowserExtensionConnect?: BrowserExtensionConnectRequester;
};

export const createWriteStdinTool = (
  shellState: ShellState,
  options: WriteStdinToolOptions = {},
): ToolDefinition => ({
  name: WRITE_STDIN_TOOL_NAME,
  replay: WRITE_STDIN_TOOL_REPLAY,
  description: WRITE_STDIN_TOOL_DESCRIPTION,
  promptSnippet: WRITE_STDIN_TOOL_PROMPT_SNIPPET,
  parameters: WRITE_STDIN_TOOL_PARAMETERS,
  execute: async (args, context, extras) => {
    const result = await handleWriteStdin(
      shellState,
      args,
      context,
      extras?.signal,
    );
    if (!options.requestBrowserExtensionConnect) return result;
    const payload = result.details;
    const record =
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : null;
    const command = typeof record?.command === "string" ? record.command : "";
    if (!command) return result;
    return await maybeOfferBrowserExtensionConnect({
      result,
      command,
      requestConnect: options.requestBrowserExtensionConnect,
      rerun: () =>
        handleExecCommand(
          shellState,
          {
            cmd: command,
            ...(typeof record?.cwd === "string" ? { workdir: record.cwd } : {}),
          },
          context,
          extras?.signal,
          extras?.onUpdate,
        ),
      ...(context?.conversationId
        ? { conversationId: context.conversationId }
        : {}),
      ...(context?.agentId ? { agentId: context.agentId } : {}),
      signal: extras?.signal,
    });
  },
});
