import { readAgentMessageDelivery, readAgentStopResult } from "@stella/contracts/backend/agent-threads";
import { loadDeviceExecutionContext, loadMediaAccess } from "./execution-context.js";
import { resolveRuntimeSourceAsset } from "../shared/runtime-paths.js";
import { createCloudTranscriptWriter } from "./cloud-transcript-write.js";
import { createBrainLeaseView } from "./brain-lease.js";
import { createToolHost } from "../tools/host.js";
import { HookEmitter } from "../extensions/hook-emitter.js";
import {
  getAgentRuntimeEngine,
  getModelOverride,
  getReasoningEffort,
  getSubscriptionHarnessEnabled,
} from "../preferences/local-preferences.js";
import type {
  RunnerContext,
  ParsedAgentLike,
  PiCloudAgentThreads,
  StellaHostRunnerOptions,
} from "./types.js";
import { parseSpawnAgentModel } from "../tools/spawn-model.js";
import { AGENT_IDS } from "@stella/contracts/agent-runtime";
import { parseReasoningEffortLevel } from "@stella/contracts/reasoning-effort";
import type {
  AgentModelConfigSnapshot,
  AgentModelReasoningEffort,
  AgentRuntimeEngine,
  CloudExecutionSelection,
  SpawnEngineSelection,
  SpawnReasoningEffort,
} from "@stella/contracts/agent-engine";
import type { Api, Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import { supportedThinkingLevels } from "../model-thinking-levels.js";
import { getBundledCoreAgentFallback } from "../agents/agents.js";
import {
  createBackgroundExitWake,
  writeBackgroundExitLog,
} from "./background-exit-wake.js";
import { createReadinessLatch } from "../shared/readiness-latch.js";
import {
  resolveRunnerLlmRoute,
  resolveRunnerLlmRouteWithMetadata,
} from "./model-selection.js";
import {
  captureEffectiveModelConfig,
  resolveAgentEngineForRun,
  restoreSpawnEngineFromModelConfig,
  toCloudExecutionSelection,
} from "./agent-model-config.js";
import type { ResolvedLlmRoute } from "../model-routing.js";
import { createBackendSession, initialBackendUrl } from "./backend-session.js";
import { hostname } from "node:os";
import { resolveJwtOwnerScope } from "./computer-agent-cloud-records.js";
import {
  assistantPayloadText,
  createLinkedFilePublisher,
} from "../device-files/linked-file-publisher.js";
import { raceWithTimeoutError } from "./cloud-effect-runtime.js";

const AGENT_MESSAGE_TIMEOUT_MS = 15_000;
const AGENT_SPAWN_TIMEOUT_MS = 30_000;

export const createRunnerContext = ({
  deviceId,
  stellaAppDir,
  stellaDataDir,
  stellaBrowserBinPath,
  stellaOfficeBinPath,
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
  requestRuntimeAuthRefresh,
  requestChallengeToken,
  getDeviceSigner,
  scheduleApi,
  runtimeStore,
  appendLocalChatEvent,
}: StellaHostRunnerOptions): RunnerContext => {
  const envAuthToken = process.env.STELLA_LLM_PROXY_TOKEN ?? null;

  const context = {} as RunnerContext;
  const hookEmitter = new HookEmitter();
  const backend = createBackendSession(
    () => context.state,
    async () => {
      const refreshed = await context.requestRuntimeAuthRefresh?.({
        source: "subscription",
      });
      return refreshed?.authenticated ? refreshed.token : null;
    },
  );

  const getCloudOwnerGeneration = async (): Promise<string> => {
    const identity = await backend.ownerIdentity();
    if (!identity.ownerGeneration.trim()) {
      throw new Error("Cloud owner generation is unavailable.");
    }
    return identity.ownerGeneration.trim();
  };

  const isCloudSignedIn = () =>
    Boolean(
      context.state?.backendUrl &&
        (context.state?.authToken ?? envAuthToken ?? "").trim(),
    );
  const cloudRealtimeBaseUrl = async (): Promise<string | null> =>
    context.state?.backendUrl ?? null;

  const linkedFilePublisher = createLinkedFilePublisher({
    deviceId,
    deviceName: hostname().trim().slice(0, 96) || deviceId,
    getBackendUrl: () => context.state?.backendUrl ?? null,
    getAuthToken: () =>
      (context.state?.authToken ?? envAuthToken ?? "").trim() || null,
    ownerScopeOf: resolveJwtOwnerScope,
    onLog: (event, fields) => {
      console.warn(`[device-files] ${event}`, fields);
    },
  });

  const brainLeases = createBrainLeaseView(deviceId);
  const cloudTranscript = createCloudTranscriptWriter({
    deviceId,
    store: runtimeStore,
    brainLeases,
    onAssistantRecords: (payloadJsons: string[]) => {
      for (const payloadJson of payloadJsons) {
        linkedFilePublisher.publishText(assistantPayloadText(payloadJson));
      }
    },
    getAuthToken: () =>
      (context.state?.authToken ?? envAuthToken ?? "").trim() || null,
    getBaseUrl: cloudRealtimeBaseUrl,
    getOwnerGeneration: getCloudOwnerGeneration,
    isResumableTurn: (localTurnId: string) => localTurnId.startsWith("pi:"),
    ...(appendLocalChatEvent
      ? {
          onDurableDeliveryFailure: ({
            conversationId,
            localTurnId,
            userMessageId,
            message,
          }: {
            conversationId: string;
            localTurnId: string;
            userMessageId: string;
            message: string;
          }) => {
            appendLocalChatEvent({
              conversationId,
              type: "assistant_message",
              eventId: `cloud-sync-error:${deviceId}:${localTurnId}`,
              timestamp: Date.now(),
              payload: {
                text: message,
                userMessageId,
                source: "cloud-sync-error",
              },
            });
          },
        }
      : {}),
  });

  const resolveCloudExecutionSelection = async ({
    model: modelOverride,
    spawnEngine,
    reasoningEffort,
  }: {
    model?: string;
    spawnEngine?: SpawnEngineSelection;
    reasoningEffort?: SpawnReasoningEffort;
  }): Promise<CloudExecutionSelection> => {
    const agent = resolveAgent(context, AGENT_IDS.GENERAL);
    const configuredModel = getConfiguredModel(
      context,
      AGENT_IDS.GENERAL,
      agent,
    );
    const model = modelOverride ?? configuredModel;
    const resolvedLlm = await resolveRunnerLlmRouteWithMetadata(
      context,
      AGENT_IDS.GENERAL,
      model,
      reasoningEffort,
    );
    const { modelConfigSnapshot } = resolveEffectiveAgentExecutionConfig(
      context,
      {
        agentType: AGENT_IDS.GENERAL,
        model,
        resolvedLlm,
        ...(spawnEngine ? { spawnEngine } : {}),
        ...(reasoningEffort ? { spawnReasoningEffort: reasoningEffort } : {}),
      },
    );
    if (!modelConfigSnapshot) {
      throw new Error("Could not resolve the General agent's cloud model.");
    }
    return toCloudExecutionSelection(modelConfigSnapshot);
  };

  const stopAgentThread = async ({
    threadId,
    conversationId,
    requestId,
  }: {
    threadId: string;
    conversationId: string;
    requestId: string;
  }) => {
    if (!backend.client() || !isCloudSignedIn()) {
      throw new Error(
        "Sign in to Stella to stop agents running in the cloud or on your other devices.",
      );
    }
    const ownerGeneration = await getCloudOwnerGeneration();
    const sanitized = `stop:${requestId}`.replace(/[^A-Za-z0-9._:-]/g, "_");
    return await raceWithTimeoutError(
      backend.require().call("agentThreads.stop", {
        ownerGeneration,
        conversationId,
        threadId,
        controlRequestId: sanitized.slice(0, 128),
      }),
      AGENT_MESSAGE_TIMEOUT_MS,
      () =>
        new Error(
          "Stella's cloud did not answer, so the stop may not have reached the agent. Check agent_status, then try again.",
        ),
    );
  };

  const cloudExecutionFor = async (model: string | undefined) => {
    const validModel = (modelName: string) => {
      try {
        resolveRunnerLlmRoute(context, AGENT_IDS.GENERAL, modelName);
        return true;
      } catch {
        return false;
      }
    };
    const selection = parseSpawnAgentModel(model, validModel);
    if (selection.kind === "model") {
      await resolveRunnerLlmRouteWithMetadata(context, AGENT_IDS.GENERAL, selection.model, selection.reasoningEffort);
    }
    return await resolveCloudExecutionSelection({
      ...(selection.kind === "model" ? { model: selection.model, spawnEngine: { engine: "default" } as const } : {}),
      ...(selection.kind === "engine" ? { spawnEngine: selection.engine } : {}),
      ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}),
    });
  };

  const piCloudAgentThreads: PiCloudAgentThreads = {
    execution: cloudExecutionFor,
    start: async ({ conversationId, requestId, description, prompt, model, parentThreadId, workspace }) => {
      const execution = await cloudExecutionFor(model);
      if (!backend.client() || !isCloudSignedIn()) {
        throw new Error("Sign in to Stella to run agents in the cloud.");
      }
      const ownerGeneration = await getCloudOwnerGeneration();
      const started = await raceWithTimeoutError(
        backend.require().call("agentThreads.spawnFromDesktop", {
          ownerGeneration,
          clientMsgId: requestId,
          description,
          prompt,
          originDeviceId: deviceId,
          originConversationId: conversationId,
          execution,
          ...(parentThreadId ? { parentThreadId } : {}),
          ...(workspace ? { workspace } : {}),
        }),
        AGENT_SPAWN_TIMEOUT_MS,
        () =>
          new Error(
            "Stella's cloud did not accept the agent within 30s. Check the running agents before retrying so the same work does not start twice.",
          ),
      );
      return { threadId: started.threadId };
    },
    startOnDevice: async ({ conversationId, requestId, description, prompt, targetDeviceId, model, parentThreadId }) => {
      if (!backend.client() || !isCloudSignedIn()) {
        throw new Error("Sign in to Stella to run agents on your other computers.");
      }
      const ownerGeneration = await getCloudOwnerGeneration();
      const started = await raceWithTimeoutError(
        backend.require().call("agentThreads.spawnFromDesktop", {
          ownerGeneration,
          clientMsgId: requestId,
          conversationId,
          description,
          prompt,
          originDeviceId: deviceId,
          originConversationId: conversationId,
          targetDeviceId,
          ...(model ? { model } : {}),
          ...(parentThreadId ? { parentThreadId } : {}),
        }),
        AGENT_SPAWN_TIMEOUT_MS,
        () =>
          new Error(
            "Stella's cloud did not accept the agent within 30s. Check the running agents before retrying so the same work does not start twice.",
          ),
      );
      return { threadId: started.threadId, waitingForDevice: started.waitingForDevice === true };
    },
    message: async ({ conversationId, threadId, requestId, message, framed }) => {
      if (!backend.client() || !isCloudSignedIn()) {
        throw new Error("Sign in to Stella to message agents running in the cloud.");
      }
      const ownerGeneration = await getCloudOwnerGeneration();
      const delivery = await raceWithTimeoutError(
        backend.require().call("agentThreads.message", {
          ownerGeneration,
          messageId: requestId,
          to: threadId,
          text: message,
          from: { threadId: conversationId, label: "Stella" },
          ...(framed ? { framed } : {}),
        }),
        AGENT_MESSAGE_TIMEOUT_MS,
        () => new Error("Stella's cloud did not answer, so the message may not have been delivered."),
      );
      return readAgentMessageDelivery(delivery).outcome === "steered" ? "steered" : "resumed";
    },
    stop: async (request) => readAgentStopResult(await stopAgentThread(request)),
  };

  const toolHost = createToolHost({
    stellaAppDir,
    stellaDataDir,
    deviceId,
    stellaBrowserBinPath,
    stellaOfficeBinPath,
    stellaComputerCliPath,
    stellaMediaCliPath,
    stellaXApiCliPath,
    cliBridgeSocketPath,
    askUser,
    requestSecureInput,
    useSecureValue,
    revealSecureValueForFill,
    ...(requestBrowserExtensionConnect
      ? { requestBrowserExtensionConnect }
      : {}),
    ...(requestConnectorConnection ? { requestConnectorConnection } : {}),
    scheduleApi,
    webSearch: async (query, searchOptions) => {
      const handler = context.state?.webSearch;
      if (!handler) {
        return {
          text: "Web search is not available yet — runtime is still starting up.",
          results: [],
        };
      }
      return await handler(query, searchOptions);
    },
    agentHistoryQuery: async (args, toolContext) => {
      const query = context.state?.agentHistoryQuery;
      if (!query || !toolContext.agentId) {
        throw new Error("Your history is unavailable in this session.");
      }
      return await query({ conversationId: toolContext.conversationId, threadId: toolContext.agentId, args });
    },
    getCloudBackendAuth: () => {
      const baseUrl = context.state?.backendUrl?.trim();
      const authToken = (context.state?.authToken ?? envAuthToken ?? "").trim();
      return baseUrl && authToken ? { baseUrl, authToken } : null;
    },
    getStellaSiteAuth: () => {
      const baseUrl = context.state?.backendUrl?.trim();
      const authToken = (context.state?.authToken ?? envAuthToken ?? "").trim();
      return baseUrl && authToken ? { baseUrl, authToken } : null;
    },
  });

  Object.assign(context, {
    backend,
    deviceId,
    stellaAppDir,
    stellaDataDir,
    stellaBrowserBinPath,
    stellaOfficeBinPath,
    stellaComputerCliPath,
    cliBridgeSocketPath,
    askUser,
    requestSecureInput,
    useSecureValue,
    revealSecureValueForFill,
    requestRuntimeAuthRefresh,
    requestChallengeToken,
    getDeviceSigner,
    scheduleApi,
    runtimeStore,
        appendLocalChatEvent,
        cloudTranscript,
    brainLeases,
    piCloudAgentThreads,
    cloudOwnerGeneration: getCloudOwnerGeneration,
    linkedFilePublisher,
    loadExecutionContext: async () => {
      const authToken = context.state.authToken;
      return loadDeviceExecutionContext({
        deviceId,
        baseUrl: authToken ? await cloudRealtimeBaseUrl() : null,
        authToken,
        client: authToken ? context.backend.client() : null,
        loadMedia: () =>
          loadMediaAccess({
            stellaDataDir,
            hasConnectedAccount: context.state.hasConnectedAccount === true,
            client: context.backend.client(),
          }),
      });
    },
    paths: {
      extensionsPath: resolveRuntimeSourceAsset("extensions"),
    },
    state: {
      backendUrl: initialBackendUrl(),
      authToken: envAuthToken,
      hasConnectedAccount: false,
      cloudSyncEnabled: true,
      isRunning: false,
      isInitialized: false,
      initializationPromise: null,
      initializationStarted: createReadinessLatch(),
      backgroundExitWake: null,
      loadedAgents: [],
      webSearch: null,
    },
    hookEmitter,
    toolHost,
  });

  context.state.backgroundExitWake = createBackgroundExitWake({
    watchShellExit: toolHost.watchShellExit,
    readShellExitSnapshot: toolHost.readShellExitSnapshot,
    getThreadStatus: async (agentId: string, conversationId: string) =>
      (await context.state.backgroundExitTarget?.status(agentId, conversationId)) ??
      "canceled",
    writeExitLog: async (sessionId: string, contents: string) =>
      await writeBackgroundExitLog(stellaDataDir, sessionId, contents),
    deliver: async (args) => {
      const target = context.state.backgroundExitTarget;
      if (!target || !args.isCurrent()) return false;
      const delivered = await target.deliver(args);
      if (delivered) {
        console.info(
          `[background-wake] woke ${args.agentId} (conversation ${args.conversationId}) on background command exit`,
        );
      }
      return delivered;
    },
  });

  return context;
};

