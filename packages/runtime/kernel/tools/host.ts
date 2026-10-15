import { createHash } from "node:crypto";
import path from "node:path";
import { AGENT_IDS, getAgentDefinition } from "@stella/contracts/agent-runtime";

import type { Api, Model } from "@earendil-works/pi-ai";
import {
  APPLY_PATCH_TOOL_NAME,
  EDIT_TOOL_NAME,
  type FileEditAgentEngine,
  getFileEditToolFamily,
  WRITE_TOOL_NAME,
} from "./file-edit-policy.js";
import {
  TOOL_RESULT_AUTHORIZED_IMAGES,
  type ToolContext,
  type ToolHandler,
  type ToolHandlerExtras,
  type ToolMetadata,
  type ToolHostOptions,
  type ToolResult,
} from "./types.js";

import { log, logError, recoverStaleSecretFiles } from "./utils.js";
import {
  buildAgentShellEnvironment,
  createShellState,
  listRunningShellSessionsOwnedBy,
  readShellExitSnapshot,
  shutdownManagedShells,
  waitForShellExit,
  watchShellExit,
  type ShellSessionAccess,
  type ShellState,
} from "./shell.js";
import { registerExtensionToolHandlers } from "./registry.js";
import { buildBuiltinTools } from "./defs/index.js";
import { AGENT_CONTROL_TOOL_NAMES } from "./defs/agent-orchestration-def.js";
import type { ToolDefinition as BuiltinToolDefinition } from "./types.js";
import {
  sanitizeToolError,
  sanitizeToolResult,
  sanitizeToolVisibleText,
} from "./safety.js";
import { redactSecureValues, redactSecureValuesInText } from "../shared/secure-value-redaction.js";
import { describeToolCatalogEntry, searchToolCatalog } from "./code-catalog.js";
import {
  LEGACY_NODE_REPL_TOOL_NAME,
  toolRequiresExplicitApproval,
} from "./code-tool.js";
import {
  NODE_REPL_EXCLUDED_TOOL_NAMES,
  NodeReplKernelRegistry,
} from "../computer-use/kernel.js";
import {
  createMacComputerUseSession,
  releaseMacStellaComputerSession,
} from "../computer-use/stella-computer-executor.js";
import { createWindowsComputerUseSession } from "../computer-use/windows-session.js";
import { createComputerUseSession } from "../computer-use/session.js";
import { cleanupWindowsStellaComputerSessionDaemon } from "../cli/stella-computer-windows.js";
import { createReplConnectClient } from "../connectors/connect-service.js";
import { createDiskMemory } from "../memory/disk-memory.js";
import { runMemoryRequest } from "../memory/memory-client.js";
import { loadLocalPreferences } from "../preferences/local-preferences.js";

import type { ToolDefinition } from "../extensions/types.js";
import type { HookEmitter } from "../extensions/hook-emitter.js";
import { runToolCallPipeline } from "./tool-call-pipeline.js";
import { getToolArgumentPreparer } from "./argument-preparers.js";
import { historyReadView } from "@stella/contracts/history-search";

export type { ToolContext, ToolHandlerExtras, ToolResult };

export type ToolHost = ReturnType<typeof createToolHost>;

const MAX_INLINE_TOOL_DESCRIPTION_CHARS = 256_000;
const TOOL_DESCRIPTION_CHUNK_CHARS = 192_000;

export const createBrowserOnlyComputerUseSession = () =>
  createComputerUseSession(async () => {
    throw new Error(
      "Typed Computer Use is not available in browser-only cloud execution.",
    );
  });

const copyCallableMetadata = (
  tool: BuiltinToolDefinition | ToolDefinition,
): ToolMetadata => ({
  name: tool.name,
  ...(tool.label ? { label: tool.label } : {}),
  ...(tool.workingText ? { workingText: tool.workingText } : {}),
  description: tool.description,
  parameters: tool.parameters,
  ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
  ...(tool.resultSchema ? { resultSchema: tool.resultSchema } : {}),
  ...(tool.approval !== undefined ? { approval: tool.approval } : {}),
  ...(tool.sideEffects !== undefined ? { sideEffects: tool.sideEffects } : {}),
  ...("replay" in tool && tool.replay ? { replay: tool.replay } : {}),
  ...(tool.reversible !== undefined ? { reversible: tool.reversible } : {}),
  ...(tool.annotations ? { annotations: tool.annotations } : {}),
  ...(tool.demoted ? { demoted: tool.demoted } : {}),
  ...(tool.agentTypes ? { agentTypes: tool.agentTypes } : {}),
  ...("awaitsUser" in tool && tool.awaitsUser ? { awaitsUser: true } : {}),
});

