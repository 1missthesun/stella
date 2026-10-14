import { BACKGROUND_CONTEXT, withAbortSignal } from "@earendil-works/chord/context";
import type { Context } from "@earendil-works/chord";
import type { Api, Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { normalizeReasoningEffortLevel } from "@stella/contracts/reasoning-effort";
import { CLOUD_SANDBOX_SUBSCRIPTION_REQUIRED_MESSAGE } from "@stella/contracts/backend/billing";
import { parseReminderCard, reminderAssistantMessage } from "@stella/contracts/reminders";
import {
  AssistantEntry,
  type EntryId,
  LiveDoc,
  ProviderDoc,
  watchEvents,
  type AgentEventStream,
  type Conversation,
  type ConversationId,
  type EntryRecord,
  type Harness,
  type SettledSubmissionRecord,
} from "@earendil-works/pi-durable";
import { openDurableObjectSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/cloudflare";
import {
  offersAgentTools,
  openStellaHarness,
  orchestratorAgent,
  stellaModelRef,
  type OpenStellaHarness,
} from "@stella/agent/harness";
import { CHATGPT_PROVIDER_ID, chatGptModel, chatGptProvider } from "@stella/agent/provider/chatgpt";
import {
  CLAUDE_CODE_PROVIDER_ID,
  createClaudeCodeEngine,
  type ClaudeCodeEngine,
  type ClaudeCodeSessionRecord,
  type ClaudeCodeTransport,
} from "@stella/agent/engine/claude-code";
import { accountByokProvider, accountProviderModel } from "@stella/agent/provider/account-byok";
import {
  STELLA_PROVIDER_ID,
  stellaModelId,
  stellaProvider,
  type StellaGatewayAccess,
  type StellaModelSpec,
  type StellaRequestRoute,
} from "@stella/agent/provider/stella";
import { StellaAgentDoc } from "@stella/agent/stella/agent-doc";
import { ownHistoryQuery } from "@stella/agent/stella/own-history";
import {
  AGENT_MOVE_CLOUD,
  deviceRefusal,
  deviceStanding,
  movedAgentBrief,
  type AgentMove,
  type StellaExecutionHost,
} from "@stella/agent/stella/execution";
import { agentLogSync, importAgentLog, type AgentLogTransport } from "@stella/agent/stella/agent-log-sync";
import { agentMoveModel } from "@stella/agent/stella/agent-move-model";
import { sha256Hex } from "./hash.js";
import { AGENT_LOG_CLOUD_HOLDER, type AgentLogCalls } from "@stella/contracts/backend/agent-logs";
import type { AgentLineage } from "@stella/contracts/agent-depth";
import type { AgentThreadCalls } from "@stella/contracts/backend/agent-threads";
import type { RpcResponse } from "@stella/contracts/backend/protocol";
import { findDeviceDestination } from "@stella/contracts/turn-plane/placement";
import type { PiBrainHost } from "@stella/contracts/turn-plane/pi-brain";
import {
  agentRunOutcome,
  StellaAgentsDoc,
  type AgentNote,
  type AgentOrigin,
  type AgentReport,
  type AgentRun,
  type AgentDirectoryHost,
  type AgentRunEnd,
  type RemoteAgentHost,
  type StellaAgentsHost,
} from "@stella/agent/stella/agents";
import type {
  AgentDirectoryAgentRow,
  AgentDirectorySessionRow,
  AgentMessageSender,
} from "@stella/contracts/agent-directory";
import type { AgentMessageDelivery, AgentStopResult } from "@stella/contracts/backend/agent-threads";
import {
  STELLA_HARNESS_TOOL_NAMES,
  type StellaToolHost,
  type StellaToolOutcome,
  type StellaToolSpec,
} from "@stella/agent/stella/host-tools";
import type { StellaContextSources, StellaMemory } from "@stella/agent/stella/context";
import {
  alignJournalContext,
  checkpointToPublish,
  importJournal,
  adoptJournalCheckpoint,
  journalImportAfter,
  JournalSyncDoc,
  noteCheckpointPublished,
  recordEngineCompaction,
  type JournalMessage,
  type JournalStart,
} from "@stella/agent/stella/journal-sync";
import { fitForHandover } from "@stella/agent/stella/handover";
import type { JournalCheckpointFirstKept } from "@stella/contracts/journal-checkpoint";
export { journalSeqOf } from "@stella/agent/stella/journal-sync";
import type { AgentModelReasoningEffort, CloudExecutionSelection } from "@stella/contracts/agent-engine";
import type { AgentActivityEntry } from "@stella/contracts/conversation-agent-activity";
import type { ExecutionContextSnapshot } from "@stella/contracts/execution-context";
import {
  mergePiEntries,
  piEntriesForClients,
  piEventsForClients,
  type PiChatEvent,
  type PiEntry,
} from "@stella/contracts/pi-chat";
import { gatewayRelayBaseUrl } from "@stella/contracts/gateway/api";
import type { ManagedModelAudience } from "@stella/contracts/gateway/capability";
import { toolRequiresExplicitApproval } from "@stella/runtime/kernel/tools/code-tool.js";
import { isAgentToolSuspendedError } from "@stella/runtime/kernel/agent-core/suspension.js";
import type { CloudBrowserResumeReceipt, CloudBrowserSuspension } from "@stella/contracts/cloud-browser";
import { mintTurnCapability } from "./capability-signer.js";
import {
  cancelGatewayHandoff,
  createCloudBrowserClient,
  gatewayBrowserTransport,
  type CloudBrowserAuthority,
  type CloudBrowserClient,
} from "./cloud-browser.js";
import type { CloudCodeSourceAgentTool, CloudHistoryClient } from "./cloud-code-tool.js";
import {
  fetchWithManagedCancellation,
  type ModelGatewayControl,
} from "./managed-request-cancellation.js";
import { bundledPrompt } from "./prompts/bundled.js";
import type {
  SerializedAgentToolResult,
} from "@stella/executor-cloud/attached-tool-protocol";
import { generalAgentWorldGuidance } from "@stella/executor-cloud/general-agent-prompt";
import { extractDriveLinkPaths, extractLocalFileLinkPaths } from "@stella/contracts/local-file-links";
import { TURN_BROKER_HEADERS } from "@stella/contracts/turn-credential-broker";
import { serveTurnDriveRequest } from "./build-session/turn-broker.js";
import {
  forgetPiCompute,
  openPiComputeLease,
  piBrokerSessionId,
  piComputeKey,
  releasePiCompute,
  type PiComputeHost,
  type PiComputeLease,
  type PiComputeOwner,
  type PiComputeRecord,
} from "./pi-agent-compute.js";
import { piAttachedCoding, type PiAttachedToolCall } from "./pi-attached-tools.js";
import { WORLD_ROOT } from "./workspace.js";
import {
  claimTurnBrokerRequest,
  preflightTurnBrokerRequest,
  TurnBrokerBodyTooLargeError,
  readTurnBrokerRequestBody,
  turnBrokerDenialResponse,
  turnBrokerStorageKey,
  turnBrokerTargetMatchesEngine,
  type TurnBrokerRecord,
} from "./turn-credential-broker.js";
import { ownerGateStub } from "./rpc-release.js";
import { BROWSER_BUDGET_MESSAGE } from "./browser-billing.js";
import { containerBudgetMessage } from "./container-meter.js";

/** How long recovered work waits for its turn or agent run to bind a transport. */
const BINDING_WAIT_MS = 120_000;
const CAPABILITY_RENEW_MS = 60_000;
const BROWSER_BUDGET_CHECK_MS = 60_000;
const CONTAINER_SLOT_WAIT_MS = 10 * 60_000;
const CONTAINER_SLOT_POLL_MS = 5_000;
const ORIGIN_STOP_HOLD_MS = 5_000;
const PI_AGENT_STATE_KEY = "piAgentState";
const CLIENT_HISTORY_PAGE = 200;
const CLIENT_FRAME_BYTES = 512 * 1024;

export type PiExecution = CloudExecutionSelection;

const CLAUDE_CODE_SCOPE = "cloud";
const CLAUDE_CODE_SESSION_KEY = "claudeCodeSession:";

export type PiAuthority = {
  ownerId: string;
  ownerGeneration: string;
  conversationId: string;
  audience: ManagedModelAudience;
  budgetMicroCents: number;
  execution: PiExecution;
};

type PiAgentState = {
  version: 1;
  authority: PiAuthority;
  models: StellaModelSpec[];
  skillsCatalog?: string;
  executionContext: ExecutionContextSnapshot;
  tools?: StellaToolSpec[];
  agentTools?: StellaToolSpec[];
  locale?: string;
  lastTurnId?: string;
};

export type PiDeviceAgents = {
  start(
    args: { key: string; deviceId: string; description: string; prompt: string; model?: string; parentThreadId?: string },
    authority: PiAuthority,
    parentTurnId: string,
  ): Promise<{ threadId: string; waiting?: boolean }>;
  message(
    args: { key: string; threadId: string; message: string },
    authority: PiAuthority,
    parentTurnId: string,
  ): Promise<AgentMessageDelivery | undefined>;
  stop(args: { key: string; threadId: string }, authority: PiAuthority, parentTurnId: string): Promise<AgentStopResult | void>;
};

export type PiThreadAgents = {
  check(model: string, authority: PiAuthority): void;
  start(
    args: {
      key: string;
      description: string;
      prompt: string;
      model: string;
      workspace?: import("@stella/contracts/turn-plane/turn-start").AgentWorkspaceSize;
    },
    authority: PiAuthority,
    parentTurnId: string,
  ): Promise<{ threadId: string }>;
  message(args: { key: string; threadId: string; message: string }, authority: PiAuthority, parentTurnId: string): Promise<void>;
  stop(args: { key: string; threadId: string }, authority: PiAuthority, parentTurnId: string): Promise<AgentStopResult | void>;
};

const THREAD_AGENT_ENGINE = "agent-thread";

export type PiAgentLedgerEvent = {
  threadId: string;
  attempt: number;
  description: string;
  parentThreadId?: string;
  depth: number;
  turnId: string;
  authority: PiAuthority;
  ended?: { outcome: import("@stella/contracts/agent-status").AgentAttemptOutcome; text?: string };
};

export type PiAgentInfo = {
  description: string;
  attempt: number;
  origin?: AgentOrigin;
  files?: PiDeliveredFile[];
  running?: boolean;
};

export type PiDeliveredFile = { path: string; name: string; sizeBytes: number; contentType: string };

export type PiAgentFileDelivery = { threadId: string; deliver: (files: PiDeliveredFile[]) => Promise<void> };

export type PiThreadReport = {
  threadId: string;
  requestId: string;
  text: string;
  status?: import("@stella/contracts/agent-status").AgentAttemptOutcome;
  settled?: true;
  attemptGeneration?: number;
  files?: PiDeliveredFile[];
};

export type PiTurnSources = {
  orchestratorPrompt: string;
  personality: string | undefined;
  memory: StellaMemory;
  skillsCatalog: string | undefined;
  executionContext: ExecutionContextSnapshot;
  locale?: string;
  history?: boolean;
};

export type PiTurnBinding = {
  turnId: string;
  capability: string;
  fetch: typeof fetch;
  authority: PiAuthority;
  stellaModels?: { model: StellaModelSpec; agentModel: StellaModelSpec };
  thinkingLevel: ModelThinkingLevel;
  sources: PiTurnSources;
  tools(): Promise<readonly CloudCodeSourceAgentTool[]>;
};

export type PiRuntimeEnv = Pick<
  Cloudflare.Env,
  "OWNER_GATES" | "WORLDS" | "BUILDER_SERVICE_SECRET"
> &
  Partial<
    Pick<
      Cloudflare.Env,
      | "Sandbox"
      | "MODEL_GATEWAY"
      | "MODEL_GATEWAY_CONTROL"
      | "CAPABILITY_SIGNING_KEY"
      | "CAPABILITY_SIGNING_KID"
      | "SANDBOX_IDLE_TIMEOUT_MS"
      | "CLOUD_BUILDER_PUBLIC_URL"
      | "BROWSER_GATEWAY"
    >
  >;

export type PiBrowserHandoff = {
  authority: PiAuthority;
  browser: CloudBrowserAuthority;
  toolCallId: string;
  suspension: CloudBrowserSuspension;
};

export type PiBrowserHandoffEnd = Pick<CloudBrowserResumeReceipt, "result" | "safeMessage">;

export type PiRuntimeOptions = {
  storage: DurableObjectStorage;
  env: PiRuntimeEnv;
  gatewayOrigin: string;
  journalStart(): Promise<JournalStart>;
  archivedEntries?: {
    read(
      piConversationId: number,
      options?: { beforeId?: number; limit?: number },
    ): Promise<{ entries: ReadonlyArray<{ id: number; record: unknown }>; hasOlder: boolean }>;
    has(piConversationId: number, beforeId?: number): boolean;
  };
  waitUntil(work: Promise<unknown>): void;
  report(error: unknown): void;
  log(event: string, fields: Record<string, unknown>): void;
  deliverNote(note: AgentNote, authority: PiAuthority): Promise<void>;
  noteLedgerReport(report: AgentReport, turnId: string, agent: PiAgentInfo): void;
  deliverThreadReport?(report: PiThreadReport): Promise<void>;
  agentStarted?(event: PiAgentInfo & { threadId: string; turnId: string }): void;
  agentStopped?(event: PiAgentInfo & { threadId: string; turnId: string }): void;
  agentsChanged?(): void;
  agentLedger?(event: PiAgentLedgerEvent): void;
  deviceAgents?: PiDeviceAgents;
  threadAgents?: PiThreadAgents;
  agentDirectory?: {
    list(
      authority: PiAuthority,
      threadIds?: string[],
    ): Promise<{ agents: AgentDirectoryAgentRow[]; sessions: AgentDirectorySessionRow[] }>;
    message(
      authority: PiAuthority,
      args: { messageId: string; to: string; text: string; from: AgentMessageSender },
    ): Promise<AgentMessageDelivery>;
    stop(
      authority: PiAuthority,
      args: { controlRequestId: string; threadId: string; requesterThreadId?: string },
    ): Promise<AgentStopResult>;
  };
  moveBrain?(authority: PiAuthority, host: Extract<PiBrainHost, { host: "device" }>, brief: string): Promise<void>;
  heartbeat(): void;
  agentTools(
    authority: PiAuthority,
    browser?: CloudBrowserClient,
    history?: CloudHistoryClient,
    delivery?: PiAgentFileDelivery,
  ): Promise<readonly CloudCodeSourceAgentTool[]>;
  browserHandoff?(handoff: PiBrowserHandoff, signal: AbortSignal | undefined): Promise<PiBrowserHandoffEnd>;
  agentGuard?(authority: PiAuthority, turnId: string): Promise<PiAgentGuard>;
  claudeCode?: ClaudeCodeTransport & {
    resolvedModel?(alias: string): string | undefined;
    contextWindow?(model: string): number | undefined;
  };
};

export type PiToolActivity = {
  toolCallId: string;
  name: string;
  phase: "start" | "end";
  args?: unknown;
  isError?: boolean;
};

export type PiAgentGuard = {
  fetch(request: Request): Promise<Response>;
  release(): Promise<void>;
};

export const contextFor = (signal?: AbortSignal): Context =>
  signal ? withAbortSignal(signal, BACKGROUND_CONTEXT) : BACKGROUND_CONTEXT;

export const thinkingLevelFor = (effort: AgentModelReasoningEffort | string): ModelThinkingLevel =>
  effort === "none" ? "off" : normalizeReasoningEffortLevel(effort);

const MEMORY_FIELDS: Record<string, keyof Omit<StellaMemory, "enabled">> = {
  "~/.stella/memories/main.md": "main",
};

export const memoryFromDocuments = (
  enabled: boolean,
  documents: ReadonlyArray<{ displayPath: string; content: string }>,
): StellaMemory => {
  const memory: StellaMemory = { enabled };
  if (!enabled) return memory;
  for (const document of documents) {
    const field = MEMORY_FIELDS[document.displayPath];
    if (field && document.content.trim()) memory[field] = document.content;
  }
  return memory;
};

export const assistantText = (entry: EntryRecord | undefined): string => {
  const message = entry?.model?.[0];
  if (message?.role !== "assistant") return "";
  return message.content.map((part) => (part.type === "text" ? part.text : "")).join("");
};

const withBearer = (request: Request, capability: string): Request => {
  const headers = new Headers(request.headers);
  headers.set("authorization", `Bearer ${capability}`);
  return new Request(request, { headers });
};

const waitFor = async (ms: number, signal?: AbortSignal): Promise<void> => {
  signal?.throwIfAborted();
  await scheduler.wait(ms);
  signal?.throwIfAborted();
};

type ActiveRun = {
  run: AgentRun;
  authority: PiAuthority;
  turnId: string;
  sessionId: string;
  capability: { token: string; expiresAt: number };
  guard?: PiAgentGuard;
  browser?: CloudBrowserClient;
  startedAt: number;
};

type AgentLease = {
  lease: PiComputeLease;
  threadId: string;
  inFlight: number;
  used: boolean;
  linked: Set<string>;
};

const BROWSER_CHECKPOINT_MS = 30_000;

const LEASE_RENEW_MS = 3 * 60_000;
const LEASE_STOP_WAIT_MS = 30_000;
const deliveredFilesKey = (threadId: string) => `piAgentFiles:${threadId}`;
const REPORT_FILES_WAIT_MS = 15 * 60_000;

const answerLinkedPaths = (answer: string): string[] => [
  ...extractLocalFileLinkPaths(answer).map((linkedPath) =>
    linkedPath === "~" || linkedPath.startsWith("~/") ? `${WORLD_ROOT}${linkedPath.slice(1)}` : linkedPath,
  ),
  ...extractDriveLinkPaths(answer).map((drivePath) => `${WORLD_ROOT}/drive/${drivePath}`),
];
const threadCallKey = (threadId: string, attemptGeneration: number) => `thread:${threadId}:${attemptGeneration}`;
const THREAD_AGENT_PREFIX = "piThreadAgent:";

type ThreadAgent = { authority: PiAuthority; model?: StellaModelSpec };

const planModels = (executions: Iterable<PiExecution | undefined>): Model<"openai-responses">[] => {
  const plans = new Map<string, Model<"openai-responses">>();
  for (const execution of executions) {
    if (execution?.engine !== "chatgpt" || plans.has(execution.model)) continue;
    const plan = chatGptModel(execution.model);
    if (plan) plans.set(execution.model, plan);
  }
  return [...plans.values()];
};

const providerModels = (executions: Iterable<PiExecution | undefined>): Map<string, Model<Api>[]> => {
  const byProvider = new Map<string, Model<Api>[]>();
  for (const execution of executions) {
    if (execution?.engine !== "provider") continue;
    const models = byProvider.get(execution.provider) ?? [];
    if (models.some((model) => model.id === execution.model)) continue;
    const model = accountProviderModel(execution.provider, execution.model);
    if (!model) continue;
    models.push(model);
    byProvider.set(execution.provider, models);
  }
  return byProvider;
};

const brokerFailure = (status: number): Response =>
  Response.json({ error: "Turn broker request failed." }, { status, headers: { "cache-control": "no-store" } });

type Opened = {
  harness: Harness;
  root: Conversation;
  rootSession: string;
  refreshTools(): void;
  agents: Pick<OpenStellaHarness, "startAgent" | "messageAgent" | "stopAgent" | "agentStanding" | "markCatchUp">;
};

const toolSpec = (tool: CloudCodeSourceAgentTool): StellaToolSpec => ({
  name: tool.name,
  description: tool.description,
  parameters: tool.parameters as unknown as Record<string, unknown>,
  ...(tool.replay ? { replay: tool.replay } : {}),
  ...(tool.demoted && !toolRequiresExplicitApproval(tool.approval)
    ? { codeOnly: { ...(tool.demoted.searchTerms ? { searchTerms: tool.demoted.searchTerms } : {}) } }
    : {}),
});

export type JournalRecordLike = {
  seq: number;
  kind: string;
  turnId: string;
  createdAtMs?: number;
  role?: "user" | "assistant" | "toolResult";
  hidden?: boolean;
  payload?: unknown;
  card?: unknown;
};

export class PiConversationRuntime {
  readonly #options: PiRuntimeOptions;
  readonly #models = createModels();
  readonly #claudeCode: ClaudeCodeEngine | undefined;
  #opening: Promise<Opened> | undefined;
  #binding: PiTurnBinding | undefined;
  #turnTools: { binding: PiTurnBinding; tools: Promise<readonly CloudCodeSourceAgentTool[]> } | undefined;
  #state: PiAgentState | undefined;
  readonly #threadAgents = new Map<string, ThreadAgent>();
  #modelKey: string | undefined;
  readonly #runs = new Map<string, ActiveRun[]>();
  readonly #leases = new Map<number, Promise<AgentLease>>();
  readonly #ending = new Map<string, { runs: number; ended: Promise<void>; resolve: () => void }>();
  readonly #live = new Map<string, AgentLease>();
  #brokerClaims: Promise<unknown> = Promise.resolve();
  readonly #waiting = new Map<string, Set<() => void>>();
  #clientStream: AgentEventStream | undefined;
  #harnessRef: Harness | undefined;
  readonly #agentLog = agentLogSync({
    harness: () => this.#harnessRef,
    transport: () => this.#agentLogTransport(),
    report: (error) => this.#options.report(error),
    onAppend: (stat) => this.#options.log("pi_agent_log_append", stat),
    context: BACKGROUND_CONTEXT,
  });

  constructor(options: PiRuntimeOptions) {
    this.#options = options;
    const transport = options.claudeCode;
    if (transport) {
      const engine = createClaudeCodeEngine({
        transport,
        builtins: "never",
        resolveModel: (alias) => transport.resolvedModel?.(alias),
        reportedContextWindow: (model) => transport.contextWindow?.(model),
        sessions: {
          read: async (piSessionId) =>
            await options.storage.get<ClaudeCodeSessionRecord>(`${CLAUDE_CODE_SESSION_KEY}${piSessionId}`),
          write: async (piSessionId, record) => {
            await options.storage.put(`${CLAUDE_CODE_SESSION_KEY}${piSessionId}`, record);
          },
        },
        report: options.report,
      });
      this.#models.setProvider(engine.provider());
      engine.onProviderChange((provider) => this.#models.setProvider(provider));
      engine.onStatus((session, status) =>
        options.log("claude_code_status", { role: session.role, state: status.state }),
      );
      engine.onCompaction((session, compaction) => {
        if (session.role !== "orchestrator" || session.threadId) return;
        void (async () => {
          const { harness, root } = await this.open();
          const recorded = await recordEngineCompaction(
            harness,
            root,
            { ...compaction, engine: "claude-code" },
            contextFor(),
          );
          options.log("claude_code_compaction_recorded", { recorded, summaryChars: compaction.summary.length });
        })().catch((error: unknown) => options.report(error));
      });
      this.#claudeCode = engine;
    }
  }

  async boundTurn(signal: AbortSignal): Promise<PiTurnBinding> {
    return await this.#turn(signal);
  }

  stopClaudeCode(): void {
    this.#claudeCode?.abort(CLAUDE_CODE_SCOPE, { agents: true });
  }

  #notify(key: string): void {
    const waiters = this.#waiting.get(key);
    if (!waiters) return;
    this.#waiting.delete(key);
    for (const ready of waiters) ready();
  }

  /** Wait until `ready()` has an answer, for at most {@link BINDING_WAIT_MS}. */
  async #await<T>(key: string, ready: () => T | undefined, refusal: string, signal?: AbortSignal | null): Promise<T> {
    const now = ready();
    if (now !== undefined) return now;
    const timeout = AbortSignal.timeout(BINDING_WAIT_MS);
    const stop = signal ? AbortSignal.any([signal, timeout]) : timeout;
    return await new Promise<T>((resolve, reject) => {
      let waiters = this.#waiting.get(key);
      if (!waiters) this.#waiting.set(key, (waiters = new Set()));
      const onStop = () => {
        waiters.delete(wake);
        reject(signal?.aborted ? (signal.reason ?? new Error("aborted")) : new Error(refusal));
      };
      const wake = () => {
        const value = ready();
        if (value === undefined) {
          let next = this.#waiting.get(key);
          if (!next) this.#waiting.set(key, (next = new Set()));
          next.add(wake);
          return;
        }
        stop.removeEventListener("abort", onStop);
        resolve(value);
      };
      if (stop.aborted) return onStop();
      stop.addEventListener("abort", onStop, { once: true });
      waiters.add(wake);
    });
  }

  #turn(signal?: AbortSignal | null): Promise<PiTurnBinding> {
    return this.#await("root", () => this.#binding, "No Stella turn is running to carry this model request.", signal);
  }

  #agentRun(sessionId: string, signal?: AbortSignal | null): Promise<ActiveRun> {
    return this.#await(
      sessionId,
      () => this.#runs.get(sessionId)?.at(-1),
      "This agent has no admitted run to carry its model request.",
      signal,
    );
  }

  async #runCapability(active: ActiveRun): Promise<string> {
    if (active.capability.expiresAt - Date.now() > CAPABILITY_RENEW_MS) return active.capability.token;
    active.capability = await this.#mint(active.authority, active.turnId);
    return active.capability.token;
  }

  async #mint(authority: PiAuthority, turnId: string): Promise<{ token: string; expiresAt: number }> {
    const execution = authority.execution;
    if (execution.engine === "anthropic") throw new Error("Agents of a Claude Code turn run in containers of their own.");
    const minted = await mintTurnCapability(this.#options.env, {
      ownerId: authority.ownerId,
      ownerGeneration: authority.ownerGeneration,
      turnId,
      conversationId: authority.conversationId,
      execution,
      audience: authority.audience,
      budgetMicroCents: authority.budgetMicroCents,
      agentTypes: ["general"],
    });
    return { token: minted.token, expiresAt: minted.expiresAt };
  }

  async #agentFetch(active: ActiveRun, request: Request): Promise<Response> {
    const { env } = this.#options;
    const gateway = env.MODEL_GATEWAY;
    const control = env.MODEL_GATEWAY_CONTROL;
    if (!gateway || !control) throw new Error("Model gateway is not configured.");
    const capability = await this.#runCapability(active);
    const send = (value: Request) => (active.guard ? active.guard.fetch(value) : gateway.fetch(value));
    if (active.authority.execution.engine !== "stella") return await send(withBearer(request, capability));
    return await fetchWithManagedCancellation({
      request: withBearer(request, capability),
      capability,
      control: control as unknown as ModelGatewayControl,
      waitUntil: (work) => this.#options.waitUntil(work),
      fetch: send,
    });
  }

  #access(): StellaGatewayAccess {
    return {
      relayBaseUrl: gatewayRelayBaseUrl(this.#options.gatewayOrigin),
      capability: async () => "stella-routed",
      fetch: async (input: string | URL | Request, init?: RequestInit, route?: StellaRequestRoute) => {
        const request = input instanceof Request ? new Request(input, init) : new Request(String(input), init);
        const { rootSession } = await this.open();
        if (!route?.sessionId || route.sessionId === rootSession) {
          const turn = await this.#turn(request.signal);
          return await turn.fetch(withBearer(request, turn.capability));
        }
        return await this.#agentFetch(await this.#agentRun(route.sessionId, request.signal), request);
      },
    };
  }

  async #agentState(): Promise<PiAgentState> {
    this.#state ??= await this.#options.storage.get<PiAgentState>(PI_AGENT_STATE_KEY);
    if (!this.#state) throw new Error("No Stella turn has run in this conversation yet.");
    return this.#state;
  }

  #setModels(state: Pick<PiAgentState, "models" | "authority"> | undefined): void {
    if (!state && this.#threadAgents.size === 0) return;
    const models = [...(state?.models ?? [])];
    for (const { model } of this.#threadAgents.values()) {
      if (model && !models.some((known) => known.agentType === model.agentType && known.alias === model.alias)) {
        models.push(model);
      }
    }
    const executions = [
      state?.authority.execution,
      ...[...this.#threadAgents.values()].map((agent) => agent.authority.execution),
    ];
    const plans = planModels(executions);
    const byok = providerModels(executions);
    const key = JSON.stringify([
      models,
      plans.map((plan) => plan.id),
      [...byok].map(([provider, entries]) => [provider, entries.map((entry) => entry.id)]),
    ]);
    if (key === this.#modelKey) return;
    const access = this.#access();
    this.#models.setProvider(stellaProvider({ access, models }));
    if (plans.length > 0) {
      this.#models.setProvider(
        chatGptProvider({
          models: plans,
          transport: { baseUrl: access.relayBaseUrl, fetch: (request, route) => access.fetch(request, undefined, route) },
        }),
      );
    }
    for (const [providerId, entries] of byok) {
      this.#models.setProvider(
        accountByokProvider({
          providerId,
          models: entries,
          transport: {
            gatewayOrigin: this.#options.gatewayOrigin,
            fetch: (request, route) => access.fetch(request, undefined, route),
          },
        }),
      );
    }
    this.#modelKey = key;
  }

  #rootModel(execution: PiExecution) {
    if (execution.engine === "anthropic") {
      if (!this.#claudeCode) throw new Error("Claude Code can't run in this conversation's cloud.");
      return this.#claudeCode.ensureModel(execution.model);
    }
    return execution.engine === "chatgpt"
      ? { provider: CHATGPT_PROVIDER_ID, modelId: execution.model }
      : execution.engine === "provider"
        ? { provider: execution.provider, modelId: execution.model }
        : stellaModelRef("orchestrator", execution.model);
  }

  #sources(): StellaContextSources {
    const turn = async (): Promise<PiTurnSources> => (await this.#turn()).sources;
    return {
      env: "cloud",
      agentPrompt: async (id) =>
        id === "agents/orchestrator.md"
          ? (await turn()).orchestratorPrompt
          : id === "agents/general.md"
            ?
              `${bundledPrompt(id).trim()}\n\n${generalAgentWorldGuidance()}`
            : bundledPrompt(id),
      personality: async () => (await turn()).personality,
      memory: async () => (await turn()).memory,
      skillsCatalog: async () => this.#binding?.sources.skillsCatalog ?? (await this.#agentState()).skillsCatalog,
      executionContext: async () =>
        this.#binding?.sources.executionContext ?? (await this.#agentState()).executionContext,
      locale: async () => (this.#binding ? this.#binding.sources.locale : (await this.#agentState()).locale),
      codeHistory: async (agentType) => {
        if (agentType !== "orchestrator") return true;
        const sources = await turn();
        return sources.history ?? sources.memory.enabled;
      },
    };
  }

  #turnToolsFor(binding: PiTurnBinding): Promise<readonly CloudCodeSourceAgentTool[]> {
    if (this.#turnTools?.binding !== binding) {
      const tools = binding.tools();
      this.#turnTools = { binding, tools };
      tools.catch(() => {
        if (this.#turnTools?.tools === tools) this.#turnTools = undefined;
      });
    }
    return this.#turnTools.tools;
  }

  #tools(): StellaToolHost {
    return {
      specs: (role) => (role === "orchestrator" ? this.#state?.tools : this.#state?.agentTools) ?? [],
      run: async (call, context) => {
        const signal = context.abortSignal;
        const active = call.role === "orchestrator" ? undefined : this.#runOf(call.threadId);
        const tools =
          call.role === "orchestrator"
            ? await this.#turnToolsFor(await this.#turn(signal))
            : await this.#options.agentTools(
                (await this.#agentState()).authority,
                this.#browser(active),
                call.threadId ? this.#ownHistory(call.threadId) : undefined,
                call.threadId ? this.#fileDelivery(call.threadId) : undefined,
              );
        const tool = tools.find((candidate) => candidate.name === call.name);
        if (!tool) throw new Error(`${call.name} is not available here.`);
        const started = Date.now();
        const fields = { role: call.role, tool: call.name, callId: call.callId };
        try {
          const result = await tool.execute(call.callId, call.args, signal);
          this.#options.log("pi_tool_ran", { ...fields, ms: Date.now() - started });
          return {
            content: result.content as StellaToolOutcome["content"],
            details: result.details,
          };
        } catch (error) {
          if (isAgentToolSuspendedError(error) && active) {
            return await this.#handBrowserToUser(active, call.callId, error.suspension, signal);
          }
          this.#options.log("pi_tool_failed", {
            ...fields,
            ms: Date.now() - started,
            message: error instanceof Error ? error.message : String(error),
          });
          throw error;
        }
      },
    };
  }

  #ownHistory(threadId: string): CloudHistoryClient {
    const query = async (args: Record<string, unknown>) => {
      const { harness, root } = await this.open();
      const archive = this.#options.archivedEntries;
      return await ownHistoryQuery(
        harness,
        root.id,
        threadId,
        args,
        BACKGROUND_CONTEXT,
        undefined,
        archive
          ? async (conversationId) =>
              (await archive.read(conversationId)).entries.map((entry) => entry.record as EntryRecord)
          : undefined,
      );
    };
    return {
      search: (text, options) => query({ op: "search", text, options }),
      read: (fromSeq, toSeq) => query({ op: "read", fromSeq, toSeq }),
      sql: () => {
        throw new Error("history.sql is not available for your thread here; use history.search and history.read.");
      },
    };
  }

  #runOf(threadId: string | undefined): ActiveRun | undefined {
    if (!threadId) return undefined;
    for (const runs of this.#runs.values()) {
      const active = runs.find((candidate) => candidate.run.threadId === threadId);
      if (active) return active;
    }
    return undefined;
  }

  #browser(active: ActiveRun | undefined): CloudBrowserClient | undefined {
    const gateway = this.#options.env.BROWSER_GATEWAY;
    if (!gateway || !this.#options.browserHandoff) return undefined;
    if (!active) {
      return createCloudBrowserClient(async () => {
        throw new Error("The cloud browser is only available while this agent is running.");
      });
    }
    if (active.browser) return active.browser;
    const transport = gatewayBrowserTransport(gateway, this.#browserAuthority(active));
    let budgetCheckedAt = 0;
    active.browser = createCloudBrowserClient(async (command, signal) => {
      if (command.action !== "browser.close" && Date.now() - budgetCheckedAt > BROWSER_BUDGET_CHECK_MS) {
        const access = await ownerGateStub(this.#options.env.OWNER_GATES, active.authority.ownerId).billingAccess();
        if (!access.allowed) throw new Error(access.usageLimit?.message || BROWSER_BUDGET_MESSAGE);
        budgetCheckedAt = Date.now();
      }
      const started = Date.now();
      const forwarded = await transport(command, signal);
      this.#options.log("pi_browser_command", {
        threadId: active.run.threadId,
        action: command.action,
        status: forwarded.status,
        ms: Date.now() - started,
      });
      return forwarded;
    });
    return active.browser;
  }

  #browserAuthority(active: ActiveRun): CloudBrowserAuthority {
    return {
      ownerId: active.authority.ownerId,
      ownerGeneration: active.authority.ownerGeneration,
      conversationId: active.authority.conversationId,
      threadId: active.run.threadId,
      turnId: active.turnId,
      attemptGeneration: 1,
    };
  }

  async #handBrowserToUser(
    active: ActiveRun,
    toolCallId: string,
    suspension: CloudBrowserSuspension,
    signal: AbortSignal | undefined,
  ): Promise<StellaToolOutcome> {
    const fields = {
      threadId: active.run.threadId,
      interactionId: suspension.interactionId,
      kind: suspension.interactionKind,
    };
    this.#options.log("pi_browser_handoff_started", fields);
    const browser = this.#browserAuthority(active);
    try {
      const end = await this.#options.browserHandoff!(
        { authority: active.authority, browser, toolCallId, suspension },
        signal,
      );
      this.#options.log("pi_browser_handoff_ended", { ...fields, result: end.result });
      return {
        content: [{ type: "text", text: end.safeMessage }],
        details: { browserHandoff: { interactionId: suspension.interactionId, result: end.result } },
        ...(end.result === "approved" ? {} : { isError: true }),
      };
    } catch (error) {
      const gateway = this.#options.env.BROWSER_GATEWAY;
      if (gateway) await cancelGatewayHandoff(gateway, browser, suspension).catch(() => undefined);
      this.#options.log("pi_browser_handoff_failed", {
        ...fields,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      active.browser?.resumed();
    }
  }

  async #providerSession(harness: Harness, conversationId: ConversationId, context: Context): Promise<string> {
    const existing = await harness.snapshot(ProviderDoc, conversationId, context);
    if (existing) return existing.sessionId;
    let created: string | undefined;
    await harness.commit(async (tx) => {
      created = (await tx.doc(ProviderDoc, conversationId)).sessionId;
      return undefined;
    }, context);
    if (!created) throw new Error(`Conversation ${conversationId} has no provider session.`);
    return created;
  }

  #gate(authority: PiAuthority) {
    return ownerGateStub(this.#options.env.OWNER_GATES, authority.ownerId);
  }

  #agents(): StellaAgentsHost {
    return {
      rootPlacement: { kind: "cloud" },
      place: (destination) => {
        if (destination.kind !== "device") return { kind: "cloud" };
        if (this.#options.deviceAgents) return { kind: "device", deviceId: destination.deviceId };
        return { error: `This conversation cannot start an agent on device ${destination.deviceId}.` };
      },
      remote: (placement) => (placement.kind === "device" ? this.#deviceAgentHost(placement.deviceId) : undefined),
      agentModel: async (requested, caller, placement) => {
        if (placement) return { there: true };
        if (requested.startsWith("stella/") && caller.model?.provider === STELLA_PROVIDER_ID) {
          const effort = /^(.+):(low|medium|high|xhigh|max)$/.exec(requested);
          const thinkingLevel = (effort?.[2] as ModelThinkingLevel | undefined) ?? caller.thinkingLevel;
          return {
            runsOn: {
              model: { provider: STELLA_PROVIDER_ID, modelId: stellaModelId("general", effort?.[1] ?? requested) },
              ...(thinkingLevel ? { thinkingLevel } : {}),
            },
          };
        }
        const threads = this.#options.threadAgents;
        if (!threads) throw new Error(`Agents here can't run on "${requested}". Omit model to use the configured one.`);
        threads.check(requested, (await this.#agentState()).authority);
        return { engine: THREAD_AGENT_ENGINE };
      },
      defaultAgentModel: (caller) => (caller.model?.provider === CLAUDE_CODE_PROVIDER_ID ? "default" : undefined),
      engine: (id) => (id === THREAD_AGENT_ENGINE ? this.#threadAgentHost() : undefined),
      execution: this.#execution(),
      agentLog: {
        kick: (conversationId) => this.#agentLog.kick(conversationId),
        importInto: async (agentConversationId, threadId, context) => {
          const harness = this.#harnessRef;
          const transport = this.#agentLogTransport();
          const conversation = harness ? await harness.conversation(agentConversationId, context) : undefined;
          if (!harness || !transport || !conversation) throw new Error("this conversation isn't open in the cloud yet.");
          return await importAgentLog(harness, conversation, transport, threadId, context);
        },
      },
      beginAgentRun: async (run, context) => {
        const authority = await this.#runAuthority(run, context);
        const turnId = `pi:${authority.conversationId}:${run.runId}`;
        const admission = await this.#gate(authority).admit({
          lane: "agent",
          turnId,
          conversationId: authority.conversationId,
          expectedGeneration: authority.ownerGeneration,
        });
        if (!admission.ok) throw new Error(admission.message);
        const { harness, root } = await this.open();
        const guard = await this.#options.agentGuard?.(authority, turnId).catch(async (error: unknown) => {
          await this.#gate(authority).release({ turnId }).catch(() => undefined);
          throw error;
        });
        const active: ActiveRun = {
          run,
          authority,
          turnId,
          sessionId: await this.#providerSession(harness, run.agentConversationId, context),
          capability: await this.#mint(authority, turnId),
          ...(guard ? { guard } : {}),
          startedAt: Date.now(),
        };
        const runs = this.#runs.get(active.sessionId) ?? [];
        runs.push(active);
        this.#runs.set(active.sessionId, runs);
        this.#runStarted(run.threadId);
        this.#notify(active.sessionId);
        this.#options.heartbeat();
        this.#options.log("pi_agent_run_started", { threadId: run.threadId, turnId });
        void this.#lease(run.agentConversationId as ConversationId, active, context).catch((error: unknown) =>
          this.#options.report(error),
        );
        await this.#recordAgentRun(run, authority, turnId, context).catch((error: unknown) => this.#options.report(error));
        if (run.parentConversationId !== root.id) return;
        const info = await this.#agentInfo(run.threadId, context);
        const cardTurnId = this.#cardTurnId(run.threadId, info);
        if (cardTurnId) this.#options.agentStarted?.({ threadId: run.threadId, turnId: cardTurnId, ...info });
        this.#options.agentsChanged?.();
      },
      agentStopped: async ({ threadId }, context) => {
        const info = await this.#agentInfo(threadId, context);
        const turnId = this.#cardTurnId(threadId, info);
        if (turnId) this.#options.agentStopped?.({ threadId, turnId, ...info });
      },
      endAgentRun: async (run, context, end) => {
        let ended: ActiveRun | undefined;
        for (const [sessionId, runs] of this.#runs) {
          const index = runs.findIndex((active) => active.run.runId === run.runId);
          if (index < 0) continue;
          [ended] = runs.splice(index, 1);
          if (runs.length === 0) this.#runs.delete(sessionId);
          break;
        }
        if (run.parentConversationId === (await this.open()).root.id) this.#options.agentsChanged?.();
        if (ended?.browser?.used()) {
          await ended.browser
            .checkpoint(AbortSignal.timeout(BROWSER_CHECKPOINT_MS))
            .catch((error: unknown) => this.#options.report(error));
        }
        try {
          const busy = [...this.#runs.values()].some((runs) =>
            runs.some((active) => active.run.agentConversationId === run.agentConversationId),
          );
          if (!busy) {
            await this.#endLease(run.agentConversationId, end ?? {}).catch((error: unknown) => this.#options.report(error));
          } else if (end?.answer) {
            const held = await this.#leases.get(run.agentConversationId)?.catch(() => undefined);
            for (const linkedPath of answerLinkedPaths(end.answer)) held?.linked.add(linkedPath);
          }
        } finally {
          if (ended) this.#runEnded(ended.run.threadId);
        }
        await ended?.guard?.release().catch((error: unknown) => this.#options.report(error));
        const authority = ended?.authority ?? this.#state?.authority;
        if (!authority) return;
        const outcome = agentRunOutcome(end);
        if (outcome && !end?.waiting) {
          await this.#recordAgentRun(run, authority, ended?.turnId ?? `pi:${authority.conversationId}:${run.runId}`, context, outcome).catch(
            (error: unknown) => this.#options.report(error),
          );
        }
        await this.#gate(authority)
          .release({ turnId: ended?.turnId ?? `pi:${authority.conversationId}:${run.runId}` })
          .catch((error: unknown) => this.#options.report(error));
        this.#options.log("pi_agent_run_ended", { threadId: run.threadId, turnId: ended?.turnId });
      },
      reportsFromLedger: () => true,
      deliverReport: async (report, context) => {
        await this.#agentRunsEnded(report.threadId);
        const { authority } = await this.#agentState();
        if (report.origin) {
          const filesKey = deliveredFilesKey(report.threadId);
          const files = report.settled ? undefined : await this.#options.storage.get<PiDeliveredFile[]>(filesKey);
          const attemptGeneration = await this.#threadAttemptOf(report.requestId, context);
          await this.#options.deliverThreadReport?.({
            threadId: report.threadId,
            requestId: report.requestId,
            text: report.text,
            ...(report.status ? { status: report.status } : {}),
            ...(report.settled ? { settled: true as const } : {}),
            ...(attemptGeneration !== undefined ? { attemptGeneration } : {}),
            ...(files?.length ? { files } : {}),
          });
          if (files) await this.#options.storage.delete(filesKey);
          return;
        }
        if (report.settled) return;
        const filesKey = deliveredFilesKey(report.threadId);
        const files = await this.#options.storage.get<PiDeliveredFile[]>(filesKey);
        const info = await this.#agentInfo(report.threadId, context);
        this.#options.noteLedgerReport(
          report,
          this.#binding?.turnId ?? this.#state?.lastTurnId ?? `pi:${authority.conversationId}`,
          files?.length ? { ...info, files } : info,
        );
        this.#options.log("pi_agent_report_delivered", { threadId: report.threadId, files: files?.length ?? 0 });
        if (files) await this.#options.storage.delete(filesKey);
      },
      deliverNote: async (note) => {
        const { authority } = await this.#agentState();
        await this.#options.deliverNote(note, authority);
      },
      ...(this.#options.agentDirectory ? { directory: this.#directory(this.#options.agentDirectory) } : {}),
    };
  }

  #directory(threads: NonNullable<PiRuntimeOptions["agentDirectory"]>): AgentDirectoryHost {
    return {
      conversationId: async () => (await this.#agentState()).authority.conversationId,
      list: async (_context, options) => {
        const threadIds = options?.threadIds?.length ? options.threadIds : undefined;
        return {
          ...(await threads.list((await this.#agentState()).authority, threadIds)),
          ...(threadIds ? { threadIdsRead: true as const } : {}),
        };
      },
      message: async ({ key, to, text, from }) => {
        const { authority } = await this.#agentState();
        return await threads.message(authority, {
          messageId: `pi-msg:${authority.conversationId}:${key}`.replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 128),
          to,
          text,
          from,
        });
      },
      stop: async ({ key, threadId, requesterThreadId }) => {
        const { authority } = await this.#agentState();
        return await threads.stop(authority, {
          controlRequestId: `pi-stop:${authority.conversationId}:${key}`.replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 128),
          threadId,
          ...(requesterThreadId ? { requesterThreadId } : {}),
        });
      },
    };
  }

  #threadAgentHost(): RemoteAgentHost | undefined {
    const threads = this.#options.threadAgents;
    if (!threads) return undefined;
    const scope = async () => {
      const { authority } = await this.#agentState();
      return { authority, parentTurnId: this.#binding?.turnId ?? this.#state?.lastTurnId ?? `pi:${authority.conversationId}` };
    };
    return {
      start: async (args) => {
        if (!args.model) throw new Error("An agent thread here needs the model it runs on.");
        const { authority, parentTurnId } = await scope();
        return await threads.start({ ...args, model: args.model }, authority, parentTurnId);
      },
      message: async (args) => {
        const { authority, parentTurnId } = await scope();
        await threads.message(args, authority, parentTurnId);
      },
      stop: async (threadId) => {
        const { authority, parentTurnId } = await scope();
        return await threads.stop({ key: `stop:${threadId}:${Date.now()}`, threadId }, authority, parentTurnId);
      },
    };
  }

  #deviceAgentHost(deviceId: string): RemoteAgentHost | undefined {
    const devices = this.#options.deviceAgents;
    if (!devices) return undefined;
    const scope = async () => {
      const { authority } = await this.#agentState();
      return { authority, parentTurnId: this.#binding?.turnId ?? this.#state?.lastTurnId ?? `pi:${authority.conversationId}` };
    };
    return {
      start: async (args) => {
        const { authority, parentTurnId } = await scope();
        if (args.model && /^claude-code(?:[/:]|$)/u.test(args.model)) {
          const listed = await this.#gate(authority)
            .devices()
            .catch(() => undefined);
          const there = listed?.devices.find((entry) => entry.deviceId === deviceId);
          const name = there?.label?.trim() || deviceId;
          if (there?.online && there.availability && !there.availability.capabilities.includes("claude-code")) {
            throw new Error(
              `${name} isn't signed in to Claude Code, so a Claude Code agent can't run there. Ask the user to sign in to Claude on ${name} (Settings › Account there) and try again, or start the agent in the cloud with destination "cloud".`,
            );
          }
        }
        return await devices.start({ ...args, deviceId }, authority, parentTurnId);
      },
      message: async (args) => {
        const { authority, parentTurnId } = await scope();
        return await devices.message(args, authority, parentTurnId);
      },
      stop: async (threadId) => {
        const { authority, parentTurnId } = await scope();
        return await devices.stop({ key: `stop:${threadId}:${Date.now()}`, threadId }, authority, parentTurnId);
      },
    };
  }

  async #recordAgentRun(
    run: AgentRun,
    authority: PiAuthority,
    turnId: string,
    context: Context,
    ended?: PiAgentLedgerEvent["ended"],
  ): Promise<void> {
    if (!this.#options.agentLedger) return;
    if (run.parentConversationId === (await this.open()).root.id) {
      if ((await this.#agentInfo(run.threadId, context)).origin) return;
    }
    this.#options.agentLedger({
      threadId: run.threadId,
      attempt: run.attempt,
      description: run.description,
      ...(run.parentThreadId ? { parentThreadId: run.parentThreadId } : {}),
      depth: run.depth,
      turnId,
      authority,
      ...(ended ? { ended } : {}),
    });
  }

  async #agentInfo(threadId: string, context: Context): Promise<PiAgentInfo> {
    const { harness, root } = await this.open();
    const state = await harness.snapshot(StellaAgentsDoc, root.id, context);
    const calls = Object.values(state?.calls ?? {}).filter((call) => call.threadId === threadId).length;
    const agent = state?.agents[threadId];
    const live =
      agent && !agent.remote ? await harness.snapshot(LiveDoc, agent.conversationId as ConversationId, context) : undefined;
    return {
      description: agent?.description ?? threadId,
      attempt: Math.max(1, calls),
      ...(agent?.origin ? { origin: agent.origin } : {}),
      running: live?.run !== undefined,
    };
  }

  #cardTurnId(threadId: string, info: PiAgentInfo): string | undefined {
    if (info.origin) return undefined;
    return this.#binding?.turnId ?? this.#state?.lastTurnId;
  }

  #owner(authority: PiAuthority): PiComputeOwner {
    return { ownerId: authority.ownerId, ownerGeneration: authority.ownerGeneration, conversationId: authority.conversationId };
  }

  #computeHost(): PiComputeHost {
    return {
      env: this.#options.env,
      storage: this.#options.storage,
      takeSlot: (owner, sandboxId, signal) => this.#takeSlot(owner, sandboxId, signal),
      releaseSlot: async (owner, sandboxId) => {
        await ownerGateStub(this.#options.env.OWNER_GATES, owner.ownerId).releaseAgentContainer({ sandboxId });
      },
      log: this.#options.log,
    };
  }

  async #takeSlot(owner: PiComputeOwner, sandboxId: string, signal: AbortSignal): Promise<void> {
    const deadline = Date.now() + CONTAINER_SLOT_WAIT_MS;
    for (;;) {
      const slot = await ownerGateStub(this.#options.env.OWNER_GATES, owner.ownerId).acquireAgentContainer({ sandboxId });
      if (slot.ok) return;
      if (slot.limit === 0) throw new Error(CLOUD_SANDBOX_SUBSCRIPTION_REQUIRED_MESSAGE);
      if (Date.now() >= deadline) {
        throw new Error(
          `Your plan runs ${slot.limit} cloud agents at once, and that many are busy. This agent waited ${CONTAINER_SLOT_WAIT_MS / 60_000} minutes for one of them to finish.`,
        );
      }
      await waitFor(CONTAINER_SLOT_POLL_MS, signal);
    }
  }

  async #attachedTool(call: PiAttachedToolCall, context: Context): Promise<SerializedAgentToolResult> {
    const { harness } = await this.open();
    const agentConversationId = call.conversationId as ConversationId;
    const sessionId = await this.#providerSession(harness, agentConversationId, context);
    const active = await this.#agentRun(sessionId, context.abortSignal);
    const held = await this.#lease(agentConversationId, active, context).catch((error: unknown) => {
      const budget = containerBudgetMessage(error);
      throw budget ? new Error(budget) : error;
    });
    held.inFlight += 1;
    const signal = context.abortSignal;
    const stop = () => {
      void this.#endLease(agentConversationId, { aborted: true }).catch((error: unknown) => this.#options.report(error));
    };
    signal?.addEventListener("abort", stop, { once: true });
    try {
      signal?.throwIfAborted();
      held.used = true;
      return await held.lease.call({ toolCallId: call.callId, toolName: call.toolName, params: call.params });
    } catch (error) {
      void this.#dropLease(agentConversationId, held).catch((dropError: unknown) => this.#options.report(dropError));
      const budget = containerBudgetMessage(error);
      throw budget ? new Error(budget) : error;
    } finally {
      signal?.removeEventListener("abort", stop);
      held.inFlight -= 1;
    }
  }

  #execution(): StellaExecutionHost {
    return {
      agentTarget: async (deviceId, needs) => {
        if (deviceId.trim().toLowerCase() === AGENT_MOVE_CLOUD) return { deviceId: AGENT_MOVE_CLOUD, name: "Stella's cloud", here: true };
        const { authority } = await this.#agentState();
        const listed = await this.#gate(authority)
          .devices()
          .catch(() => undefined);
        if (!listed) return { error: "Couldn't read the connected devices list right now. Try again in a moment." };
        const device = findDeviceDestination(listed.devices, deviceId);
        if (!device) {
          return { error: `No connected device has the device_id or name ${deviceId}. Use a device_id from the connected devices list.` };
        }
        const name = device.label?.trim() || device.deviceId;
        if (!device.online) {
          return { error: `${name} is offline, so you can't move there now. Carry on here, or tell Stella with send_message to "stella" if the work needs that computer.` };
        }
        const refusal = deviceRefusal(device, name);
        if (refusal) return { error: refusal };
        if (needs.claudeCode && device.availability && !device.availability.capabilities.includes("claude-code")) {
          return {
            error: `${name} isn't signed in to Claude Code, so you, on Claude Code, can't run there. Ask the user to sign in to Claude on ${name} (Settings › Account there) and try again.`,
          };
        }
        return { deviceId: device.deviceId, name };
      },
      moveAgent: async (move) => await this.#moveAgent(move),
      standing: async (deviceId) => {
        const { authority } = await this.#agentState();
        const listed = await this.#gate(authority)
          .devices()
          .catch(() => undefined);
        const device = listed?.devices.find((entry) => entry.deviceId === deviceId);
        return device ? deviceStanding(device) : undefined;
      },
      ...(this.#options.moveBrain
        ? {
            moveBrain: async (target, brief, context) => {
              if (target.kind !== "device") return { error: "You already run in the cloud." };
              const { authority } = await this.#agentState();
              const listed = await this.#gate(authority)
                .devices()
                .catch(() => undefined);
              if (!listed) return { error: "Couldn't read the connected devices list right now. Try again in a moment." };
              const device = findDeviceDestination(listed.devices, target.deviceId);
              if (!device) {
                return {
                  error: `No connected device has the device_id or name ${target.deviceId}. Use a device_id from the connected devices list, or "cloud".`,
                };
              }
              const name = device.label?.trim() || device.deviceId;
              const refusal = deviceRefusal(device, name);
              if (refusal) return { error: refusal };
              const turn = await this.#turn(context.abortSignal);
              await this.#options.moveBrain!(turn.authority, { host: "device", deviceId: device.deviceId, label: name }, brief);
              return { moved: { kind: "device", deviceId: device.deviceId, label: name } };
            },
          }
        : {}),
    };
  }

  async #ownerCall<T>(authority: PiAuthority, name: string, args: unknown): Promise<T> {
    const response = (await this.#gate(authority).ownerInternal({
      name,
      args,
      ownerGeneration: authority.ownerGeneration,
    })) as RpcResponse<T>;
    if (!response.ok) throw Object.assign(new Error(response.error.message), { reason: response.error.reason });
    return response.value;
  }

  #agentLogTransport(): AgentLogTransport | undefined {
    const authority = this.#state?.authority;
    if (!authority) return undefined;
    return {
      holder: AGENT_LOG_CLOUD_HOLDER,
      conversationId: authority.conversationId,
      append: async ({ threadId, records }) =>
        await this.#ownerCall<AgentLogCalls["agentLogs.append"]["result"]>(authority, "agentLogs.cloudAppend", {
          threadId,
          conversationId: authority.conversationId,
          records,
        }),
      read: async (args) => await this.#ownerCall<AgentLogCalls["agentLogs.read"]["result"]>(authority, "agentLogs.cloudRead", args),
    };
  }

  async #moveAgent(move: AgentMove): Promise<{ where: string } | { error: string }> {
    if (move.deviceId === AGENT_MOVE_CLOUD) return { error: "You already run in the cloud." };
    try {
      await this.#agentLog.flush(move.agentConversationId);
    } catch (error) {
      return { error: `your conversation couldn't be saved (${error instanceof Error ? error.message : String(error)}).` };
    }
    const { authority } = await this.#agentState();
    const brief = move.brief.length > 6_000 ? `${move.brief.slice(0, 6_000)}\n[brief cut]` : move.brief;
    const model = agentMoveModel(move.model, move.thinkingLevel);
    const handoffId = `move:${(await sha256Hex(`${authority.conversationId}\0${move.threadId}\0${move.key}`)).slice(0, 40)}`;
    const moved = await this.#ownerCall<AgentThreadCalls["agentThreads.handoff"]["result"]>(authority, "agentThreads.cloudHandoff", {
      ownerGeneration: authority.ownerGeneration,
      handoffId,
      threadId: move.threadId,
      conversationId: authority.conversationId,
      targetDeviceId: move.deviceId,
      prompt: movedAgentBrief("Stella's cloud", brief),
      ...(model ? { model } : {}),
    });
    this.#options.log("pi_agent_moved", { threadId: move.threadId, to: move.deviceId });
    return { where: moved.where };
  }

  async #lease(agentConversationId: ConversationId, active: ActiveRun, context: Context): Promise<AgentLease> {
    const current = this.#leases.get(agentConversationId);
    if (current) {
      const held = await current;
      if (held.inFlight > 0 || held.lease.expiresAt - Date.now() > LEASE_RENEW_MS) return held;
      if (this.#leases.get(agentConversationId) === current) {
        this.#leases.delete(agentConversationId);
        await this.#releaseLease(agentConversationId, held, {});
      }
      return await this.#lease(agentConversationId, active, context);
    }
    const opening = (async (): Promise<AgentLease> => {
      const { authority } = active;
      const { harness } = await this.open();
      const role = await harness.snapshot(StellaAgentDoc, agentConversationId, context);
      const threadId = role?.threadId ?? active.run.threadId;
      const lease = await openPiComputeLease(this.#computeHost(), {
        owner: this.#owner(authority),
        agentConversationId,
        threadId,
        turnId: active.turnId,
      });
      const held: AgentLease = { lease, threadId, inFlight: 0, used: false, linked: new Set() };
      this.#live.set(`${lease.record.turnId}:${lease.record.attemptGeneration}`, held);
      return held;
    })();
    this.#leases.set(agentConversationId, opening);
    opening.catch(() => {
      if (this.#leases.get(agentConversationId) === opening) this.#leases.delete(agentConversationId);
    });
    return await opening;
  }

  #runStarted(threadId: string): void {
    const current = this.#ending.get(threadId);
    if (current) {
      current.runs += 1;
      return;
    }
    let resolve!: () => void;
    const ended = new Promise<void>((done) => (resolve = done));
    this.#ending.set(threadId, { runs: 1, ended, resolve });
  }

  #runEnded(threadId: string): void {
    const current = this.#ending.get(threadId);
    if (!current) return;
    current.runs -= 1;
    if (current.runs > 0) return;
    this.#ending.delete(threadId);
    current.resolve();
  }

  async #agentRunsEnded(threadId: string): Promise<void> {
    const deadline = Date.now() + REPORT_FILES_WAIT_MS;
    for (let current = this.#ending.get(threadId); current; current = this.#ending.get(threadId)) {
      const left = deadline - Date.now();
      if (left <= 0) {
        this.#options.log("pi_agent_report_unwaited", { threadId });
        return;
      }
      await Promise.race([current.ended, scheduler.wait(left)]);
    }
  }

  async #endLease(agentConversationId: number, end: AgentRunEnd): Promise<void> {
    const current = this.#leases.get(agentConversationId);
    if (!current) return;
    this.#leases.delete(agentConversationId);
    const held = await current.catch(() => undefined);
    if (held) await this.#releaseLease(agentConversationId, held, end);
  }

  async #dropLease(agentConversationId: number, held: AgentLease): Promise<void> {
    const current = this.#leases.get(agentConversationId);
    if (!current || (await current.catch(() => undefined)) !== held) return;
    if (this.#leases.get(agentConversationId) !== current) return;
    this.#leases.delete(agentConversationId);
    await this.#releaseLease(agentConversationId, held, { aborted: true });
  }

  async #releaseLease(agentConversationId: number, held: AgentLease, end: AgentRunEnd): Promise<void> {
    const { lease } = held;
    const { record } = lease;
    if (end.aborted) lease.abort();
    const up = !end.aborted && held.used && (await lease.ready.then(() => true, () => false));
    if (up) {
      try {
        const linked = [...new Set([...held.linked, ...answerLinkedPaths(end.answer ?? "")])];
        const { deliveredFiles } = await lease.quiesce(linked);
        this.#options.log("pi_agent_quiesced", { threadId: held.threadId, delivered: deliveredFiles.length });
      } catch (error) {
        this.#options.report(error);
      }
    }
    lease.abort();
    await Promise.race([lease.ready.catch(() => undefined), scheduler.wait(LEASE_STOP_WAIT_MS)]);
    await lease.release({ warm: !end.aborted }).catch((error: unknown) => this.#options.report(error));
    this.#live.delete(`${record.turnId}:${record.attemptGeneration}`);
    await forgetPiCompute(this.#computeHost(), piComputeKey(agentConversationId), record).catch((error: unknown) =>
      this.#options.report(error),
    );
  }

  async #sweepLeases(): Promise<void> {
    const left = await this.#options.storage.list<PiComputeRecord>({ prefix: "piCompute:" });
    for (const [key, record] of left) {
      if (this.#leases.has(Number(key.slice("piCompute:".length))) || record?.version !== 1) continue;
      const released = releasePiCompute(this.#computeHost(), record).catch((error: unknown) => this.#options.report(error));
      await Promise.race([released, scheduler.wait(20_000)]);
      await forgetPiCompute(this.#computeHost(), key, record).catch(() => undefined);
      this.#options.log("pi_agent_lease_swept", { turnId: record.turnId, attemptGeneration: record.attemptGeneration });
    }
  }

  async handleBroker(request: Request): Promise<Response> {
    const turnId = request.headers.get(TURN_BROKER_HEADERS.turnId) ?? "";
    const attemptGeneration = Number(request.headers.get(TURN_BROKER_HEADERS.attemptGeneration));
    if (!turnId || !Number.isSafeInteger(attemptGeneration) || attemptGeneration < 1) return brokerFailure(401);
    const recordKey = turnBrokerStorageKey({ turnId, attemptGeneration });
    const initial = await this.#options.storage.get<TurnBrokerRecord>(recordKey);
    if (!initial) return brokerFailure(401);
    const preflight = await preflightTurnBrokerRequest({ record: initial, headers: request.headers, now: Date.now() });
    if (!preflight.ok) return turnBrokerDenialResponse(preflight);
    const { target } = preflight;
    if (request.method !== target.method) return brokerFailure(403);
    const held = this.#live.get(`${turnId}:${attemptGeneration}`);
    if (!held) return brokerFailure(410);
    const engine = this.#state?.authority.execution.engine ?? "stella";
    if ((target.kind !== "drive" && target.kind !== "turn-event") || !turnBrokerTargetMatchesEngine(target, engine)) {
      return brokerFailure(403);
    }
    let body: Uint8Array;
    try {
      body = await readTurnBrokerRequestBody(request, target.maxBodyBytes);
    } catch (error) {
      return brokerFailure(error instanceof TurnBrokerBodyTooLargeError ? 413 : 400);
    }
    const bodySha256 = [...new Uint8Array(await crypto.subtle.digest("SHA-256", body))]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const { owner } = held.lease.record;
    const claim = this.#brokerClaims.then(async () => {
      const record = await this.#options.storage.get<TurnBrokerRecord>(recordKey);
      if (!record) return undefined;
      const claimed = await claimTurnBrokerRequest({
        record,
        live: {
          sessionId: piBrokerSessionId(owner.conversationId),
          ownerId: owner.ownerId,
          ownerGeneration: owner.ownerGeneration,
          turnId,
          attemptGeneration,
          active: this.#live.get(`${turnId}:${attemptGeneration}`) === held,
          canceled: false,
          terminal: false,
        },
        headers: request.headers,
        now: Date.now(),
        bodyBytes: body.byteLength,
        bodySha256,
      });
      if (claimed.ok && claimed.disposition === "claim") await this.#options.storage.put(recordKey, claimed.record);
      return claimed;
    });
    this.#brokerClaims = claim.catch(() => undefined);
    const claimed = await claim;
    if (!claimed) return brokerFailure(401);
    if (!claimed.ok) return turnBrokerDenialResponse(claimed);
    if (claimed.disposition !== "claim") return brokerFailure(409);
    let decoded: unknown;
    try {
      decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(body));
    } catch {
      return brokerFailure(400);
    }
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) return brokerFailure(400);
    const payload = decoded as Record<string, unknown>;
    if (payload.turnId !== turnId) return brokerFailure(403);
    try {
      if (target.kind === "drive") {
        return await serveTurnDriveRequest(
          this.#options.env,
          {
            ownerId: owner.ownerId,
            ownerGeneration: owner.ownerGeneration,
            turnId,
            kind: "agent",
            conversationId: owner.conversationId,
          },
          target.path,
          payload,
        );
      }
      if (payload.terminal === true) return brokerFailure(403);
      if (payload.kind === "output_files") await this.#noteDeliveredFiles(held.threadId, payload.payload);
      else this.#options.log("pi_agent_turn_event", { threadId: held.threadId, kind: String(payload.kind).slice(0, 64) });
      return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
    } catch (error) {
      this.#options.report(error);
      return brokerFailure(502);
    }
  }

  #fileDelivery(threadId: string): PiAgentFileDelivery {
    return {
      threadId,
      deliver: async (files) => {
        await this.#noteDeliveredFiles(threadId, { files });
        this.#options.log("pi_agent_media_delivered", { threadId, files: files.length });
      },
    };
  }

  async #noteDeliveredFiles(threadId: string, payload: unknown): Promise<void> {
    const listed = (payload as { files?: unknown } | undefined)?.files;
    if (!Array.isArray(listed)) return;
    const files: PiDeliveredFile[] = [];
    for (const entry of listed) {
      const file = entry as Record<string, unknown> | null;
      if (!file || typeof file.path !== "string") continue;
      files.push({
        path: file.path,
        name: typeof file.name === "string" ? file.name : file.path.split("/").at(-1) || file.path,
        sizeBytes: typeof file.sizeBytes === "number" ? file.sizeBytes : 0,
        contentType: typeof file.contentType === "string" ? file.contentType : "application/octet-stream",
      });
    }
    if (files.length === 0) return;
    const key = deliveredFilesKey(threadId);
    const kept = (await this.#options.storage.get<PiDeliveredFile[]>(key)) ?? [];
    const byPath = new Map(kept.map((file) => [file.path, file]));
    for (const file of files) byPath.set(file.path, file);
    await this.#options.storage.put(key, [...byPath.values()].slice(-50));
  }

  open(): Promise<Opened> {
    this.#opening ??= (async () => {
      const kept = await this.#options.storage.get<PiAgentState>(PI_AGENT_STATE_KEY);
      for (const [key, agent] of await this.#options.storage.list<ThreadAgent>({ prefix: THREAD_AGENT_PREFIX })) {
        this.#threadAgents.set(key.slice(THREAD_AGENT_PREFIX.length), agent);
      }
      if (kept) this.#state = kept;
      this.#setModels(kept);
      const storage = await openDurableObjectSqliteStorage(this.#options.storage);
      const { harness, refreshTools, startAgent, messageAgent, stopAgent, agentStanding, markCatchUp } = await openStellaHarness(
        {
          storage,
          models: this.#models,
          sources: this.#sources(),
          agents: this.#agents(),
          tools: this.#tools(),
          extensions: [
            piAttachedCoding((call, context) => this.#attachedTool(call, context)),
            ...(this.#claudeCode ? [this.#claudeCode.extension(CLAUDE_CODE_SCOPE)] : []),
            this.#agentLog.extension(),
          ],
          onReport: this.#options.report,
        },
        BACKGROUND_CONTEXT,
      );
      this.#harnessRef = harness;
      const root = await harness.root(BACKGROUND_CONTEXT);
      const { contextStartSeq } = await this.#options.journalStart();
      if (await alignJournalContext(harness, root, contextStartSeq, BACKGROUND_CONTEXT)) {
        this.#options.log("pi_root_context_aligned", {});
      }
      const rootSession = await this.#providerSession(harness, root.id, BACKGROUND_CONTEXT);
      await this.#sweepLeases().catch((error: unknown) => this.#options.report(error));
      harness.resume();
      return {
        harness,
        root,
        rootSession,
        refreshTools,
        agents: { startAgent, messageAgent, stopAgent, agentStanding, markCatchUp },
      };
    })().catch((error: unknown) => {
      this.#opening = undefined;
      throw error;
    });
    return this.#opening;
  }

  async bind(binding: PiTurnBinding): Promise<() => void> {
    const offered = (tools: readonly CloudCodeSourceAgentTool[]) =>
      tools.filter((tool) => !STELLA_HARNESS_TOOL_NAMES.has(tool.name)).map(toolSpec);
    const tools = offered(await this.#turnToolsFor(binding));
    const agentTools = offered(await this.#options.agentTools(binding.authority, this.#browser(undefined)));
    const state: PiAgentState = {
      version: 1,
      authority: binding.authority,
      models: binding.stellaModels ? [binding.stellaModels.model, binding.stellaModels.agentModel] : [],
      ...(binding.sources.skillsCatalog ? { skillsCatalog: binding.sources.skillsCatalog } : {}),
      executionContext: binding.sources.executionContext,
      tools,
      agentTools,
      ...(binding.sources.locale ? { locale: binding.sources.locale } : {}),
      lastTurnId: binding.turnId,
    };
    if (JSON.stringify(state) !== JSON.stringify(this.#state)) {
      await this.#options.storage.put(PI_AGENT_STATE_KEY, state);
      this.#state = state;
    }
    this.#setModels(state);
    (await this.#opening?.catch(() => undefined))?.refreshTools();
    this.#binding = binding;
    this.#notify("root");
    return () => {
      if (this.#binding === binding) this.#binding = undefined;
    };
  }

  async configureRoot(binding: PiTurnBinding, context: Context): Promise<void> {
    const { harness, root } = await this.open();
    const agent = await root.agent(context);
    const model = this.#rootModel(binding.authority.execution);
    if (agent.model && (agent.model.provider !== model.provider || agent.model.modelId !== model.modelId)) {
      const window =
        model.provider === CLAUDE_CODE_PROVIDER_ID
          ? (this.#claudeCode?.contextWindow(model.modelId) ?? 0)
          : (this.#models.getModel(model.provider, model.modelId)?.contextWindow ?? 0);
      const handover = { from: `${agent.model.provider}/${agent.model.modelId}`, to: `${model.provider}/${model.modelId}` };
      const fit = await fitForHandover({
        harness,
        conversation: root,
        window,
        context,
        report: (error) => this.#options.report(error),
        compacting: (state) => this.#options.log("pi_handover", { ...handover, fit: "compacting", ...state }),
      }).catch((error: unknown) => this.#options.report(error));
      if (fit) this.#options.log("pi_handover", { ...handover, ...fit });
    }
    if (
      offersAgentTools(agent) ||
      agent.model?.provider !== model.provider ||
      agent.model?.modelId !== model.modelId ||
      agent.thinkingLevel !== binding.thinkingLevel
    ) {
      await root.configure({ ...orchestratorAgent(model), thinkingLevel: binding.thinkingLevel }, context);
    }
  }

  async busy(context: Context): Promise<boolean> {
    const { harness } = await this.open();
    const inspection = await harness.inspect(context);
    return inspection.tasks.length > 0 || inspection.submissions.length > 0;
  }

  async scheduledAgent(
    request: { threadId: string; description?: string },
    prompt: string,
    turnId: string,
    context: Context,
  ): Promise<void> {
    const { root, agents } = await this.open();
    await root.submit(
      {
        type: "write",
        requestId: `turn:${turnId}`,
        entry: { kind: "stella.agent-op", data: { op: "start", threadId: request.threadId } },
      },
      context,
    );
    await agents.startAgent(
      {
        key: `schedule:${request.threadId}`,
        description: request.description ?? request.threadId,
        prompt,
        threadId: request.threadId,
      },
      context,
    );
  }

  async threadAttempt(
    attempt: {
      threadId: string;
      description: string;
      attemptGeneration: number;
      lineage: AgentLineage;
      authority: PiAuthority;
      model?: StellaModelSpec;
      executionContext: ExecutionContextSnapshot;
    },
    prompt: string,
    context: Context,
  ): Promise<void> {
    const { harness, root, agents, refreshTools } = await this.open();
    if (!this.#threadAgents.has(attempt.threadId)) {
      const agent: ThreadAgent = {
        authority: attempt.authority,
        ...(attempt.model ? { model: attempt.model } : {}),
      };
      await this.#options.storage.put(`${THREAD_AGENT_PREFIX}${attempt.threadId}`, agent);
      this.#threadAgents.set(attempt.threadId, agent);
    }
    this.#state ??= await this.#options.storage.get<PiAgentState>(PI_AGENT_STATE_KEY);
    if (!this.#state) {
      const offered = await this.#options.agentTools(attempt.authority, this.#browser(undefined));
      const state: PiAgentState = {
        version: 1,
        authority: attempt.authority,
        models: [],
        executionContext: attempt.executionContext,
        agentTools: offered.filter((tool) => !STELLA_HARNESS_TOOL_NAMES.has(tool.name)).map(toolSpec),
      };
      await this.#options.storage.put(PI_AGENT_STATE_KEY, state);
      this.#state = state;
      refreshTools();
    }
    this.#setModels(this.#state);
    const key = threadCallKey(attempt.threadId, attempt.attemptGeneration);
    const state = await harness.snapshot(StellaAgentsDoc, root.id, context);
    if (state?.calls[`host:${key}`] || state?.calls[`user:${key}`]) return;
    if (state?.agents[attempt.threadId]) {
      await agents.markCatchUp(attempt.threadId, context);
      await agents.messageAgent(
        { key, threadId: attempt.threadId, message: prompt, fromOrchestrator: true },
        context,
      );
      return;
    }
    await agents.startAgent(
      {
        key,
        description: attempt.description,
        prompt,
        threadId: attempt.threadId,
        catchUp: true,
        origin: { agentThread: true },
        lineage: attempt.lineage,
        model: this.#threadModel(attempt.authority.execution, attempt.model),
        thinkingLevel: thinkingLevelFor(attempt.authority.execution.reasoningEffort),
      },
      context,
    );
  }

  #threadModel(execution: PiExecution, model: StellaModelSpec | undefined) {
    if (execution.engine === "chatgpt") return { provider: CHATGPT_PROVIDER_ID, modelId: execution.model };
    if (execution.engine === "provider") return { provider: execution.provider, modelId: execution.model };
    if (execution.engine === "anthropic") throw new Error("A Claude Code agent thread runs in a container of its own.");
    if (!model) throw new Error("An agent on Stella's models needs its model.");
    return stellaModelRef("general", model.alias);
  }

  async #runAuthority(run: AgentRun, context: Context): Promise<PiAuthority> {
    const { harness, root } = await this.open();
    let threadId: string | undefined = run.threadId;
    let conversationId: ConversationId | undefined = run.agentConversationId;
    while (threadId !== undefined) {
      const owned = this.#threadAgents.get(threadId);
      if (owned) return owned.authority;
      const parent = conversationId
        ? (await harness.snapshot(StellaAgentDoc, conversationId, context))?.parentConversationId
        : undefined;
      if (!parent || parent === root.id) break;
      conversationId = parent as ConversationId;
      threadId = (await harness.snapshot(StellaAgentDoc, conversationId, context))?.threadId;
    }
    return (await this.#agentState()).authority;
  }

  async steerThreadAgent(
    args: { threadId: string; attemptGeneration: number; messageId: string; text: string },
    context: Context,
  ): Promise<void> {
    const { agents } = await this.open();
    await agents.messageAgent(
      {
        key: `${threadCallKey(args.threadId, args.attemptGeneration)}:steer:${args.messageId}`,
        threadId: args.threadId,
        message: args.text,
        fromOrchestrator: true,
      },
      context,
    );
  }

  async runningAgents(context: Context): Promise<AgentActivityEntry[]> {
    const { harness, root } = await this.open();
    const state = await harness.snapshot(StellaAgentsDoc, root.id, context);
    const calls = Object.values(state?.calls ?? {});
    const admitted = new Map<number, ActiveRun>();
    for (const runs of this.#runs.values()) {
      for (const active of runs) admitted.set(active.run.agentConversationId, active);
    }
    const running: AgentActivityEntry[] = [];
    for (const [threadId, agent] of Object.entries(state?.agents ?? {})) {
      if (agent.remote || agent.origin) continue;
      const conversationId = agent.conversationId as ConversationId;
      const active = admitted.get(conversationId);
      if (!active && (await harness.snapshot(LiveDoc, conversationId, context))?.run === undefined) continue;
      const first = active
        ? undefined
        : await harness.commit(async (tx) => (await tx.scanEntries({ conversationId, order: "ascending" }, 1)).items[0], context);
      const startedAt = active?.startedAt ?? (first?.model?.[0] as { timestamp?: number } | undefined)?.timestamp ?? Date.now();
      running.push({
        agentId: threadId,
        title: agent.description,
        agentType: "general",
        status: "running",
        createdAtMs: startedAt,
        updatedAtMs: startedAt,
        attemptGeneration: Math.max(1, calls.filter((call) => call.threadId === threadId).length),
      });
    }
    return running;
  }

  async runningAgentTree(context: Context): Promise<Array<{ threadId: string; conversationId: ConversationId; depth: number }>> {
    const { harness, root } = await this.open();
    const found: Array<{ threadId: string; conversationId: ConversationId; depth: number }> = [];
    const visit = async (conversationId: ConversationId, depth: number): Promise<void> => {
      if (depth > 6) return;
      const state = await harness.snapshot(StellaAgentsDoc, conversationId, context);
      for (const [threadId, agent] of Object.entries(state?.agents ?? {})) {
        if (agent.remote) continue;
        const child = agent.conversationId as ConversationId;
        await visit(child, depth + 1);
        if ((await harness.snapshot(LiveDoc, child, context))?.run !== undefined) {
          found.push({ threadId, conversationId: child, depth: depth + 1 });
        }
      }
    };
    await visit(root.id, 0);
    return found.sort((a, b) => b.depth - a.depth);
  }

  async abortAgentConversation(conversationId: ConversationId, context: Context): Promise<void> {
    const { harness } = await this.open();
    await (await harness.conversation(conversationId, context))?.abort(context);
  }

  async stopThreadAgent(threadId: string, context: Context): Promise<void> {
    const { agents } = await this.open();
    const stopped = agents.stopAgent(threadId, context);
    stopped.catch((error: unknown) => this.#options.report(error));
    await Promise.race([stopped, waitFor(ORIGIN_STOP_HOLD_MS)]);
  }

  async controlHarnessAgent(
    input: {
      ownerId: string;
      ownerGeneration: string;
      threadId: string;
      commandId: string;
      kind: "message" | "stop";
      text?: string;
    },
    context: Context,
  ): Promise<"steered" | "resumed" | "stopped" | "not_running" | "not_found"> {
    const kept = this.#state ?? (await this.#options.storage.get<PiAgentState>(PI_AGENT_STATE_KEY));
    if (!kept || kept.authority.ownerId !== input.ownerId || kept.authority.ownerGeneration !== input.ownerGeneration) {
      return "not_found";
    }
    const { agents } = await this.open();
    const standing = await agents.agentStanding(input.threadId, context);
    if (!standing) return "not_found";
    const running = standing.status === "running";
    if (input.kind === "stop") {
      if (!running) return "not_running";
      const stopped = agents.stopAgent(input.threadId, context);
      stopped.catch((error: unknown) => this.#options.report(error));
      await Promise.race([stopped, waitFor(ORIGIN_STOP_HOLD_MS)]);
      return "stopped";
    }
    await agents.messageAgent(
      { key: `control:${input.commandId}`, threadId: input.threadId, message: input.text ?? "", fromOrchestrator: true },
      context,
    );
    return running ? "steered" : "resumed";
  }

  async #threadAttemptOf(requestId: string, context: Context): Promise<number | undefined> {
    const reporter = Number(/^agent-report:(\d+)$/.exec(requestId)?.[1]);
    if (!Number.isSafeInteger(reporter)) return undefined;
    const { harness, root } = await this.open();
    const calls = (await harness.snapshot(StellaAgentsDoc, root.id, context))?.calls ?? {};
    for (const [key, call] of Object.entries(calls)) {
      if (Number(call.reporter) !== reporter) continue;
      const attempt = /^(?:host|user):thread:[^:]+:(\d+)(?::|$)/.exec(key)?.[1];
      return attempt === undefined ? undefined : Number(attempt);
    }
    return undefined;
  }

  async importJournal(
    read: (afterSeq: number) => Promise<{ records: readonly JournalRecordLike[]; complete: boolean }>,
    currentTurnId: string,
    context: Context,
  ): Promise<number> {
    const { harness, root } = await this.open();
    const state = await harness.snapshot(JournalSyncDoc, root.id, context);
    const start = await journalImportAfter(state, () => this.#options.journalStart());
    let after = start.after;
    const ran = new Map<string, boolean>();
    for (;;) {
      const page = await read(after);
      const messages: JournalMessage[] = [];
      for (const record of page.records) {
        const reminder = record.kind === "card" ? parseReminderCard(record.card) : null;
        if (reminder) {
          messages.push({
            seq: record.seq,
            turnId: record.turnId,
            role: "assistant",
            hidden: false,
            message: reminderAssistantMessage(reminder, record.createdAtMs ?? Date.now()) as JournalMessage["message"],
          });
          continue;
        }
        if (record.kind !== "message" || !record.role || record.turnId === currentTurnId) continue;
        let own = ran.get(record.turnId);
        if (own === undefined) {
          own = Boolean(await root.commit((tx) => tx.submissionByRequest(root.id, `turn:${record.turnId}`), context));
          ran.set(record.turnId, own);
        }
        const message = record.payload as JournalMessage["message"] | null;
        if (own || !message || typeof message !== "object" || message.role !== record.role) continue;
        messages.push({ seq: record.seq, turnId: record.turnId, role: record.role, hidden: record.hidden === true, message });
      }
      const through: number = page.records.at(-1)?.seq ?? after;
      await importJournal(harness, root, messages, through, context, start.seed);
      if (page.complete || through <= after) {
        await this.#adoptCheckpoint(harness, root, context);
        return through;
      }
      after = through;
    }
  }

  async #adoptCheckpoint(harness: Harness, root: Conversation, context: Context): Promise<void> {
    try {
      const { checkpoint } = await this.#options.journalStart();
      if (!checkpoint) return;
      if (await adoptJournalCheckpoint(harness, root, checkpoint, context)) {
        this.#options.log("pi_root_checkpoint_adopted", { throughSeq: checkpoint.throughSeq });
      }
    } catch (error) {
      this.#options.report(error);
    }
  }

  async publishCheckpoint(
    ownTurnIds: () => readonly string[],
    store: (summary: string, firstKept: JournalCheckpointFirstKept) => Promise<number | undefined>,
    context: Context,
  ): Promise<void> {
    const { harness, root } = await this.open();
    const pending = await checkpointToPublish(
      harness,
      root,
      async (prompt) => {
        for (const turnId of ownTurnIds()) {
          const submission = await root.commit((tx) => tx.submissionByRequest(root.id, `turn:${turnId}`), context);
          if (submission?.entry === prompt.id) return { turnId };
        }
        return undefined;
      },
      context,
    );
    if (!pending) return;
    await store(pending.summary, pending.firstKept);
    await noteCheckpointPublished(harness, root, pending.markerId, context);
  }

  async follow(
    afterEntryId: number,
    onEntry: (entry: EntryRecord) => void,
    context: Context,
    onTool?: (tool: PiToolActivity) => void,
  ): Promise<AgentEventStream> {
    const { harness, root } = await this.open();
    const stream = await watchEvents(harness, root.id, context);
    let last = afterEntryId;
    const take = (entry: EntryRecord) => {
      if (entry.id <= last) return;
      last = entry.id;
      onEntry(entry);
    };
    for (const entry of stream.snapshot.entries) take(entry);
    stream.start(async (events) => {
      for (const event of events) {
        if (event.type === "message_end" || event.type === "entry_appended") take(event.entry);
        else if (event.type === "snapshot") for (const entry of event.entries) take(entry);
        else if (event.type === "tool_execution_start") {
          onTool?.({ toolCallId: event.toolCallId, name: event.toolName, phase: "start", args: event.args });
        } else if (event.type === "tool_execution_end") {
          const result = event.entry?.model?.[0] as { role?: string; isError?: boolean } | undefined;
          onTool?.({
            toolCallId: event.toolCallId,
            name: event.toolName,
            phase: "end",
            isError: result?.role === "toolResult" && result.isError === true,
          });
        }
      }
    });
    return stream;
  }

  async answer(settled: SettledSubmissionRecord, context: Context): Promise<string> {
    if (settled.status !== "done" || settled.type !== "input") return "";
    const { root } = await this.open();
    return assistantText(await root.commit((tx) => tx.entry(AssistantEntry, settled.answer), context));
  }

  async watchForClients(
    onEvents: (events: PiChatEvent[]) => void,
    context: Context,
  ): Promise<{ snapshot: unknown; hasOlder: boolean }> {
    const { harness, root } = await this.open();
    const previous = this.#clientStream;
    const stream = await watchEvents(harness, root.id, context);
    this.#clientStream = stream;
    const [snapshot] = piEventsForClients([stream.snapshot as unknown as PiChatEvent]) as [
      Extract<PiChatEvent, { type: "snapshot" }>,
    ];
    if (previous) onEvents([snapshot]);
    stream.start(async (events) => {
      if (this.#clientStream === stream) onEvents(piEventsForClients(events as unknown as PiChatEvent[]));
    });
    await previous?.stop().catch(() => undefined);
    const page = await root.entries({}, CLIENT_HISTORY_PAGE, undefined, context);
    const history = [...page.items].reverse() as unknown as PiEntry[];
    const { entries, trimmed } = piEntriesForClients(
      mergePiEntries(history, snapshot.entries),
      CLIENT_FRAME_BYTES,
    );
    const oldest = page.items.at(-1)?.id;
    const archived =
      page.next === undefined && (this.#options.archivedEntries?.has(root.id, oldest) ?? false);
    return { snapshot: { ...snapshot, entries }, hasOlder: page.next !== undefined || trimmed || archived };
  }

  get watchingForClients(): boolean {
    return this.#clientStream !== undefined;
  }

  async stopWatchingForClients(): Promise<void> {
    const stream = this.#clientStream;
    this.#clientStream = undefined;
    await stream?.stop().catch(() => undefined);
  }

  async olderForClients(beforeEntryId: number, context: Context): Promise<{ entries: PiEntry[]; hasOlder: boolean }> {
    const { root } = await this.open();
    const page = await root.entries(
      { maxEntryId: (beforeEntryId - 1) as EntryId },
      CLIENT_HISTORY_PAGE,
      undefined,
      context,
    );
    let items = [...page.items].reverse() as unknown as PiEntry[];
    let hasOlder = page.next !== undefined;
    const archive = this.#options.archivedEntries;
    if (!hasOlder && archive && items.length < CLIENT_HISTORY_PAGE) {
      const below = Math.min(beforeEntryId, page.items.at(-1)?.id ?? beforeEntryId);
      const older = await archive.read(root.id, { beforeId: below, limit: CLIENT_HISTORY_PAGE - items.length });
      items = [...(older.entries.map((entry) => entry.record) as unknown as PiEntry[]), ...items];
      hasOlder = older.hasOlder;
    }
    const { entries, trimmed } = piEntriesForClients(items, CLIENT_FRAME_BYTES);
    return { entries, hasOlder: hasOlder || trimmed };
  }

  async close(): Promise<void> {
    const opening = this.#opening;
    this.#opening = undefined;
    const opened = await opening?.catch(() => undefined);
    await opened?.harness.close(BACKGROUND_CONTEXT);
  }

  async discard(): Promise<number> {
    const runs = [...this.#runs.values()].flat();
    this.#runs.clear();
    for (const ending of this.#ending.values()) ending.resolve();
    this.#ending.clear();
    const leases = [...this.#leases.keys()];
    await this.close();
    const authority = this.#state?.authority;
    await Promise.all(
      leases.map((agentConversationId) =>
        this.#endLease(agentConversationId, { aborted: true }).catch((error: unknown) => this.#options.report(error)),
      ),
    );
    await Promise.all(
      runs.map(async (active) => {
        await active.guard?.release().catch((error: unknown) => this.#options.report(error));
        if (authority) {
          await this.#gate(authority)
            .release({ turnId: active.turnId })
            .catch((error: unknown) => this.#options.report(error));
        }
      }),
    );
    return runs.length;
  }
}