export const resolveAgent = (
  context: RunnerContext,
  agentType: string,
): ParsedAgentLike | undefined =>
  context.state.loadedAgents.find((entry) =>
    entry.agentTypes.includes(agentType),
  ) ??
  context.state.loadedAgents.find((entry) => entry.id === agentType) ??
  getBundledCoreAgentFallback(agentType);

export const getConfiguredModel = (
  context: RunnerContext,
  agentType: string,
  agent?: ParsedAgentLike,
): string | undefined => {
  const modelFromPrefs = getModelOverride(context.stellaDataDir, agentType);
  return modelFromPrefs ?? agent?.model;
};

export type ResolvedAgentModelRoute = {
  agent?: ParsedAgentLike;
  model?: string;
  resolvedLlm: ResolvedLlmRoute;
};

export const resolveAgentModelRoute = async (
  context: RunnerContext,
  agentType: string,
  modelOverride?: string,
  routeAgentType = agentType,
): Promise<ResolvedAgentModelRoute> => {
  const agent = resolveAgent(context, agentType);
  const configuredModel = getConfiguredModel(context, agentType, agent);
  const model = modelOverride ?? configuredModel;
  const resolvedLlm = await resolveRunnerLlmRouteWithMetadata(
    context,
    routeAgentType,
    model,
  );
  return {
    ...(agent ? { agent } : {}),
    ...(model ? { model } : {}),
    resolvedLlm,
  };
};

