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

/** Outlasts the cloud's wait for a device to acknowledge a delivery. */
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
  /** The conversation Durable Objects live on the backend worker. */
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
    // A pi-durable transcript's mirror re-adopts the turn it had open.
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

  const pauseAgentThread = async ({
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
        "Sign in to Stella to pause agents running in the cloud or on your other devices.",
      );
    }
    const ownerGeneration = await getCloudOwnerGeneration();
    const sanitized = `pause:${requestId}`.replace(/[^A-Za-z0-9._:-]/g, "_");
    return await raceWithTimeoutError(
      backend.require().call("agentThreads.pause", {
        ownerGeneration,
        conversationId,
        threadId,
        controlRequestId: sanitized.slice(0, 128),
      }),
      AGENT_MESSAGE_TIMEOUT_MS,
      () =>
        new Error(
          "Stella's cloud did not answer, so the pause may not have reached the agent. Check agent_status, then try again.",
        ),
    );
  };

  const piCloudAgentThreads: PiCloudAgentThreads = {
    start: async ({ conversationId, requestId, description, prompt, model }) => {
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
        await resolveRunnerLlmRouteWithMetadata(
          context,
          AGENT_IDS.GENERAL,
          selection.model,
          selection.reasoningEffort,
        );
      }
      const execution = await resolveCloudExecutionSelection({
        ...(selection.kind === "model"
          ? { model: selection.model, spawnEngine: { engine: "default" } as const }
          : {}),
        ...(selection.kind === "engine" ? { spawnEngine: selection.engine } : {}),
        ...(selection.reasoningEffort
          ? { reasoningEffort: selection.reasoningEffort }
          : {}),
      });
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
        }),
        AGENT_SPAWN_TIMEOUT_MS,
        () =>
          new Error(
            "Stella's cloud did not accept the agent within 30s. Check the running agents before retrying so the same work does not start twice.",
          ),
      );
      return { threadId: started.threadId };
    },
    message: async ({ conversationId, threadId, requestId, message }) => {
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
        }),
        AGENT_MESSAGE_TIMEOUT_MS,
        () => new Error("Stella's cloud did not answer, so the message may not have been delivered."),
      );
      return delivery.delivered === "steered" ? "steered" : "resumed";
    },
    pause: async (request) => {
      await pauseAgentThread(request);
    },
  };

  const toolHost = createToolHost({
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
        loadMedia: () =>
          loadMediaAccess({
            stellaDataDir,
            hasConnectedAccount: context.state.hasConnectedAccount === true,
            client: context.backend.client(),
          }),
      });
    },
    paths: {
      // The stella-runtime extension (agent definitions, orchestrator hooks)
      // ships in the app bundle and is loaded from there. The data dir has no
      // extensions tier and nothing seeds one — pointing the loader at
      // `<data>/extensions` silently drops every bundled agent, leaving the
      // orchestrator with the fallback prompt and no tools.
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

  // Needs both halves: the tool host owns the shell sessions, the agent
  // manager owns the threads a wake resumes. Both are reachable now, so the
  // wake is wired here rather than deferred to initialization.
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
  // A per-spawn engine selection wins over the preference-configured engine
  // for this run only; saved preferences are never touched. Persisted
  // snapshots restore the exact spawn-time selection on resume.
  const restoredSpawnEngine =
    args.spawnEngine ??
    restoreSpawnEngineFromModelConfig(args.modelConfigSnapshot);
  const configuredAgentEngine =
    args.configuredAgentEngine ?? getAgentRuntimeEngine(context.stellaDataDir);
  const agentEngine =
    args.modelConfigSnapshot?.engine ??
    resolveAgentEngineForRun(configuredAgentEngine, restoredSpawnEngine);
  // Codex snapshots from older builds may say native/false. Codex now always
  // uses the in-process subscription transport, including restored runs.
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