const isReservedToolName = (name: string): boolean =>
  name.startsWith("$") || name === LEGACY_NODE_REPL_TOOL_NAME;

const reservedToolNameReason = (name: string): string =>
  name === LEGACY_NODE_REPL_TOOL_NAME
    ? '"node_repl" is reserved for legacy transcript compatibility; extensions must not advertise it because the public tool is "code".'
    : '"$" names belong to code-runtime intrinsics like tools.$search and tools.$describe.';

const isAgentAllowedForTool = (
  tool: { agentTypes?: readonly string[] },
  agentType: string | undefined,
): boolean => {
  if (!tool.agentTypes || tool.agentTypes.length === 0) return true;
  if (!agentType) return false;
  return tool.agentTypes.includes(agentType);
};

const isAgentControlToolWithheld = (
  toolName: string,
  parentOwned: boolean | undefined,
): boolean =>
  parentOwned === true && AGENT_CONTROL_TOOL_NAMES.includes(toolName);

export const collectReplSearchableTools = (
  tools: Iterable<ToolMetadata>,
  context: ToolContext,
): ToolMetadata[] => {
  const allowedNames = new Set(context.allowedToolNames ?? []);
  const connectorProvider = context.connectorDeliveryTarget?.provider;
  const reachable: ToolMetadata[] = [];
  for (const tool of tools) {
    if (NODE_REPL_EXCLUDED_TOOL_NAMES.has(tool.name)) continue;
    if (!allowedNames.has(tool.name)) continue;
    if (toolRequiresExplicitApproval(tool.approval)) continue;
    if (!isAgentAllowedForTool(tool, context.agentType)) continue;
    if (
      isAgentControlToolWithheld(tool.name, Boolean(context.parentAgentId))
    ) {
      continue;
    }
    const requiredProvider = tool.demoted?.requiredConnectorProvider;
    if (requiredProvider && requiredProvider !== connectorProvider) {
      continue;
    }
    reachable.push(tool);
  }
  return reachable;
};

