import type { CloudTurnAttemptPaths } from "@stella/contracts/cloud-turn-attempt";
import { constants as fsConstants, existsSync } from "node:fs";
import {
  chown,
  readFile,
  mkdir,
  open,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import type { AgentMessage } from "@stella/runtime/kernel/agent-core/types.js";
import {
  extractDriveLinkPaths,
  extractLocalFileLinkPaths,
} from "@stella/contracts/local-file-links";
import type { CloudExecutionSelection } from "@stella/contracts/agent-engine";
import {
  parseCloudAgentSystemPrompt,
  type CloudCliTurnRoleInput,
} from "@stella/contracts/cloud-orchestrator-cli";
import { createToolHost } from "@stella/runtime/kernel/tools/host.js";
import type { ToolContext } from "@stella/runtime/kernel/tools/host.js";
import {
  createClaudeCodeToolMcpHost,
  type ClaudeCodeToolMcpHost,
} from "@stella/runtime/kernel/integrations/claude-code-tool-mcp-host.js";
import { buildClaudeCodeNativeToolRuntimePrompt } from "@stella/runtime/kernel/integrations/claude-code-session-runtime.js";
import {
  type ToolMetadata,
  type ToolResult,
  type ToolUpdateCallback,
} from "@stella/runtime/kernel/tools/types.js";
import { openAgentInbox } from "./agent-inbox.js";
import { createCloudUserAskHost } from "./cloud-user-ask.js";
import {
  materializeDriveFiles,
  type DriveSyncResult,
} from "./drive-sync.js";
import { toDriveFile, type ProducedFileReport } from "./produced-files.js";
import { snapshotDriveTree, writeBackDrive } from "./drive-writeback.js";
import {
  buildGeneralAgentPrompt,
  type GeneralAgentPromptSkills,
} from "./general-agent-prompt.js";
import { cloudGeneralToolNames } from "./cloud-general-tools.js";
import { createBrokerConnectClient } from "./cloud-code-services.js";
import { createBrokerCloudBrowser } from "./cloud-browser-client.js";
import { CODE_TOOL_CLOUD_AGENT_DESCRIPTION } from "@stella/runtime/kernel/tools/defs/code-def.js";
import { CLOUD_AGENT_MOVE_TOOL, cloudAgentMoveTool, runCloudAgentMove } from "./cloud-agent-move.js";
import {
  toolStateDir,
  worldDriveWorkspace,
  WORLD_ROOT,
} from "./workspace-paths.js";
import {
  pullWorldProjection,
  pushWorldProjection,
  type WorldSyncAccess,
} from "./world-sync.js";
import {
  cloudAgentProgressFromStream,
  cloudClaudeRoleProfile,
  nativeHistoryCursorFromMessages,
  nativeHistoryCursorFromRows,
  parseCloudClaudeAccountInput,
  runNativeAgentTurn,
  type CloudClaudeAccountInput,
} from "./native-agent-turn.js";
import { runOrchestratorTurn } from "./orchestrator-turn.js";
import {
  parseAuthoritativeAgentHistory,
  type AgentHistoryRow,
} from "./agent-history.js";
import {
  type TurnBrokerInput,
  type TurnBrokerTurnStateCheckpointReceipt,
} from "@stella/contracts/turn-credential-broker";
import {
  takeTurnBrokerHandoff,
  TurnCredentialBrokerClient,
} from "./turn-credential-broker.js";
import {
  assertCloudMountedDirectoryBoundary,
  assertToolOwnedDirectory,
  CLOUD_HOST_STATE,
  CLOUD_TOOL_PROCESS_IDENTITY,
  proveStrictCloudProcessIsolation,
} from "./cloud-process-isolation.js";
import { CLOUD_TOOL_HOME } from "@stella/contracts/cloud-tool-home";
import { cloudAgentToolContext } from "./cloud-tool-context.js";

import { markTurnStep } from "./turn-timing.js";
import { openClaudeKeeper } from "./claude-keeper-client.js";

export type AgentTurnInput = CloudCliTurnRoleInput & {
  kind: "agent";
  ownerId: string;
  ownerGeneration: string;
  conversationId: string;
  threadId: string;
  turnId: string;
  attemptGeneration: number;
  prompt: string;
  workspaceRestored: boolean;
  nativeStateIntegrityKey: string;
  nativeStatePreviousIntegrityKeys?: string[];
  rebuildNativeSession?: boolean;
  adoptedNativeSession?: { sessionId: string; cliVersion: string; hydrated?: true };
  turnBroker: TurnBrokerInput;
  world: WorldSyncAccess;
  claudeAccount?: CloudClaudeAccountInput;
  history?: AgentHistoryRow[];
  execution: CloudExecutionSelection;
  skills?: GeneralAgentPromptSkills;
};

export type AgentTurnTerminalResult = {
  outcome?: "completed";
  ok: boolean;
  finalText: string;
  error?: string;
  checkpointPolicy?: "preserve_prior" | "builder_fallback";
  usage: { inputTokens: number; outputTokens: number; llmCalls: number };
  checkpointMs?: number;
  turnStateCheckpoint?: TurnBrokerTurnStateCheckpointReceipt;
  builderFallback?: {
    historyCursor: string;
    messages: Array<{ ordinal: number; role: string; payloadJson: string }>;
    nativeCheckpoint?: Awaited<
      ReturnType<typeof runNativeAgentTurn>
    >["nativeStateCheckpoint"];
  };
};

export type AgentTurnResult = AgentTurnTerminalResult;

export { cloudGeneralToolNames };

export const createBuilderFallbackAgentTurnResult = (args: {
  finalText: string;
  notice?: string;
  error?: string;
  usage: AgentTurnTerminalResult["usage"];
  historyCursor: string;
  messages: NonNullable<AgentTurnTerminalResult["builderFallback"]>["messages"];
  nativeCheckpoint?: NonNullable<
    AgentTurnTerminalResult["builderFallback"]
  >["nativeCheckpoint"];
}): AgentTurnTerminalResult => ({
  ok: !args.error,
  finalText:
    `${args.finalText || (args.error ? "" : "The agent finished without a report.")}${args.notice ?? ""}`.trim(),
  ...(args.error ? { error: args.error } : {}),
  checkpointPolicy: "builder_fallback",
  usage: args.usage,
  builderFallback: {
    historyCursor: args.historyCursor,
    messages: args.messages,
    ...(args.nativeCheckpoint
      ? { nativeCheckpoint: args.nativeCheckpoint }
      : {}),
  },
});

export const prepareCloudToolFilesystem = async (args: {
  workspaceRoot: string;
  workspaceStateDir?: string;
  driveStateDir?: string;
  toolHome: string;
}): Promise<void> => {
  await assertCloudMountedDirectoryBoundary({
    workspaceRoot: args.workspaceRoot,
  });
  const ensureToolDirectory = async (target: string): Promise<void> => {
    let created = false;
    try {
      await mkdir(target, { mode: 0o700 });
      created = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    const handle = await open(
      target,
      fsConstants.O_RDONLY |
        (fsConstants.O_DIRECTORY ?? 0) |
        (fsConstants.O_NOFOLLOW ?? 0),
    );
    try {
      const details = await handle.stat();
      if (!details.isDirectory()) {
        throw new Error("Cloud tool state must be a real directory.");
      }
      if (created) {
        await handle.chown(
          CLOUD_TOOL_PROCESS_IDENTITY.uid,
          CLOUD_TOOL_PROCESS_IDENTITY.gid,
        );
        await handle.chmod(0o700);
      } else if (
        details.uid === CLOUD_TOOL_PROCESS_IDENTITY.uid &&
        details.gid === CLOUD_TOOL_PROCESS_IDENTITY.gid
      ) {
        await handle.chmod(0o700);
      }
    } finally {
      await handle.close();
    }
    await assertToolOwnedDirectory(target, 0o700);
  };
  if (args.driveStateDir) {
    const driveRoot = path.dirname(args.driveStateDir);
    try {
      await mkdir(driveRoot, { mode: 0o750 });
      await chown(
        driveRoot,
        CLOUD_TOOL_PROCESS_IDENTITY.uid,
        CLOUD_TOOL_PROCESS_IDENTITY.gid,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  await ensureToolDirectory(args.toolHome);
  for (const target of new Set(
    [args.workspaceStateDir, args.driveStateDir].filter(
      (candidate): candidate is string =>
        typeof candidate === "string" && candidate !== args.toolHome,
    ),
  )) {
    await ensureToolDirectory(target);
  }
  await proveStrictCloudProcessIsolation();
};

export const commitTurnStateBeforeTranscript = async (args: {
  historyCursor: string;
  nativeCheckpoint?: Awaited<
    ReturnType<typeof runNativeAgentTurn>
  >["nativeStateCheckpoint"];
  broker: Pick<TurnCredentialBrokerClient, "commitTurnStateCheckpoint">;
  appendTranscript: () => Promise<void>;
}): Promise<TurnBrokerTurnStateCheckpointReceipt> => {
  const receipt = await args.broker.commitTurnStateCheckpoint({
    historyCursor: args.historyCursor,
    ...(args.nativeCheckpoint
      ? { nativeCheckpoint: args.nativeCheckpoint }
      : {}),
  });
  await args.appendTranscript();
  return receipt;
};

export const resolveOfficeBinPath = (): string | undefined => {
  const candidate =
    process.env.STELLA_OFFICE_BIN?.trim() ||
    fileURLToPath(
      new URL("../../stella-office/bin/stella-office.js", import.meta.url),
    );
  return existsSync(candidate) ? candidate : undefined;
};

export const CLOUD_GENERAL_PROMPT = (options: {
  body: string;
  threadId?: string;
  drive?: DriveSyncResult;
  skills?: GeneralAgentPromptSkills;
}): string =>
  buildGeneralAgentPrompt(options.body, {
    workspace: "materialized",
    ...(options.threadId ? { threadId: options.threadId } : {}),
    ...(options.drive ? { drive: options.drive } : {}),
    ...(options.skills ? { skills: options.skills } : {}),
  });

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

export const hydrateDriveForAgentTurn = async (
  options: Parameters<typeof materializeDriveFiles>[0],
  materialize: typeof materializeDriveFiles = materializeDriveFiles,
): Promise<DriveSyncResult> => {
  try {
    return await materialize(options);
  } catch (error) {
    throw new Error(
      `Drive hydration could not establish an authoritative workspace; refusing to run the agent against stale or incomplete files: ${asError(error).message}`,
      { cause: error },
    );
  }
};

export const runAgentTurn = (
  attempt: CloudTurnAttemptPaths,
): Effect.Effect<AgentTurnResult, Error> =>
  Effect.scoped(
    Effect.gen(function* () {
      const input = yield* Effect.tryPromise({
        try: async () => {
          const raw = await readFile(attempt.input, "utf8");
          await rm(attempt.input, { force: true });
          markTurnStep("inputRead");
          return JSON.parse(raw) as AgentTurnInput;
        },
        catch: asError,
      });
      const broker = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: async () =>
            new TurnCredentialBrokerClient(
              await takeTurnBrokerHandoff(input.turnBroker),
            ),
          catch: asError,
        }),
        (client) => Effect.sync(() => client.close()),
      );
      markTurnStep("brokerReady");
      if (input.role === "orchestrator") {
        return yield* Effect.promise(() =>
          runOrchestratorTurn({ input, broker }),
        );
      }
      const promptBody = parseCloudAgentSystemPrompt(input.systemPrompt);
      if (!promptBody) {
        return {
          ok: false,
          finalText: "",
          error:
            "Stella lost this agent's instructions before it could run. Try again.",
          usage: { inputTokens: 0, outputTokens: 0, llmCalls: 0 },
          checkpointPolicy: "preserve_prior",
        };
      }
      if (input.execution.engine !== "anthropic") {
        return {
          ok: false,
          finalText: "",
          error:
            "This agent runs in its conversation, not in a container. Try again.",
          usage: { inputTokens: 0, outputTokens: 0, llmCalls: 0 },
          checkpointPolicy: "preserve_prior",
        };
      }
      const nativeExecution = input.execution;
      const claudeAccount = parseCloudClaudeAccountInput(input.claudeAccount);
      if (!claudeAccount) {
        return {
          ok: false,
          finalText: "",
          error:
            "Stella couldn't validate this agent's managed model access. Try again.",
          usage: { inputTokens: 0, outputTokens: 0, llmCalls: 0 },
          checkpointPolicy: "preserve_prior",
        };
      }
      try {
        parseAuthoritativeAgentHistory(input.history ?? []);
      } catch (error) {
        console.error(
          `authoritative agent history rejected: ${asError(error).message}`,
        );
        return {
          ok: false,
          finalText: "",
          error:
            "Stella couldn't validate this agent's conversation history. Try again.",
          usage: { inputTokens: 0, outputTokens: 0, llmCalls: 0 },
          checkpointPolicy: "preserve_prior",
        };
      }
      if (!/^[0-9a-f]{64}$/.test(input.nativeStateIntegrityKey)) {
        return {
          ok: false,
          finalText: "",
          error:
            "Stella couldn't validate this agent's native session state. Try again.",
          usage: { inputTokens: 0, outputTokens: 0, llmCalls: 0 },
          checkpointPolicy: "preserve_prior",
        };
      }
      const claudeKeeper = yield* Effect.acquireRelease(
        Effect.sync(() => {
          const opening = openClaudeKeeper(input.threadId);
          opening.catch(() => undefined);
          return opening;
        }),
        (opening) =>
          Effect.promise(async () => {
            (await opening)?.close();
          }),
      );
      const workspaceRoot = WORLD_ROOT;
      const workspaceStateDir = toolStateDir(workspaceRoot);
      const driveWorkspace = worldDriveWorkspace(workspaceRoot);
      const toolHome = CLOUD_TOOL_HOME;
      yield* Effect.tryPromise({
        try: () =>
          pullWorldProjection({ root: workspaceRoot, access: input.world }),
        catch: asError,
      });
      markTurnStep("worldPulled");
      yield* Effect.tryPromise({
        try: () =>
          prepareCloudToolFilesystem({
            workspaceRoot,
            workspaceStateDir,
            driveStateDir: driveWorkspace.stateDir,
            toolHome,
          }),
        catch: asError,
      });
      markTurnStep("toolFilesystemPrepared");
      const postJson = async (
        route: string,
        body: unknown,
      ): Promise<Response> => await broker.postJson(route, body);

      const userAsks = yield* Effect.acquireRelease(
        Effect.sync(() =>
          createCloudUserAskHost({
            post: postJson,
            turnId: input.turnId,
            conversationId: input.conversationId,
          }),
        ),
        (host) =>
          Effect.promise(async () => {
            await host.cancelOpenAsks(
              "This agent stopped before you answered, so the question was withdrawn.",
            );
          }),
      );

      let eventChain: Promise<unknown> = Promise.resolve();
      const emitEvent = (kind: string, payload: unknown): void => {
        eventChain = eventChain
          .then(() =>
            postJson("/api/cloud/events", {
              turnId: input.turnId,
              attemptGeneration: input.attemptGeneration,
              sessionId: input.threadId,
              seq: "auto",
              kind,
              payload,
            }),
          )
          .catch((error) => {
            console.error(`event ${kind} failed: ${asError(error).message}`);
          });
      };

      const hydration = yield* Effect.promise(async () => {
        try {
          return {
            ok: true as const,
            value: await hydrateDriveForAgentTurn({
              turnId: input.turnId,
              prompt: input.prompt,
              workspaceRoot: driveWorkspace.root,
              workspaceRestored: input.workspaceRestored,
              stateDir: driveWorkspace.stateDir,
              owner: CLOUD_TOOL_PROCESS_IDENTITY,
              post: postJson,
              onProgress: (message) => emitEvent("progress", { message }),
            }),
          };
        } catch (error) {
          return { ok: false as const, error: asError(error) };
        }
      });
      if (!hydration.ok) {
        return {
          ok: false,
          finalText: "",
          error: hydration.error.message,
          usage: { inputTokens: 0, outputTokens: 0, llmCalls: 0 },
          checkpointPolicy: "preserve_prior",
        };
      }
      const driveSync = hydration.value;
      markTurnStep("driveHydrated");
      const driveBefore = yield* Effect.promise(() =>
        snapshotDriveTree(driveWorkspace.root).catch(() => new Map()),
      );
      markTurnStep("driveSnapshotted");

      const officeBinPath = resolveOfficeBinPath();
      const cloudSystemPrompt = CLOUD_GENERAL_PROMPT({
        body: promptBody,
        threadId: input.threadId,
        ...(input.skills ? { skills: input.skills } : {}),
        drive: driveSync,
      });
      const cloudBrowser = createBrokerCloudBrowser({
        post: postJson,
        turnId: input.turnId,
      });
      const toolHost = yield* Effect.acquireRelease(
        Effect.sync(() =>
          createToolHost({
            stellaAppDir: workspaceRoot,
            stellaDataDir: CLOUD_HOST_STATE,
            recoverStaleSecrets: false,
            enableShellShims: false,
            allowCloudCode: true,
            cloudBrowser,
            codeConnectClient: createBrokerConnectClient({
              post: postJson,
              turnId: input.turnId,
            }),
            ...(officeBinPath ? { stellaOfficeBinPath: officeBinPath } : {}),
            askUser: userAsks.handlers.askUser,
            requestSecureInput: userAsks.handlers.requestSecureInput,
            useSecureValue: userAsks.handlers.useSecureValue,
            agentHistoryQuery: async (args) => {
              const response = await postJson("/api/cloud/history", { turnId: input.turnId, args });
              const body = (await response.json().catch(() => null)) as { ok?: boolean; result?: unknown; error?: string } | null;
              if (!response.ok || !body?.ok) {
                throw new Error(body?.error ?? `Your history is unavailable right now (${response.status}).`);
              }
              return body.result;
            },
            webSearch: async (query, options) => {
              const response = await postJson("/api/cloud/web-search", {
                query,
                category: options?.category,
              });
              if (!response.ok) {
                return { text: `WebSearch failed (${response.status}).` };
              }
              return (await response.json()) as {
                text: string;
                results?: Array<{
                  title: string;
                  url: string;
                  snippet: string;
                }>;
              };
            },
          }),
        ),
        (host) =>
          Effect.tryPromise({
            try: () => host.shutdown(),
            catch: asError,
          }).pipe(Effect.orDie),
      );

      markTurnStep("toolHostCreated");
      const context: ToolContext = cloudAgentToolContext({
        threadId: input.threadId,
        workspaceRoot,
        workspaceStateDir,
        toolHome,
        allowedToolNames: cloudGeneralToolNames(),
      });

      const catalog = [
        ...toolHost.getToolCatalog("general", {}),
        ...toolHost.getToolCatalog("general", {
          agentEngine: "claude_code_local",
        }),
      ];
      const byName = new Map(catalog.map((tool) => [tool.name, tool]));
      const cloudToolMetadata = [
        ...cloudGeneralToolNames()
          .map((name) => byName.get(name))
          .filter((tool): tool is ToolMetadata => Boolean(tool))
          .map((tool) =>
            tool.name === "code"
              ? { ...tool, description: CODE_TOOL_CLOUD_AGENT_DESCRIPTION }
              : tool,
          ),
        cloudAgentMoveTool,
      ];
      const executeCloudTool = async (
        toolCallId: string,
        name: string,
        params: Record<string, unknown>,
        signal?: AbortSignal,
        onUpdate?: ToolUpdateCallback,
      ): Promise<ToolResult> => {
        markTurnStep("firstToolCall");
        if (name === CLOUD_AGENT_MOVE_TOOL) {
          return await runCloudAgentMove(postJson, input.turnId, params);
        }
        const result = await toolHost.executeTool(
          name,
          params,
          { ...context, requestId: toolCallId },
          signal,
          onUpdate,
        );
        return result;
      };
      const claudeToolMcpHost: ClaudeCodeToolMcpHost =
        yield* Effect.acquireRelease(
          Effect.tryPromise({
            try: () =>
              createClaudeCodeToolMcpHost({
                tools: cloudToolMetadata,
                identityScope: `${input.threadId}:${input.turnId}`,
                allowLegacyImagePathReopen: false,
                getActiveTurn: () => ({
                  identityScope: `${input.threadId}:${input.turnId}`,
                  executeTool: (toolCallId, toolName, args, signal, onUpdate) =>
                    executeCloudTool(
                      toolCallId,
                      toolName,
                      args,
                      signal,
                      onUpdate,
                    ),
                }),
              }),
            catch: asError,
          }),
          (host) =>
            Effect.promise(async () => {
              await host.close().catch((error) => {
                console.error(
                  `Claude MCP finalizer failed: ${asError(error).message}`,
                );
              });
            }),
        );

      markTurnStep("mcpHostReady");
      const inbox = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () => openAgentInbox(attempt.inbox),
          catch: asError,
        }),
        (opened) => Effect.promise(() => opened.close().catch(() => [])),
      );

      markTurnStep("inboxOpened");
      let llmCalls = 0;
      let inputTokens = 0;
      let outputTokens = 0;
      let checkpointMs = 0;
      let turnStateCheckpoint: TurnBrokerTurnStateCheckpointReceipt | undefined;
      let execution: { finalText: string; errorMessage?: string };
      let produced: AgentMessage[];
      let forceBuilderFallback = false;
      let nativeStateCheckpoint:
        | Awaited<
            ReturnType<typeof runNativeAgentTurn>
          >["nativeStateCheckpoint"]
        | undefined;
      const nativeOutcome = yield* Effect.promise(async () => {
        try {
          return {
            ok: true as const,
            value: await runNativeAgentTurn({
              profile: cloudClaudeRoleProfile({
                role: "agent",
                threadId: input.threadId,
                conversationId: input.conversationId,
              }),
              prompt: input.prompt,
              systemPrompt:
                buildClaudeCodeNativeToolRuntimePrompt(cloudSystemPrompt),
              execution: nativeExecution,
              claudeAccount,
              threadId: input.threadId,
              turnId: input.turnId,
              authoritativeHistoryCursor: nativeHistoryCursorFromRows(
                input.history ?? [],
              ),
              stateIntegrityKey: input.nativeStateIntegrityKey,
              previousStateIntegrityKeys: previousNativeStateIntegrityKeys(input),
              ...(input.rebuildNativeSession === true
                ? { recoveryHistory: input.history ?? [] }
                : {}),
              claudeMcpServerConfig: claudeToolMcpHost.mcpServerConfig,
              onStreamEvent: cloudAgentProgressFromStream(emitEvent),
              inbox,
              ...(await claudeKeeper.then((client) =>
                client
                  ? {
                      keeper: {
                        client,
                        toolCatalogHash: claudeToolMcpHost.toolCatalogHash,
                      },
                    }
                  : {},
              )),
            }),
          };
        } catch (error) {
          return { ok: false as const, error: asError(error) };
        }
      });
      if (!nativeOutcome.ok) {
        forceBuilderFallback = true;
        execution = {
          finalText: "",
          errorMessage: nativeOutcome.error.message,
        };
        produced = [];
      } else {
        const native = nativeOutcome.value;
        let readinessError: Error | undefined;
        if (!native.error) {
          readinessError = yield* Effect.promise(async () => {
            try {
              await claudeToolMcpHost.waitForClientReady(undefined, 1_000);
              return undefined;
            } catch (error) {
              return asError(error);
            }
          });
        }
        llmCalls = native.usage.llmCalls;
        inputTokens = native.usage.inputTokens;
        outputTokens = native.usage.outputTokens;
        execution = {
          finalText: native.finalText.trim(),
          ...(native.error || readinessError
            ? { errorMessage: native.error ?? readinessError!.message }
            : {}),
        };
        produced = native.messages;
        nativeStateCheckpoint = native.nativeStateCheckpoint;
      }
      yield* Effect.promise(() => inbox.close().catch(() => []));
      const executorBoundaryPushFailure = yield* Effect.promise(async () => {
        try {
          await pushWorldProjection({
            root: workspaceRoot,
            access: input.world,
          });
          return undefined;
        } catch (error) {
          return asError(error);
        }
      });
      if (executorBoundaryPushFailure && !execution.errorMessage) {
        execution.errorMessage = executorBoundaryPushFailure.message;
      }
      if (produced.length === 0) {
        const timestamp = Date.now();
        produced = [
          {
            role: "user",
            content: [{ type: "text", text: input.prompt }],
            timestamp,
          },
          {
            role: "assistant",
            content: [
              {
                type: "text",
                text:
                  execution.finalText ||
                  execution.errorMessage ||
                  "The agent finished without a report.",
              },
            ],
            api: "stella-cloud",
            provider: input.execution.provider,
            model: input.execution.model,
            usage: {
              input: inputTokens,
              output: outputTokens,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: inputTokens + outputTokens,
              cost: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                total: 0,
              },
            },
            stopReason: execution.errorMessage ? "error" : "stop",
            ...(execution.errorMessage
              ? { errorMessage: execution.errorMessage }
              : {}),
            timestamp,
          },
        ] as AgentMessage[];
      }
      const eventFailure = yield* Effect.promise(async () => {
        try {
          await eventChain;
          return undefined;
        } catch (error) {
          return asError(error);
        }
      });
      if (eventFailure && !execution.errorMessage) {
        execution.errorMessage = eventFailure.message;
      }

      const outputs = yield* Effect.promise(
        async (): Promise<{
          files: ProducedFileReport[];
          stored: Set<string>;
          notice: string;
        }> => {
          try {
            const writeBack = await writeBackDrive({
              turnId: input.turnId,
              driveRoot: driveWorkspace.root,
              stateDir: driveWorkspace.stateDir,
              identity: { ...CLOUD_TOOL_PROCESS_IDENTITY, home: workspaceRoot },
              sync: driveSync,
              before: driveBefore,
              linked: [
                ...extractLocalFileLinkPaths(execution.finalText),
                ...extractDriveLinkPaths(execution.finalText).map((drivePath) =>
                  path.join(driveWorkspace.root, drivePath),
                ),
              ],
              post: postJson,
            });
            return {
              files: writeBack.files,
              stored: new Set(writeBack.files.map((file) => file.path)),
              notice: writeBack.notice,
            };
          } catch (failure) {
            console.error(
              `drive write-back failed: ${asError(failure).message}`,
            );
            return {
              files: [],
              stored: new Set<string>(),
              notice:
                "\n\nHeads up: saving this turn's drive changes failed, so they are only in this sandbox.",
            };
          }
        },
      );
      if (outputs.files.length > 0) {
        emitEvent("output_files", {
          files: outputs.files.map((file) => ({
            ...toDriveFile(file),
            stored: outputs.stored.has(file.path),
          })),
        });
        const outputEventFailure = yield* Effect.promise(async () => {
          try {
            await eventChain;
            return undefined;
          } catch (error) {
            return asError(error);
          }
        });
        if (outputEventFailure && !execution.errorMessage) {
          execution.errorMessage = outputEventFailure.message;
        }
      }

      const historyCursor = nativeHistoryCursorFromMessages(
        input.turnId,
        produced,
      );
      const transcriptRows = produced.map((message, ordinal) => ({
        ordinal,
        role: (message as { role: string }).role,
        payloadJson: JSON.stringify(message),
      }));

      const shutdownFailures = yield* Effect.promise(async () => {
        await cloudBrowser.checkpoint().catch(() => undefined);
        const results = await Promise.allSettled([
          toolHost.shutdown(),
          claudeToolMcpHost?.close() ?? Promise.resolve(),
          pushWorldProjection({ root: workspaceRoot, access: input.world }),
        ]);
        return results.flatMap((result) =>
          result.status === "rejected" ? [asError(result.reason)] : [],
        );
      });

      if (forceBuilderFallback || shutdownFailures.length > 0) {
        const shutdownReason = shutdownFailures[0]?.message;
        const error =
          execution.errorMessage ||
          shutdownReason ||
          "The executor could not prove that every workspace writer stopped.";
        return createBuilderFallbackAgentTurnResult({
          finalText: execution.finalText,
          notice: outputs.notice,
          error,
          usage: { inputTokens, outputTokens, llmCalls },
          historyCursor,
          messages: transcriptRows,
          ...(nativeStateCheckpoint
            ? { nativeCheckpoint: nativeStateCheckpoint }
            : {}),
        });
      }

      {
        const checkpointStarted = performance.now();
        const checkpointAttempt = yield* Effect.promise(async () => {
          try {
            return {
              receipt: await commitTurnStateBeforeTranscript({
                historyCursor,
                ...(nativeStateCheckpoint
                  ? { nativeCheckpoint: nativeStateCheckpoint }
                  : {}),
                broker,
                appendTranscript: async () => {
                  let response = await postJson("/api/cloud/messages", {
                    conversationId: input.threadId,
                    turnId: input.turnId,
                    messages: transcriptRows,
                  });
                  if (!response.ok) {
                    response = await postJson("/api/cloud/messages", {
                      conversationId: input.threadId,
                      turnId: input.turnId,
                      messages: transcriptRows,
                    });
                  }
                  if (!response.ok) {
                    throw new Error(
                      `Thread transcript persist failed (${response.status}).`,
                    );
                  }
                },
              }),
            } as const;
          } catch (error) {
            return { error: asError(error) } as const;
          }
        });
        checkpointMs = Math.round(performance.now() - checkpointStarted);
        if ("error" in checkpointAttempt) {
          return createBuilderFallbackAgentTurnResult({
            finalText: execution.finalText,
            notice: outputs.notice,
            ...(execution.errorMessage
              ? { error: execution.errorMessage }
              : {}),
            usage: { inputTokens, outputTokens, llmCalls },
            historyCursor,
            messages: transcriptRows,
            ...(nativeStateCheckpoint
              ? { nativeCheckpoint: nativeStateCheckpoint }
              : {}),
          });
        }
        turnStateCheckpoint = checkpointAttempt.receipt;
      }

      const finalText = execution.finalText;
      const error = execution.errorMessage;
      return {
        ok: !error,
        finalText:
          `${finalText || (error ? "" : "The agent finished without a report.")}${outputs.notice}`.trim(),
        ...(error ? { error } : {}),
        usage: { inputTokens, outputTokens, llmCalls },
        checkpointMs,
        ...(turnStateCheckpoint ? { turnStateCheckpoint } : {}),
      } satisfies AgentTurnResult;
    }),
  );

export const previousNativeStateIntegrityKeys = (input: {
  nativeStatePreviousIntegrityKeys?: unknown;
}): string[] =>
  Array.isArray(input.nativeStatePreviousIntegrityKeys)
    ? input.nativeStatePreviousIntegrityKeys.filter(
        (key): key is string =>
          typeof key === "string" && /^[0-9a-f]{64}$/.test(key),
      )
    : [];
