import { readAgentMessageDelivery } from "@stella/contracts/backend/agent-threads";
import {
  createRunnerContext,
  getConfiguredModel,
  resolveAgent,
  resolveAgentModelRoute,
} from "./runner/context.js";
import type { WebSearchResult } from "@stella/contracts/backend/search";
import { scheduleRemotePromptRevalidation } from "./prompts/remote-prompts.js";
import { createRunnerPiTools } from "./runner/pi-tools.js";
import { createRuntimeInitialization } from "./runner/runtime-initialization.js";
import { createAgentReportInbox } from "./runner/agent-report-inbox.js";
import {
  completeComputerThread,
  createComputerAgentCloudRecords,
} from "./runner/computer-agent-cloud-records.js";
import { createClaudeSessionSync } from "./runner/claude-session-sync.js";
import {
  claudeSessionSyncSink,
  setClaudeSessionSyncSink,
} from "./integrations/claude-code-session-sync-sink.js";
import { getClaudeCodeConfig } from "./storage/local-llm-credential-access.js";
import { resolveAgentWorkingDirectory } from "./agent-runtime/shared.js";
import { loadGoogleWorkspaceTools } from "./google-workspace/load-google-workspace-tools.js";
import {
  deleteConnectorAccessTokens,
  loadConnectorAccessToken,
} from "./connectors/oauth.js";
import { AGENT_IDS } from "@stella/contracts/agent-runtime";
import { canResolveRunnerLlmRoute } from "./runner/model-selection.js";
import { sanitizeStellaBase } from "./runner/shared.js";
import type {
  AgentHealth,
  PiReportDelivery,
  RunnerPublicApi,
  StellaHostRunnerOptions,
} from "./runner/types.js";

export type { StellaHostRunnerOptions } from "./runner/types.js";

import type { ToolResult } from "./tools/types.js";

type GoogleWorkspaceAuthResult = {
  connected: boolean;
  unavailable?: boolean;
  email?: string;
  name?: string;
};

const getGoogleWorkspaceRecord = (
  value: unknown,
): Record<string, unknown> | null =>
  value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;

const getGoogleWorkspaceString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const getGoogleWorkspacePrimaryArrayField = (
  value: unknown,
  fieldName: string,
): string | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  for (const entry of value) {
    const record = getGoogleWorkspaceRecord(entry);
    const fieldValue = getGoogleWorkspaceString(record?.[fieldName]);
    if (fieldValue) {
      return fieldValue;
    }
  }

  return undefined;
};

export const parseGoogleWorkspaceProfile = (
  value: unknown,
): { email?: string; name?: string } => {
  const record = getGoogleWorkspaceRecord(value);
  if (!record) {
    return {};
  }

  return {
    email:
      getGoogleWorkspacePrimaryArrayField(record.emailAddresses, "value") ??
      getGoogleWorkspaceString(record.emailAddress) ??
      getGoogleWorkspaceString(record.email),
    name:
      getGoogleWorkspacePrimaryArrayField(record.names, "displayName") ??
      getGoogleWorkspacePrimaryArrayField(record.names, "unstructuredName") ??
      getGoogleWorkspaceString(record.displayName),
  };
};

const parseGoogleProfileResult = (
  result: ToolResult,
): GoogleWorkspaceAuthResult => {
  if ("error" in result) return { connected: false };
  const response = result.result;
  if (typeof response === "string") {
    try {
      const data = JSON.parse(response);
      return {
        connected: true,
        ...parseGoogleWorkspaceProfile(data),
      };
    } catch {
      return { connected: false };
    }
  }
  if (!response || typeof response !== "object") {
    return { connected: false };
  }
  return {
    connected: true,
    ...parseGoogleWorkspaceProfile(response),
  };
};