export const resolveSpawnReasoningEffortForModel = (
  model: Model<Api>,
  requested: SpawnReasoningEffort,
): Exclude<ModelThinkingLevel, "off"> | undefined => {
  const effortOrder: readonly ModelThinkingLevel[] = [
    "off",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ];
  const requestedIndex = effortOrder.indexOf(requested);
  const supported = supportedThinkingLevels(model);
  let nearest: ModelThinkingLevel | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of supported) {
    const candidateIndex = effortOrder.indexOf(candidate);
    if (candidateIndex === -1) continue;
    const distance = Math.abs(candidateIndex - requestedIndex);
    const nearestIndex = nearest ? effortOrder.indexOf(nearest) : -1;
    if (
      distance < nearestDistance ||
      (distance === nearestDistance && candidateIndex > nearestIndex)
    ) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }
  return nearest === "off" ? undefined : nearest;
};

export const resolveEffectiveAgentExecutionConfig = (
  context: RunnerContext,
  args: {
    agentType: string;
    model?: string;
    resolvedLlm: ResolvedLlmRoute;
    spawnEngine?: SpawnEngineSelection;
    spawnReasoningEffort?: SpawnReasoningEffort;
    modelConfigSnapshot?: AgentModelConfigSnapshot;
    configuredAgentEngine?: AgentRuntimeEngine;
    configuredReasoningEffort?: string;
    sampledEngineConfig?: { engineModel?: string; reasoningEffort?: AgentModelReasoningEffort };
    subscriptionHarnessEnabled?: boolean;
  },
) => {
  const restoredSpawnEngine =
    args.spawnEngine ??
    restoreSpawnEngineFromModelConfig(args.modelConfigSnapshot);
  const configuredAgentEngine =
    args.configuredAgentEngine ?? getAgentRuntimeEngine(context.stellaDataDir);
  const agentEngine =
    args.modelConfigSnapshot?.engine ??
    resolveAgentEngineForRun(configuredAgentEngine, restoredSpawnEngine);
  const subscriptionHarnessEnabled =
    agentEngine === "codex_cli" ||
    (args.modelConfigSnapshot
      ? args.modelConfigSnapshot.subscriptionHarnessEnabled === true
      : (args.subscriptionHarnessEnabled ??
        getSubscriptionHarnessEnabled(context.stellaDataDir, agentEngine)));
  const capturedSubscriptionHarness =
    subscriptionHarnessEnabled &&
    (agentEngine === "codex_cli" || agentEngine === "claude_code_local");
  const usesInProcessSubscriptionHarness =
    args.agentType !== AGENT_IDS.ORCHESTRATOR &&
    capturedSubscriptionHarness &&
    agentEngine === "codex_cli";
  const savedReasoningEffort =
    parseReasoningEffortLevel(args.configuredReasoningEffort) ??
    parseReasoningEffortLevel(args.sampledEngineConfig?.reasoningEffort) ??
    getReasoningEffort(context.stellaDataDir, args.agentType);
  const spawnReasoningEffort = args.spawnReasoningEffort;
  const inheritedReasoningEffort = args.modelConfigSnapshot?.reasoningEffort;
  const effectiveReasoningEffort = inheritedReasoningEffort
    ? inheritedReasoningEffort === "none"
      ? undefined
      : inheritedReasoningEffort
    : spawnReasoningEffort &&
        (agentEngine === "default" || usesInProcessSubscriptionHarness)
      ? resolveSpawnReasoningEffortForModel(
          args.resolvedLlm.model,
          spawnReasoningEffort,
        )
      : (spawnReasoningEffort ?? savedReasoningEffort);
  if (
    spawnReasoningEffort &&
    (agentEngine === "default" || usesInProcessSubscriptionHarness)
  ) {
    if (!effectiveReasoningEffort) {
      console.debug("[stella:spawn-reasoning] effort dropped", {
        requested: spawnReasoningEffort,
        model: args.resolvedLlm.model.id,
        reason: "resolved model has no reasoning dial",
      });
    } else if (effectiveReasoningEffort !== spawnReasoningEffort) {
      console.debug("[stella:spawn-reasoning] effort clamped", {
        requested: spawnReasoningEffort,
        effective: effectiveReasoningEffort,
        model: args.resolvedLlm.model.id,
      });
    }
  }

  const modelConfigSnapshot = args.modelConfigSnapshot
    ? agentEngine === "codex_cli"
      ? {
          ...args.modelConfigSnapshot,
          subscriptionHarnessEnabled: true,
          routeModel: `chatgpt/${args.modelConfigSnapshot.engineModel}`,
        }
      : args.modelConfigSnapshot
    : captureEffectiveModelConfig({
        stellaDataDir: context.stellaDataDir,
        agentType: args.agentType,
        engine: agentEngine,
        subscriptionHarnessEnabled: capturedSubscriptionHarness,
        configuredModel: args.model,
        engineModelOverride:
          args.sampledEngineConfig?.engineModel ?? restoredSpawnEngine?.model,
        engineConfigSampled: Boolean(args.sampledEngineConfig),
        ...(restoredSpawnEngine ? { spawnEngine: restoredSpawnEngine } : {}),
        resolvedLlm: args.resolvedLlm,
        reasoningEffort: effectiveReasoningEffort,
      });

  return {
    agentEngine,
    effectiveReasoningEffort,
    modelConfigSnapshot,
    restoredSpawnEngine,
  };
};

