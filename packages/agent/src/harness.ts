import type { Context } from "@earendil-works/chord";
import type { ModelThinkingLevel, Models } from "@earendil-works/pi-ai";
import type { AgentLineage } from "@stella/contracts/agent-depth";
import type { AgentStopResult } from "@stella/contracts/backend/agent-threads";
import {
  createRegistry,
  Harness,
  type Agent,
  type Extension,
  type HarnessOptions,
  type HarnessSettings,
  type ModelRef,
  type Registry,
  type Storage,
} from "@earendil-works/pi-durable";
import { CLAUDE_CODE_ENGINE_EXTENSION, engineExtensionChange } from "./engine/selection.ts";
import { STELLA_PROVIDER_ID, stellaModelId } from "./provider/stella.ts";
import {
  stellaAgents,
  type AgentOrigin,
  type PlacedAgentResult,
  type PlacedAgentRun,
  type StellaAgentRecord,
  type StellaAgentsHost,
} from "./stella/agents.ts";
import { STELLA_CODING_EXTENSION, StellaCoding } from "./stella/coding.ts";
import type { StellaContextSources } from "./stella/context.ts";
import { STELLA_AGENT_TOOLS, stellaToolExtensions, type StellaToolHost } from "./stella/host-tools.ts";
import { stellaPromptExtension } from "./stella/prompt-extension.ts";

const MODEL_REQUEST_TIMEOUT_MS = 30 * 60 * 1000;

export const STELLA_DEFAULT_ALIAS = "stella/default";

export const stellaModelRef = (agentType: "orchestrator" | "general", alias = STELLA_DEFAULT_ALIAS): ModelRef => ({
  provider: STELLA_PROVIDER_ID,
  modelId: stellaModelId(agentType, alias),
});

export const stellaHarnessSettings = (overrides: Partial<HarnessSettings> = {}): HarnessSettings => ({
  stream: { timeoutMs: MODEL_REQUEST_TIMEOUT_MS, maxRetries: 0 },
  retry: { enabled: true, maxRetries: 3, baseDelayMs: 2_000, maxAgentDelayMs: 60_000 },
  compaction: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000, backgroundTokens: 24_576 },
  ...overrides,
});

export const orchestratorAgent = (model: ModelRef) => ({
  model,
  tools: null,
  extensions: { remove: [StellaCoding, { name: STELLA_AGENT_TOOLS }], ...engineExtensionChange(model) },
});

export const offersAgentTools = (agent: Agent): boolean =>
  agent.extensions.some(
    (extension) => extension.name === STELLA_CODING_EXTENSION || extension.name === STELLA_AGENT_TOOLS,
  );

export type StellaHarnessOptions = {
  storage: Storage;
  models: Models;
  sources: StellaContextSources;
  agents: StellaAgentsHost;
  tools?: StellaToolHost;
  extensions?: readonly Extension[];
  env?: HarnessOptions["env"];
  settings?: HarnessSettings;
  onReport?: (error: unknown) => void;
};

export type OpenStellaHarness = {
  harness: Harness;
  registry: Registry;
  refreshTools(): void;
  startAgent(
    args: {
      key: string;
      description: string;
      prompt: string;
      threadId?: string;
      origin?: AgentOrigin;
      model?: ModelRef;
      thinkingLevel?: ModelThinkingLevel;
      catchUp?: boolean;
      lineage?: AgentLineage;
    },
    context: Context,
  ): Promise<{ threadId: string; existing: boolean }>;
  markCatchUp(threadId: string, context: Context): Promise<void>;
  stopAgent(threadId: string, context: Context): Promise<{ local: string[]; elsewhere: AgentStopResult[] } | undefined>;
  agentStanding(
    threadId: string,
    context: Context,
  ): Promise<
    | {
        status: StellaAgentRecord["status"];
        stopped?: true;
        agentStatus: StellaAgentRecord["agentStatus"];
        attempt: number;
      }
    | undefined
  >;
  agentRecords(context: Context): Promise<StellaAgentRecord[]>;
  messageAgent(
    args: { key: string; threadId: string; message: string; fromOrchestrator?: boolean },
    context: Context,
  ): Promise<void>;
  runPlacedAgent(args: PlacedAgentRun, context: Context): Promise<PlacedAgentResult>;
  steerPlacedAgent(args: { key: string; agentKey: string; message: string }, context: Context): Promise<boolean>;
};

export async function openStellaHarness(options: StellaHarnessOptions, context: Context): Promise<OpenStellaHarness> {
  const registry = createRegistry();
  registry.install(stellaPromptExtension(options.sources));
  const agents = stellaAgents(options.agents);
  registry.install(agents.extension);
  registry.install(StellaCoding);
  const refreshTools = () => {
    for (const extension of stellaToolExtensions(options.tools)) registry.install(extension);
  };
  refreshTools();
  for (const extension of options.extensions ?? []) registry.install(extension);
  const base = options.settings ?? stellaHarnessSettings();
  const settings: HarnessSettings = {
    ...base,
    get extensions() {
      return (base.extensions ?? registry.snapshot().installed()).filter(
        (extension) => extension.name !== CLAUDE_CODE_ENGINE_EXTENSION,
      );
    },
  };
  const harness = await Harness.open(
    options.storage,
    {
      models: options.models,
      registry,
      settings,
      ...(options.env ? { env: options.env } : {}),
      onReport: options.onReport ?? ((error) => console.error("[stella-agent]", error)),
    },
    context,
  );
  return {
    harness,
    registry,
    refreshTools,
    startAgent: (args, startContext) => agents.startAgent(harness, args, startContext),
    agentRecords: (recordsContext) => agents.agentRecords(harness, recordsContext),
    messageAgent: (args, messageContext) => agents.messageAgent(harness, args, messageContext),
    stopAgent: (threadId, stopContext) => agents.stopAgentByThread(harness, threadId, stopContext),
    agentStanding: (threadId, standingContext) => agents.agentStanding(harness, threadId, standingContext),
    runPlacedAgent: (args, runContext) => agents.runPlacedAgent(harness, args, runContext),
    steerPlacedAgent: (args, steerContext) => agents.steerPlacedAgent(harness, args, steerContext),
    markCatchUp: (threadId, markContext) => agents.markCatchUp(harness, threadId, markContext),
  };
}