export const createStellaHostRunner = (
  options: StellaHostRunnerOptions,
): RunnerPublicApi => {
  const context = createRunnerContext(options);
  // Nested (`code`, `multi_tool_use_parallel`) and voice calls dispatch
  // through the host, so they need the same extension hooks the runtime
  // adapter applies to model-issued top-level calls.
  context.toolHost.setToolCallHooks(context.hookEmitter);
  let restartReportInbox = () => {};
  let resumeComputerAgentCloudRecords = () => {};
  let resumeClaudeSessionSync = () => {};
  const setAuthToken = (value: string | null) => {
    if (process.env.STELLA_LLM_PROXY_TOKEN) return;
    const prev = context.state.authToken?.trim() || null;
    const next = value?.trim() || null;
    if (next === prev) return;
    context.state.authToken = value;
    context.backend.noteAuthToken();
    if (next) {
      restartReportInbox();
      resumeComputerAgentCloudRecords();
      resumeClaudeSessionSync();
      context.cloudTranscript.resume();
    }
  };
  const setHasConnectedAccount = (value: boolean) => {
    context.state.hasConnectedAccount = Boolean(value);
    restartReportInbox();
  };
  const webSearch = async (
    query: string,
    searchOptions?: { category?: string },
  ): Promise<WebSearchResult> => {
    try {
      const result = await context.backend.require().call("search.web", {
        query,
        ...(searchOptions?.category ? { category: searchOptions.category } : {}),
      });
      return {
        text: result.text || "WebSearch returned no response.",
        results: result.results,
      };
    } catch (error) {
      return {
        text: `WebSearch failed: ${(error as Error).message}`,
        results: [],
      };
    }
  };
  if (options.requestRuntimeAuthRefresh) {
    context.requestRuntimeAuthRefresh = async (payload) => {
      const result = await options.requestRuntimeAuthRefresh?.(payload);
      if (result?.token) {
        setAuthToken(result.token);
      }
      if (result) {
        setHasConnectedAccount(result.hasConnectedAccount);
      }
      return (
        result ?? {
          authenticated: false,
          token: null,
          hasConnectedAccount: false,
        }
      );
    };
  }
  context.state.webSearch = webSearch;

  // Local history stays on this device. Authentication and startup must not
  // upload existing transcripts or wait for a history transfer.

  const computerAgentCloudRecords = createComputerAgentCloudRecords({
    deviceId: context.deviceId,
    store: context.runtimeStore,
    getAuthToken: () => context.state.authToken?.trim() || null,
    backend: {
      start: async (args) =>
        await context.backend.require().call("computerThreads.start", args as never),
      complete: async (args) =>
        await context.backend.require().call("computerThreads.complete", args as never),
      cancel: async (args) =>
        await context.backend.require().call("computerThreads.cancel", args as never),
      get: async (args) =>
        await context.backend.require().call("computerThreads.get", args as never),
    },
  });
  resumeComputerAgentCloudRecords = computerAgentCloudRecords.resume;
  const claudeSessionSync = createClaudeSessionSync({
    deviceId: context.deviceId,
    db: context.runtimeStore.db,
    leaseSuperseded: (conversationId, epoch) =>
      context.brainLeases.superseded(conversationId, epoch),
    getAuthToken: () => context.state.authToken?.trim() || null,
    getBackend: () => {
      const client = context.backend.client();
      if (!client) return null;
      return {
        append: async (args) => await client.call("claudeSessions.append", args),
        tag: async (args) => await client.call("claudeSessions.tag", args),
        latest: async (args) => await client.call("claudeSessions.latest", args),
        readChunk: async (args) =>
          await client.call("claudeSessions.readChunk", args),
      };
    },
  });
  setClaudeSessionSyncSink(claudeSessionSync);
  resumeClaudeSessionSync = claudeSessionSync.resume;
  claudeSessionSync.resume();
  context.brainLeases.onChange(() => claudeSessionSync.wake());
  const deliverOrchestratorNote: PiReportDelivery = async (note) => {
    const deliver = context.state.piReportDelivery;
    if (!deliver) {
      throw new Error("Stella's chat is not ready to take this yet.");
    }
    await deliver(note);
  };
  const agentReportInbox = createAgentReportInbox({
    deviceId: context.deviceId,
    getOwnerGeneration: async () =>
      (await context.backend.ownerIdentity()).ownerGeneration,
    watchReports: (args, onUpdate, onError) => {
      const client = context.backend.client();
      if (!client) return null;
      return client.watch("agentReports.forDevice", args, onUpdate, onError);
    },
    acknowledge: async (args) =>
      await context.backend.require().call("agentReports.acknowledge", args),
    canStart: () =>
      context.state.hasConnectedAccount === true &&
      Boolean(context.state.authToken?.trim()) &&
      Boolean(context.backend.client()),
    deliver: deliverOrchestratorNote,
  });
  restartReportInbox = () => {
    if (
      context.state.hasConnectedAccount !== true ||
      !context.state.authToken?.trim()
    ) {
      agentReportInbox.stop();
      return;
    }
    queueMicrotask(() => agentReportInbox.start());
  };
  restartReportInbox();
  const agentHealthCheck = (): AgentHealth => {
    if (!context.state.isRunning) {
      return { ready: false, reason: "Stella runtime is not started", engine: "stella" };
    }
    if (!context.state.isInitialized) {
      return { ready: false, reason: "Stella runtime is still initializing", engine: "stella" };
    }
    const orchestratorModel = getConfiguredModel(
      context,
      AGENT_IDS.ORCHESTRATOR,
      resolveAgent(context, AGENT_IDS.ORCHESTRATOR),
    );
    if (canResolveRunnerLlmRoute(context, orchestratorModel)) {
      return { ready: true, engine: "pi" };
    }
    if (!sanitizeStellaBase(context.state.backendUrl)) {
      return { ready: false, reason: "Missing backend URL", engine: "pi" };
    }
    if (!context.state.authToken?.trim()) {
      return { ready: false, reason: "Missing auth token", engine: "pi" };
    }
    return { ready: false, reason: "No usable model route", engine: "pi" };
  };
  const warmModelCatalog = async (): Promise<void> => {
    await resolveAgentModelRoute(context, AGENT_IDS.ORCHESTRATOR);
  };

  const runtimeInitialization = createRuntimeInitialization(context, {
    disposeBackendClient: () => context.backend.dispose(),
    shutdownTasks: async () => {
      // Stop network delivery first: shutdown still admits every resulting
      // cancel/terminal row synchronously, but it must not wait on a backend
      // client that runtime teardown has already disposed. The next worker
      // resumes those durable rows before constructing its agent manager.
      computerAgentCloudRecords.stop();
      claudeSessionSync.stop();
      if (claudeSessionSyncSink() === claudeSessionSync) {
        setClaudeSessionSyncSink(null);
      }
    },
  });

  return {
    deviceId: context.deviceId,
    hookEmitter: context.hookEmitter,
    setBackendUrl: (value) => {
      context.backend.setBackendUrl(value);
      scheduleRemotePromptRevalidation();
      queueMicrotask(() => agentReportInbox.start());
      computerAgentCloudRecords.resume();
      claudeSessionSync.resume();
    },
    setAuthToken,
    setHasConnectedAccount,
    setCloudSyncEnabled: (enabled) => {
      context.state.cloudSyncEnabled = Boolean(enabled);
    },
    setPiReportDelivery: (delivery) => {
      if (delivery) context.state.piReportDelivery = delivery;
      else delete context.state.piReportDelivery;
    },
    setAgentHistoryQuery: (query) => {
      if (query) context.state.agentHistoryQuery = query;
      else delete context.state.agentHistoryQuery;
    },
    setBackgroundExitTarget: (target) => {
      if (target) context.state.backgroundExitTarget = target;
      else delete context.state.backgroundExitTarget;
    },
    backgroundExits: {
      arm: (args) => context.state.backgroundExitWake?.arm(args) ?? [],
      disarm: (owner) => context.state.backgroundExitWake?.disarm(owner),
      runningSessions: (owner) => context.toolHost.listRunningShellSessionsOwnedBy(owner),
    },
    piCloudAgentThreads: context.piCloudAgentThreads,
    deliverOrchestratorNote,
    start: runtimeInitialization.start,
    stop: async () => {
      agentReportInbox.stop();
      await runtimeInitialization.stop();
    },
    waitUntilInitialized: async () => {
      if (context.state.initializationPromise) {
        await context.state.initializationPromise;
      }
    },
    getStellaSiteAuth: () => {
      const baseUrl = context.state.backendUrl?.trim();
      const authToken = context.state.authToken?.trim();
      return baseUrl && authToken ? { baseUrl, authToken } : null;
    },
    loadExecutionContext: async () => await context.loadExecutionContext?.(),
    killAllShells: () => context.toolHost.killAllShells(),
    piTools: createRunnerPiTools(context),
    agentHealthCheck,
    warmModelCatalog,
    resolveImageTarget: async (agentType = AGENT_IDS.ORCHESTRATOR) => {
      try {
        const { resolvedLlm } = await resolveAgentModelRoute(
          context,
          agentType,
        );
        return {
          provider: resolvedLlm.model.provider,
          api: resolvedLlm.model.api,
          modelId: resolvedLlm.model.id,
        };
      } catch {
        return null;
      }
    },
    webSearch,
    publishLinkedFiles: (text: string) => {
      context.linkedFilePublisher.publishText(text);
    },
    restoreClaudeCodeSession: async ({ threadId, cwd, atJournalSeq }) => {
      const claudeConfig = await getClaudeCodeConfig();
      const workingFolder =
        cwd?.trim() ||
        resolveAgentWorkingDirectory({
          agentType: AGENT_IDS.ORCHESTRATOR,
          stellaAppDir: context.stellaAppDir,
        });
      if (!workingFolder) {
        throw new Error("No working folder to restore the session into.");
      }
      return await claudeSessionSync.restore({
        threadId,
        configDir: claudeConfig.configDir ?? null,
        cwd: workingFolder,
        ...(atJournalSeq !== undefined ? { atJournalSeq } : {}),
      });
    },
    flushClaudeSessionSync: (timeoutMs) => claudeSessionSync.flush(timeoutMs),
    brainLeases: {
      note: (conversationId, record) => context.brainLeases.note(conversationId, record),
      holds: (conversationId) => context.brainLeases.holds(conversationId),
      claim: (conversationId) => context.brainLeases.claim(conversationId),
      beganUnder: (conversationId, epoch) => context.brainLeases.beganUnder(conversationId, epoch),
    },
    cloudJournal: {
      begin: (request) => context.cloudTranscript.begin(request),
      promptSeq: (conversationId, ack) =>
        context.cloudTranscript.promptSeq(conversationId, ack),
      finish: (request) => context.cloudTranscript.finish(request),
      append: (request) => context.cloudTranscript.append(request),
      history: (conversationId) => context.cloudTranscript.history(conversationId),
      priorTurnPromptSeq: (conversationId, throughSeq) =>
        context.cloudTranscript.priorTurnPromptSeq(conversationId, throughSeq),
      ownerGeneration: () => context.cloudOwnerGeneration(),
    },
    computerAgents: {
      start: (args) => computerAgentCloudRecords.create(args),
      complete: (args) => computerAgentCloudRecords.complete(args),
      reconcile: async (elsewhere) => {
        const backend = context.backend.client();
        if (!backend || !context.state.authToken?.trim()) return { settled: [] };
        const { reconcileComputerAgents } = await import(
          "./runner/computer-agent-reconcile.js"
        );
        const ownerGeneration = await context.cloudOwnerGeneration();
        const fence = { originDeviceId: context.deviceId, ownerGeneration };
        return await reconcileComputerAgents({
          running: async () =>
            await backend.call("computerThreads.running", fence),
          complete: async (input) =>
            await completeComputerThread(
              async (args) =>
                await backend.call("computerThreads.complete", args as never),
              { ...fence, ...input },
            ),
          cancel: async (input) =>
            await backend.call("computerThreads.cancel", { ...fence, ...input }),
          standing: elsewhere,
        });
      },
    },
    agentThreads: {
      directory: async (conversationId) =>
        await context.backend.require().call("agentThreads.directory", { conversationId }),
      message: async (args) =>
        readAgentMessageDelivery(
          await context.backend.require().call("agentThreads.message", {
            ...args,
            ownerGeneration: await context.cloudOwnerGeneration(),
          }),
        ),
      pause: async (args) =>
        await context.backend.require().call("agentThreads.pause", {
          ...args,
          ownerGeneration: await context.cloudOwnerGeneration(),
        }),
      note: async (args) => {
        await context.backend.require().call("agentReports.note", {
          ...args,
          ownerGeneration: await context.cloudOwnerGeneration(),
        });
      },
      handoff: async (args) => {
        const execution =
          args.targetDeviceId === "cloud" ? await context.piCloudAgentThreads.execution(args.model) : undefined;
        return await context.backend.require().call("agentThreads.handoff", {
          ...args,
          ...(execution ? { execution } : {}),
          fromDeviceId: context.deviceId,
          ownerGeneration: await context.cloudOwnerGeneration(),
        });
      },
    },
    agentLogs: {
      append: async (args) => await context.backend.require().call("agentLogs.append", args),
      read: async (args) => await context.backend.require().call("agentLogs.read", args),
    },
    googleWorkspaceGetAuthStatus: async () => {
      return {
        connected: Boolean(
          await loadConnectorAccessToken(
            context.stellaDataDir,
            "google-workspace",
          ),
        ),
      };
    },

    googleWorkspaceConnect: async () => {
      const { callTool, disconnect } = await loadGoogleWorkspaceTools({
        stellaAppDir: context.stellaDataDir,
      });
      try {
        if (!callTool) return { connected: false, unavailable: true };
        return parseGoogleProfileResult(await callTool("people.getMe", {}));
      } finally {
        await disconnect().catch(() => undefined);
      }
    },

    googleWorkspaceDisconnect: async () => {
      await deleteConnectorAccessTokens(context.stellaDataDir, [
        "google-workspace",
      ]);
      return { ok: true };
    },
  };
};