export const createToolHost = ({
  stellaAppDir,
  recoverStaleSecrets = true,
  enableShellShims = true,
  allowCloudCode = false,
  browserSessionFactory,
  stellaDataDir,
  stellaBrowserBinPath: _stellaBrowserBinPath,
  stellaOfficeBinPath: _stellaOfficeBinPath,
  stellaComputerCliPath,
  stellaMediaCliPath,
  stellaXApiCliPath,
  cliBridgeSocketPath,
  askUser,
  requestSecureInput,
  useSecureValue,
  revealSecureValueForFill,
  requestBrowserExtensionConnect,
  requestConnectorConnection,
  scheduleApi,
  extensionTools,
  webSearch,
  getStellaSiteAuth,
  getCloudBackendAuth,
  codeConnectClient,
  cloudBrowser,
  codeHistoryQuery,
  agentHistoryQuery,
  deviceId,
}: ToolHostOptions) => {
  const stateRoot = stellaDataDir ?? stellaAppDir;
  const toolCatalog = new Map<string, ToolMetadata>();

  const shellState: ShellState = createShellState(stateRoot, {
    enableShellShims,
    stellaBrowserBinPath: _stellaBrowserBinPath,
    stellaOfficeBinPath: _stellaOfficeBinPath,
    stellaComputerCliPath,
    stellaMediaCliPath,
    stellaXApiCliPath,
    getStellaSiteAuth,
    getCloudBackendAuth,
    cliBridgeSocketPath,
  });
  let executeTool: (
    toolName: string,
    toolArgs: Record<string, unknown>,
    context: ToolContext,
    signal?: AbortSignal,
    onUpdate?: ToolHandlerExtras["onUpdate"],
  ) => Promise<ToolResult>;
  let toolCallHooks: Pick<HookEmitter, "emit"> | undefined;
  const executeToolCall = (
    toolName: string,
    toolArgs: Record<string, unknown>,
    context: ToolContext,
    signal?: AbortSignal,
    onUpdate?: ToolHandlerExtras["onUpdate"],
  ): Promise<ToolResult> => {
    const parameters = toolCatalog.get(toolName)?.parameters;
    const prepareArguments = getToolArgumentPreparer(toolName);
    return runToolCallPipeline({
      toolName,
      args: toolArgs,
      context,
      ...(toolCallHooks ? { hookEmitter: toolCallHooks } : {}),
      ...(parameters && typeof parameters === "object"
        ? { parameters: parameters as Record<string, unknown> }
        : {}),
      ...(prepareArguments ? { prepareArguments } : {}),
      execute: (effectiveArgs) =>
        executeTool(toolName, effectiveArgs, context, signal, onUpdate),
    });
  };
  const executeNestedToolCall = (
    toolName: string,
    toolArgs: Record<string, unknown>,
    context: ToolContext,
    signal?: AbortSignal,
    onUpdate?: ToolHandlerExtras["onUpdate"],
  ): Promise<ToolResult> => {
    const metadata = toolCatalog.get(toolName);
    if (toolRequiresExplicitApproval(metadata?.approval)) {
      return Promise.resolve({
        error: `${toolName} requires explicit approval and cannot be invoked from code or multi_tool_use_parallel. Call it directly so the approval flow can run.`,
      });
    }
    return executeToolCall(toolName, toolArgs, context, signal, onUpdate);
  };
  const queryCodeHistory =
    codeHistoryQuery ??
    (async (args: Record<string, unknown>, context: ToolContext): Promise<unknown> => {
      if (context.agentType && context.agentType !== AGENT_IDS.ORCHESTRATOR) {
        if (!agentHistoryQuery) throw new Error("Your history is unavailable in this session.");
        return await agentHistoryQuery(args, context);
      }
      const auth = getCloudBackendAuth?.();
      if (!auth) {
        throw new Error("history is unavailable in this session.");
      }
      const response = await fetch(
        `${auth.baseUrl.replace(/\/+$/, "")}/conversations/${encodeURIComponent(
          context.conversationId,
        )}/history/query`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${auth.authToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(args),
          signal: AbortSignal.timeout(30_000),
        },
      );
      const body = (await response.json().catch(() => null)) as unknown;
      if (!response.ok) {
        const message =
          body && typeof body === "object" && "error" in body
            ? String((body as { error: unknown }).error)
            : `history request failed (${response.status}).`;
        throw new Error(message);
      }
      return body;
    });
  const connectClient =
    codeConnectClient ??
    createReplConnectClient({
      stellaAppDir: stateRoot,
      ...(cliBridgeSocketPath ? { cliBridgeSocketPath } : {}),
      ...(deviceId ? { deviceId } : {}),
      reservedToolNames: () => new Set(toolCatalog.keys()),
      onBridgeUnreachable: (message) =>
        logError("code connect bridge unreachable", message),
    });
  const listConnectorTools = () =>
    connectClient.tools().catch((error: unknown) => {
      logError("connector tools unavailable", error);
      return [];
    });
  const nodeReplRegistry = new NodeReplKernelRegistry({
    browserBinPath: _stellaBrowserBinPath,
    ...(requestBrowserExtensionConnect
      ? { requestBrowserExtensionConnect }
      : {}),
    sessionFactory: ({ sessionId, getSignal, timeoutMs }) => {
      if (process.platform === "win32") {
        return createWindowsComputerUseSession();
      }
      if (process.platform === "darwin") {
        return createMacComputerUseSession({
          sessionId,
          getSignal,
          commandTimeoutMs: timeoutMs,
          ...(cliBridgeSocketPath ? { cliBridgeSocketPath } : {}),
        });
      }
      if (browserSessionFactory) {
        return createBrowserOnlyComputerUseSession();
      }
      return createComputerUseSession(async () => {
        throw new Error(
          `Typed Computer Use is not available on ${process.platform}.`,
        );
      });
    },
    ...(browserSessionFactory ? { browserSessionFactory } : {}),
    disposeSession: async (sessionId) => {
      if (process.platform === "win32") {
        await cleanupWindowsStellaComputerSessionDaemon(sessionId);
      } else if (process.platform === "darwin") {
        await releaseMacStellaComputerSession(sessionId);
      }
    },
    executeTool: executeNestedToolCall,
    toolAwaitsUser: (toolName) => toolCatalog.get(toolName)?.awaitsUser === true,
    searchTools: async (query, context, limit) =>
      searchToolCatalog(
        [
          ...collectReplSearchableTools(toolCatalog.values(), context),
          ...(await listConnectorTools()),
        ],
        query,
        limit,
      ),
    ...(stellaDataDir
      ? {
          memory: (() => {
            const memory = createDiskMemory(
              stellaDataDir,
              () => loadLocalPreferences(stellaDataDir).memoryEnabled,
            );
            return {
              available: (context: ToolContext) =>
                context.agentType === AGENT_IDS.ORCHESTRATOR,
              call: (args: Record<string, unknown>) =>
                runMemoryRequest(memory, args),
            };
          })(),
        }
      : {}),
    queryHistory: async (args, context) => {
      const result = await queryCodeHistory(args, context);
      return args.op === "read" && args.raw !== true
        ? historyReadView(result)
        : result;
    },
    describeTool: async (name, context, cursor) => {
      const tool =
        collectReplSearchableTools(toolCatalog.values(), context).find(
          (entry) => entry.name === name,
        ) ?? (await listConnectorTools()).find((entry) => entry.name === name);
      if (!tool) {
        throw new Error(
          `Tool "${name}" is unknown or not available to describe in this context.`,
        );
      }

      const description = describeToolCatalogEntry(tool);
      const serialized = JSON.stringify(description);
      if (serialized.length <= MAX_INLINE_TOOL_DESCRIPTION_CHARS) {
        if (cursor !== undefined && cursor !== 0) {
          throw new Error(
            `Tool "${name}" does not have another description page.`,
          );
        }
        return description;
      }

      const start = cursor ?? 0;
      if (start >= serialized.length) {
        throw new Error(
          `Tool "${name}" description cursor is past the end of the document.`,
        );
      }
      let end = Math.min(
        serialized.length,
        start + TOOL_DESCRIPTION_CHUNK_CHARS,
      );
      if (
        end < serialized.length &&
        /[\uD800-\uDBFF]/.test(serialized.charAt(end - 1))
      ) {
        end -= 1;
      }
      const nextCursor = end < serialized.length ? end : undefined;
      return {
        name,
        complete: nextCursor === undefined,
        format: "lossless-json-chunks",
        totalChars: serialized.length,
        totalBytes: Buffer.byteLength(serialized, "utf8"),
        sha256: createHash("sha256").update(serialized).digest("hex"),
        cursor: start,
        chunk: serialized.slice(start, end),
        ...(nextCursor !== undefined ? { nextCursor } : {}),
        instruction:
          "Concatenate chunk values in cursor order, requesting each nextCursor with await tools.$describe(name, { cursor: nextCursor }), then JSON.parse the exact combined string. No schema fields were clipped.",
      };
    },
    connectClient,
    ...(cloudBrowser ? { cloudBrowser } : {}),
  });

  if (recoverStaleSecrets) {
    void recoverStaleSecretFiles(stateRoot)
      .then((result) => {
        if (result.recovered > 0 || result.skipped > 0) {
          log("Recovered stale secret mounts", result);
        }
      })
      .catch((error) => {
        logError("Failed to recover stale secret mounts", error);
      });
  }

  const handlers: Record<string, ToolHandler> = {};

  const builtinTools: BuiltinToolDefinition[] = buildBuiltinTools({
    stellaAppDir,
    stellaDataDir: stateRoot,
    stellaBrowserBinPath: _stellaBrowserBinPath,
    stellaOfficeBinPath: _stellaOfficeBinPath,
    stellaComputerCliPath,
    stellaMediaCliPath,
    stellaXApiCliPath,
    askUser,
    requestSecureInput,
    useSecureValue,
    ...(revealSecureValueForFill ? { revealSecureValueForFill } : {}),
    ...(requestBrowserExtensionConnect
      ? { requestBrowserExtensionConnect }
      : {}),
    ...(requestConnectorConnection ? { requestConnectorConnection } : {}),
    scheduleApi,
    extensionTools,
    webSearch,
    getStellaSiteAuth,
    getCloudBackendAuth,
    shellState,
    nodeReplRegistry,
    executeTool: executeNestedToolCall,
  });
  const builtinToolNames = new Set<string>();
  for (const tool of builtinTools) {
    if (isReservedToolName(tool.name)) {
      throw new Error(
        `Built-in tool "${tool.name}" uses a reserved name; ${reservedToolNameReason(tool.name)}`,
      );
    }
    toolCatalog.set(tool.name, copyCallableMetadata(tool));
    handlers[tool.name] = (args, context, extras) =>
      tool.execute(args, context, extras);
    builtinToolNames.add(tool.name);
  }

  const acceptedStartupExtensionTools = (extensionTools ?? []).filter(
    (tool) => {
      if (isReservedToolName(tool.name)) {
        logError(
          `Extension tool "${tool.name}" uses a reserved name; skipping registration. ${reservedToolNameReason(tool.name)}`,
        );
        return false;
      }
      if (builtinToolNames.has(tool.name)) {
        logError(
          `Extension tool "${tool.name}" collides with a built-in tool name; skipping registration. Rename the extension tool to avoid the collision.`,
        );
        return false;
      }
      return true;
    },
  );
  registerExtensionToolHandlers(handlers, acceptedStartupExtensionTools);
  for (const tool of acceptedStartupExtensionTools) {
    toolCatalog.set(tool.name, copyCallableMetadata(tool));
  }

  executeTool = async (
    toolName: string,
    toolArgs: Record<string, unknown>,
    context: ToolContext,
    signal?: AbortSignal,
    onUpdate?: ToolHandlerExtras["onUpdate"],
  ) => {
    const extras: ToolHandlerExtras = {
      ...(signal ? { signal } : {}),
      ...(onUpdate ? { onUpdate } : {}),
    };
    log(`Executing tool: ${toolName}`, {
      args: toolArgs,
      context,
    });

    if (context.executionHost === "sandbox") {
      const workspaceRoot = context.toolWorkspaceRoot?.trim();
      if (!workspaceRoot || !path.isAbsolute(workspaceRoot)) {
        throw new Error(
          "Sandbox tool execution requires an absolute workspace boundary.",
        );
      }
    }

    if (
      context.executionHost === "sandbox" &&
      (toolName === "code" || toolName === LEGACY_NODE_REPL_TOOL_NAME) &&
      !allowCloudCode
    ) {
      return {
        error: `${toolName} is not available in sandbox execution.`,
      } satisfies ToolResult;
    }

    if (isAgentControlToolWithheld(toolName, Boolean(context.parentAgentId))) {
      return {
        error: `${toolName} is not available to a subagent. Complete the work in this task and report the result to the agent that started you.`,
      };
    }

    const catalogEntry = toolCatalog.get(toolName);
    if (
      catalogEntry &&
      !isAgentAllowedForTool(catalogEntry, context.agentType)
    ) {
      const allowed = catalogEntry.agentTypes ?? [];
      const formatAllowedAgent = (id: string): string => {
        if (id === AGENT_IDS.ORCHESTRATOR) return "the orchestrator";
        const def = getAgentDefinition(id);
        return def?.name ? `the ${def.name} agent` : `the ${id} agent`;
      };
      const formatted =
        allowed.length === 1
          ? formatAllowedAgent(allowed[0]!)
          : allowed.map(formatAllowedAgent).join(", ");
      return {
        error: `${toolName} is only available to ${formatted}.`,
      } satisfies ToolResult;
    }

    const handler = handlers[toolName];
    if (!handler) {
      const available = Object.keys(handlers);
      logError(`Unknown tool: ${toolName}. Available tools:`, available);
      return { error: `Unknown tool: ${toolName}` } satisfies ToolResult;
    }

    const startedAt = Date.now();
    try {
      const rawResult = await handler(toolArgs, context, extras);
      const authorizedImages = rawResult[TOOL_RESULT_AUTHORIZED_IMAGES];
      const result = await redactSecureValues(sanitizeToolResult(rawResult));
      if (authorizedImages) {
        Object.defineProperty(result, TOOL_RESULT_AUTHORIZED_IMAGES, {
          configurable: false,
          enumerable: false,
          value: authorizedImages,
          writable: false,
        });
      }
      const duration = Date.now() - startedAt;
      log(`Tool ${toolName} completed in ${duration}ms`, {
        hasResult: "result" in result,
        hasError: "error" in result,
        resultPreview: result.error
          ? result.error.slice(0, 500)
          : typeof result.result === "string"
            ? result.result.slice(0, 500)
            : "(non-string result)",
      });
      return result;
    } catch (error) {
      const duration = Date.now() - startedAt;
      const message = await redactSecureValuesInText(
        sanitizeToolError(`Tool ${toolName} failed: ${(error as Error).message}`),
      );
      const stack = await redactSecureValuesInText(
        sanitizeToolVisibleText(String((error as Error)?.stack ?? "")),
      );
      logError(`Tool ${toolName} threw after ${duration}ms: ${message}`, stack);
      return { error: message };
    }
  };

  const killAllShells = () => shutdownManagedShells(shellState);

  const killShell = async (sessionId: string) => {
    const shell = shellState.shells.get(sessionId);
    if (!shell) return;
    if (shell.running) {
      shell.kill();
    }
    await waitForShellExit(shell, 1_500);
  };

  let shutdownPromise: Promise<void> | null = null;
  const shutdown = () => {
    if (shutdownPromise) return shutdownPromise;
    shutdownPromise = (async () => {
      await shutdownManagedShells(shellState);
      await nodeReplRegistry.dispose();
    })();
    return shutdownPromise;
  };

  const getToolCatalog = (
    agentType?: string,
    options?: {
      model?: Pick<Model<Api>, "api" | "provider" | "id" | "name">;
      agentEngine?: FileEditAgentEngine;
      parentOwned?: boolean;
    },
  ) => {
    const fileEditToolFamily = getFileEditToolFamily({
      agentType,
      model: options?.model,
      agentEngine: options?.agentEngine,
    });
    return Array.from(toolCatalog.values()).filter((tool) => {
      if (!isAgentAllowedForTool(tool, agentType)) return false;
      if (isAgentControlToolWithheld(tool.name, options?.parentOwned)) {
        return false;
      }
      if (
        fileEditToolFamily === "write_edit" &&
        tool.name === APPLY_PATCH_TOOL_NAME
      ) {
        return false;
      }
      if (
        fileEditToolFamily === "apply_patch" &&
        (tool.name === WRITE_TOOL_NAME || tool.name === EDIT_TOOL_NAME)
      ) {
        return false;
      }
      return true;
    });
  };

  const extensionToolNames = new Set<string>();

  return {
    executeTool,
    executeToolCall,
    setToolCallHooks: (hooks: Pick<HookEmitter, "emit"> | undefined) => {
      toolCallHooks = hooks;
    },
    getToolCatalog,
    getHandlerNames: () => Object.keys(handlers),
    getShells: () => Array.from(shellState.shells.values()),
    buildAgentShellEnvironment: (context: ToolContext, cwd: string) =>
      buildAgentShellEnvironment(shellState, context, cwd),
    listRunningShellSessionIds: (sessionIds?: string[]) => {
      const scope = sessionIds ? new Set(sessionIds) : null;
      const running: string[] = [];
      for (const shell of shellState.shells.values()) {
        if (!shell.running) continue;
        if (scope && !scope.has(shell.id)) continue;
        running.push(shell.id);
      }
      return running;
    },
    listRunningShellSessionsOwnedBy: (access: ShellSessionAccess) =>
      listRunningShellSessionsOwnedBy(shellState, access),
    watchShellExit: (sessionId: string, listener: () => void) =>
      watchShellExit(shellState, sessionId, listener),
    readShellExitSnapshot: (sessionId: string) =>
      readShellExitSnapshot(shellState, sessionId),
    endBrowserTurn: (
      runId: string,
      behavior: import("../browser-use/client.js").BrowserTurnEndBehavior,
    ) => nodeReplRegistry.endBrowserTurn(runId, behavior),
    releaseAgentComputerSessions: (agentId: string) =>
      nodeReplRegistry.releaseAgentNativeSessions(agentId),
    killAllShells,
    killShell,
    shutdown,
    registerExtensionTools: (tools: ToolDefinition[]) => {
      const accepted: ToolDefinition[] = [];
      for (const tool of tools) {
        if (isReservedToolName(tool.name)) {
          logError(
            `Extension tool "${tool.name}" uses a reserved name; skipping registration. ${reservedToolNameReason(tool.name)}`,
          );
          continue;
        }
        if (builtinToolNames.has(tool.name)) {
          logError(
            `Extension tool "${tool.name}" collides with a built-in tool name; skipping registration. Rename the extension tool to avoid the collision.`,
          );
          continue;
        }
        accepted.push(tool);
      }
      registerExtensionToolHandlers(handlers, accepted);
      for (const tool of accepted) {
        toolCatalog.set(tool.name, copyCallableMetadata(tool));
        extensionToolNames.add(tool.name);
      }
    },
    unregisterExtensionTools: () => {
      for (const name of extensionToolNames) {
        toolCatalog.delete(name);
        delete handlers[name];
      }
      extensionToolNames.clear();
    },
  };
};
