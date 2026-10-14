import type { ShellState } from "../shell.js";
import type {
  ToolContext,
  ToolDefinition,
  ToolHostOptions,
  ToolResult,
  ToolUpdateCallback,
} from "../types.js";

import { applyPatchTool } from "./apply-patch.js";
import { editTool } from "./edit.js";
import { createExecCommandTool } from "./exec-command.js";
import { grepTool } from "./grep.js";
import { createHtmlTool } from "./html.js";
import { createDriveTool } from "./drive.js";
import { createDriveTransferTools } from "./drive-transfer.js";
import { createImageGenTool } from "./image-gen.js";
import { createMapTool } from "./map.js";
import { createMultiToolUseParallelTool } from "./multi-tool-use-parallel.js";
import { createCodeTool } from "./code.js";
import { readTool } from "./read.js";
import { createAskUserTool } from "./ask-user.js";
import {
  createRequestSecureInputTool,
  createUseSecureValueTool,
} from "./secure-input.js";
import { createScheduleManageTools } from "./schedule-manage.js";
import { createScriptDraftTool } from "./script-draft.js";
import { createConnectorStatusTool } from "./connector-status.js";
import { createWebTool } from "./web.js";
import { writeTool } from "./write.js";
import { createWriteStdinTool } from "./write-stdin.js";

import type { NodeReplKernelRegistry } from "../../computer-use/kernel.js";

export type BuildBuiltinToolsContext = ToolHostOptions & {
  stellaDataDir: string;
  shellState: ShellState;
  nodeReplRegistry: NodeReplKernelRegistry;
  executeTool: (
    toolName: string,
    args: Record<string, unknown>,
    context: ToolContext,
    signal?: AbortSignal,
    onUpdate?: ToolUpdateCallback,
  ) => Promise<ToolResult>;
};

export const buildBuiltinTools = (
  options: BuildBuiltinToolsContext,
): ToolDefinition[] => {
  const tools: ToolDefinition[] = [];

  tools.push(
    createExecCommandTool(options.shellState, {
      ...(options.requestBrowserExtensionConnect
        ? {
            requestBrowserExtensionConnect:
              options.requestBrowserExtensionConnect,
          }
        : {}),
    }),
  );
  tools.push(
    createWriteStdinTool(options.shellState, {
      ...(options.requestBrowserExtensionConnect
        ? {
            requestBrowserExtensionConnect:
              options.requestBrowserExtensionConnect,
          }
        : {}),
    }),
  );
  tools.push(applyPatchTool);
  tools.push(writeTool);
  tools.push(editTool);
  tools.push(
    createCodeTool({
      registry: options.nodeReplRegistry,
    }),
  );
  tools.push(
    createImageGenTool({
      getCloudBackendAuth: options.getCloudBackendAuth,
    }),
  );
  tools.push(
    createMultiToolUseParallelTool({
      executeTool: options.executeTool,
    }),
  );
  tools.push(createAskUserTool({ askUser: options.askUser }));
  tools.push(
    createRequestSecureInputTool({
      requestSecureInput: options.requestSecureInput,
      useSecureValue: options.useSecureValue,
    }),
  );
  tools.push(
    createUseSecureValueTool({
      requestSecureInput: options.requestSecureInput,
      useSecureValue: options.useSecureValue,
      ...(options.revealSecureValueForFill
        ? {
            revealSecureValueForFill: options.revealSecureValueForFill,
            fillSecureBrowserField: (context, target) =>
              options.nodeReplRegistry.fillSecureBrowserField(context, target),
          }
        : {}),
    }),
  );
  tools.push(createWebTool({ webSearch: options.webSearch }));

  tools.push(
    createHtmlTool({
      stellaDataDir: options.stellaDataDir,
      ...(options.getCloudBackendAuth
        ? { getCloudBackendAuth: options.getCloudBackendAuth }
        : {}),
    }),
  );
  tools.push(
    createMapTool({
      ...(options.getCloudBackendAuth
        ? { getCloudBackendAuth: options.getCloudBackendAuth }
        : {}),
    }),
  );

  tools.push(
    ...createScheduleManageTools({ scheduleApi: options.scheduleApi }),
  );
  tools.push(
    createScriptDraftTool({
      stellaDataDir: options.stellaDataDir,
      ...(options.getStellaSiteAuth
        ? { getStellaSiteAuth: options.getStellaSiteAuth }
        : {}),
      ...(options.getCloudBackendAuth
        ? { getCloudBackendAuth: options.getCloudBackendAuth }
        : {}),
    }),
  );

  tools.push(
    createConnectorStatusTool({
      stellaDataDir: options.stellaDataDir,
      ...(options.getCloudBackendAuth
        ? { getCloudBackendAuth: options.getCloudBackendAuth }
        : {}),
      ...(options.requestConnectorConnection
        ? { requestConnectorConnection: options.requestConnectorConnection }
        : {}),
    }),
  );

  tools.push(
    createDriveTool({
      ...(options.getCloudBackendAuth
        ? { getCloudBackendAuth: options.getCloudBackendAuth }
        : {}),
    }),
  );

  tools.push(
    ...createDriveTransferTools({
      ...(options.getCloudBackendAuth
        ? { getCloudBackendAuth: options.getCloudBackendAuth }
        : {}),
    }),
  );

  tools.push(readTool);
  tools.push(grepTool);

  return tools;
};
