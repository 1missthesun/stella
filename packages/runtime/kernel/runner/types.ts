import type { Api, Model } from "@earendil-works/pi-ai";
import type { ImageCapTarget } from "../shared/image-caps.js";
import type { BackgroundExitWake } from "./background-exit-wake.js";
import type { AgentThreadCalls } from "@stella/contracts/backend/agent-threads";
import type { HookEmitter } from "../extensions/hook-emitter.js";
import type {
  ScheduleToolApi,
  ToolContext,
  ToolUpdateCallback,
  ToolMetadata,
  ToolResult,
} from "../tools/types.js";
import type { ToolDefinition } from "../extensions/types.js";
import type { RuntimeStore } from "../storage/runtime-store.js";
import type {} from "@stella/contracts";
import type {
  HostRuntimeAuthRefreshResult,
  RuntimeAuthRefreshSource,
} from "@stella/contracts/protocol";
import type { LocalChatAppendEventArgs } from "../storage/shared.js";
import type { DeviceSigner } from "../home/device.js";

export type StellaHostRunnerOptions = {
  deviceId: string;
  stellaAppDir: string;
  stellaDataDir: string;
  stellaBrowserBinPath?: string;
  stellaOfficeBinPath?: string;
  stellaComputerCliPath?: string;
  stellaMediaCliPath?: string;
  stellaXApiCliPath?: string;
  /** UDS path for the worker-side CLI bridge (see runtime/worker/cli-bridge-server.ts).
   *  Forwarded into PTY env as `STELLA_CLI_BRIDGE_SOCK`. */
  cliBridgeSocketPath?: string;
  askUser?: import("../tools/user.js").UserToolsConfig["askUser"];
  requestSecureInput?: import("../tools/user.js").UserToolsConfig["requestSecureInput"];
  useSecureValue?: import("../tools/user.js").UserToolsConfig["useSecureValue"];
  revealSecureValueForFill?: import("../tools/user.js").UserToolsConfig["revealSecureValueForFill"];
  /**
   * Legacy exec compatibility hop for the inline "connect the Stella browser
   * extension" chat card. Production browser actions use the persistent
   * browser service API. This hook blocks until the user connects, declines,
   * or the card times out, then retries the intercepted operation on success.
   */
  requestBrowserExtensionConnect?: (
    payload: {
      conversationId?: string;
      agentId?: string;
      command?: string;
    },
    signal?: AbortSignal,
  ) => Promise<
    | { ok: true; status: "connected" | "already_connected" }
    | {
        ok: false;
        reason: "declined" | "cancelled" | "timeout" | "unsupported" | string;
      }
  >;
  requestComputerUseAppApproval?: (payload: {
    bundleIdentifier: string;
    displayName: string;
    appPath?: string;
    allowPersistentApproval: boolean;
    risk?: string;
    warningSubtitle?: string;
  }) => Promise<
    | { decision: "approved"; scope: "session" | "persistent" }
    | { decision: "declined"; scope: "none" }
  >;
  /**
   * Desktop hop for the orchestrator's `connector_status` tool: render the
   * inline connector connect card (ConnectorConnectService) and resolve
   * with the user's outcome. The abort signal cancels the pending card.
   */
  requestConnectorConnection?: (
    payload: {
      id: string;
      name: string;
      description?: string;
      iconUrl?: string;
      category?: string;
      reason?: string;
      conversationId?: string;
    },
    signal?: AbortSignal,
  ) => Promise<
    | { ok: true; status: "connected" | "already_connected" }
    | {
        ok: false;
        reason: "declined" | "cancelled" | "timeout" | "unsupported" | string;
      }
  >;
  requestRuntimeAuthRefresh?: (payload: {
    source: RuntimeAuthRefreshSource;
  }) => Promise<HostRuntimeAuthRefreshResult>;
  requestChallengeToken?: () => Promise<string | undefined>;
  getDeviceSigner?: () => Promise<DeviceSigner> | DeviceSigner;
  scheduleApi?: ScheduleToolApi;
  runtimeStore: RuntimeStore;
  appendLocalChatEvent?: (args: LocalChatAppendEventArgs) => void;
};

export type AgentHealth = {
  ready: boolean;
  reason?: string;
  engine?: string;
};

export type ParsedAgentLike = {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  agentTypes: string[];
  toolsAllowlist?: string[];
  model?: string;
  maxAgentDepth?: number;
};

export type RunnerPaths = {
  extensionsPath: string;
};

export type RunnerState = {
  /** The Stella backend worker origin; see `backend-session.ts`. */
  backendUrl: string | null;
  authToken: string | null;
  hasConnectedAccount: boolean;
  cloudSyncEnabled: boolean;
  isRunning: boolean;
  isInitialized: boolean;
  initializationPromise: Promise<void> | null;
  /**
   * Opens when `initializationPromise` is assigned at boot; reset when the
   * runner stops. Boot-window waiters (restart continuation) park here
   * instead of polling for the assignment.
   */
  initializationStarted: import("../shared/readiness-latch.js").ReadinessLatch;
  /**
   * Watches `Bash` sessions a finished run left running and wakes
   * the owning thread when they exit. Null until the runner is initialized
   * (it needs both the tool host and the agent manager).
   */
  backgroundExitWake: BackgroundExitWake | null;
  /** Who a background exit wakes, and how it stands (`setBackgroundExitTarget`). */
  backgroundExitTarget?: BackgroundExitTarget;
  piReportDelivery?: PiReportDelivery;
  agentHistoryQuery?: AgentHistoryQuery;
  loadedAgents: ParsedAgentLike[];
  /**
   * Late-bound web search handler. Wired by `createStellaHostRunner` so the
   * toolHost (built earlier in startup) can reach the backend's `search.web`
   * call. Stored on state so the toolHost can read it lazily.
   */
  webSearch:
    | ((
        query: string,
        options?: { category?: string },
      ) => Promise<{
        text: string;
        results: Array<{ title: string; url: string; snippet: string }>;
      }>)
    | null;
};

export type RunnerContext = {
  loadExecutionContext?: () => Promise<import("@stella/contracts/execution-context").ExecutionContextSnapshot>;
  /** The Stella backend worker (backend calls and live views). */
  backend: import("./backend-session.js").BackendSession;
  deviceId: string;
  stellaAppDir: string;
  stellaDataDir: string;
  stellaBrowserBinPath?: string;
  stellaOfficeBinPath?: string;
  stellaComputerCliPath?: string;
  stellaMediaCliPath?: string;
  stellaXApiCliPath?: string;
  cliBridgeSocketPath?: string;
  askUser?: StellaHostRunnerOptions["askUser"];
  requestSecureInput?: StellaHostRunnerOptions["requestSecureInput"];
  useSecureValue?: StellaHostRunnerOptions["useSecureValue"];
  revealSecureValueForFill?: StellaHostRunnerOptions["revealSecureValueForFill"];
  requestComputerUseAppApproval?: StellaHostRunnerOptions["requestComputerUseAppApproval"];
  requestRuntimeAuthRefresh?: StellaHostRunnerOptions["requestRuntimeAuthRefresh"];
  requestChallengeToken?: StellaHostRunnerOptions["requestChallengeToken"];
  getDeviceSigner?: StellaHostRunnerOptions["getDeviceSigner"];
  scheduleApi?: ScheduleToolApi;
  runtimeStore: RuntimeStore;
  appendLocalChatEvent?: StellaHostRunnerOptions["appendLocalChatEvent"];
  /** Desktop's writer into a cloud conversation's DO-resident transcript. */
  cloudTranscript: import("./cloud-transcript-write.js").CloudTranscriptWriter;
  /** This computer's view of each cloud conversation's brain lease. */
  brainLeases: import("./brain-lease.js").BrainLeaseView;
  piCloudAgentThreads: PiCloudAgentThreads;
  /** The signed-in owner's current data epoch, which cloud writes are fenced by. */
  cloudOwnerGeneration: () => Promise<string>;
  linkedFilePublisher: import("../device-files/linked-file-publisher.js").LinkedFilePublisher;
  paths: RunnerPaths;
  state: RunnerState;
  hookEmitter: HookEmitter;
  toolHost: {
    getToolCatalog: (
      agentType?: string,
      options?: {
        model?: Pick<Model<Api>, "api" | "provider" | "id" | "name">;
        agentEngine?: import("../tools/file-edit-policy.js").FileEditAgentEngine;
        /** This thread was spawned by another agent; withhold orchestration tools. */
        parentOwned?: boolean;
      },
    ) => ToolMetadata[];
    executeTool: (
      toolName: string,
      toolArgs: Record<string, unknown>,
      context: ToolContext,
      signal?: AbortSignal,
      onUpdate?: ToolUpdateCallback,
    ) => Promise<ToolResult>;
    /** `executeTool` plus schema validation and before_tool/after_tool hooks. */
    executeToolCall: (
      toolName: string,
      toolArgs: Record<string, unknown>,
      context: ToolContext,
      signal?: AbortSignal,
      onUpdate?: ToolUpdateCallback,
    ) => Promise<ToolResult>;
    /** Stella's managed-shell environment, for CLIs that bring their own shell. */
    buildAgentShellEnvironment: (
      context: ToolContext,
      cwd: string,
    ) => Record<string, string>;
    /** Attach extension hooks to host-dispatched (nested, voice) tool calls. */
    setToolCallHooks: (hooks: Pick<HookEmitter, "emit"> | undefined) => void;
    endBrowserTurn: (
      runId: string,
      behavior: import("../browser-use/client.js").BrowserTurnEndBehavior,
    ) => Promise<void>;
    registerExtensionTools: (tools: ToolDefinition[]) => void;
    /** Sweep user-extension tools (F1 hot-reload). Built-ins are untouched. */
    unregisterExtensionTools: () => void;
    /** Running sessions owned by one conversation/thread across its runs. */
    listRunningShellSessionsOwnedBy: (
      access: import("../tools/shell.js").ShellSessionAccess,
    ) => string[];
    killAllShells: () => Promise<void>;
    killShell: (sessionId: string) => Promise<void> | void;
    shutdown: () => Promise<void>;
  };
};

/**
 * The agents a background command's exit wakes: how one stands, and the
 * wake itself. False from `deliver` keeps the exit batch for a retry.
 */
export type BackgroundExitTarget = {
  status: (agentId: string, conversationId: string) => Promise<string>;
  deliver: (wake: {
    conversationId: string;
    agentId: string;
    eventId: string;
    isCurrent: () => boolean;
    text: string;
  }) => Promise<boolean>;
};

/** An agent's `history.*` call, answered from its own thread (`setAgentHistoryQuery`). */
export type AgentHistoryQuery = (request: {
  conversationId: string;
  threadId: string;
  args: Record<string, unknown>;
}) => Promise<unknown>;

export type PiReportDelivery = (report: {
  conversationId: string;
  requestId: string;
  text: string;
}) => Promise<void>;

/**
 * Cloud agents pi's Stella starts on a model it names: dispatched through the
 * owner's agent threads as a cloud placement here is, so their reports come
 * back to this computer the same way.
 */
export type PiCloudAgentThreads = {
  /** What an agent on `model` (as `spawn_agent` names one) runs on in the cloud. */
  execution: (model: string | undefined) => Promise<import("@stella/contracts/agent-engine").CloudExecutionSelection>;
  start: (request: {
    conversationId: string;
    requestId: string;
    description: string;
    prompt: string;
    model: string;
    /** The agent that starts it, which its reports go back to; absent for Stella's own. */
    parentThreadId?: string;
    /** `spawn_agent`'s `workspace`: the size its cloud container starts at. */
    workspace?: import("@stella/contracts/turn-plane/turn-start").AgentWorkspaceSize;
  }) => Promise<{ threadId: string }>;
  startOnDevice: (request: {
    conversationId: string;
    requestId: string;
    description: string;
    prompt: string;
    targetDeviceId: string;
    model?: string;
    /** The agent that starts it, which its reports go back to; absent for Stella's own. */
    parentThreadId?: string;
  }) => Promise<{ threadId: string; waitingForDevice: boolean }>;
  message: (request: {
    conversationId: string;
    threadId: string;
    requestId: string;
    description: string;
    message: string;
    /** `message` is already framed as the agent reads it. */
    framed?: boolean;
  }) => Promise<"steered" | "resumed">;
  /** `stop_agent` for one of them: it and every agent it started stop, wherever they run. */
  stop: (request: {
    conversationId: string;
    threadId: string;
    requestId: string;
  }) => Promise<AgentThreadCalls["agentThreads.stop"]["result"]>;
};

export type RunnerPublicApi = {
  deviceId: string;
  hookEmitter: HookEmitter;
  piCloudAgentThreads: PiCloudAgentThreads;
  setPiReportDelivery: (delivery: PiReportDelivery | null) => void;
  setAgentHistoryQuery: (query: AgentHistoryQuery | null) => void;
  setBackgroundExitTarget: (target: BackgroundExitTarget | null) => void;
  /**
   * The exit wakes of shells a finished run left running: `arm` watches the
   * sessions it names for the agent, `disarm` drops them when it runs again.
   */
  backgroundExits: {
    arm: (args: {
      conversationId: string;
      agentId: string;
      runningSessionIds: string[];
      interrupted?: boolean;
    }) => string[];
    disarm: (owner: { conversationId: string; agentId: string }) => void;
    runningSessions: (owner: { conversationId: string; agentId: string }) => string[];
  };
  deliverOrchestratorNote: PiReportDelivery;
  setBackendUrl: (value: string | null) => void;
  setAuthToken: (value: string | null) => void;
  setHasConnectedAccount: (value: boolean) => void;
  setCloudSyncEnabled: (enabled: boolean) => void;
  start: () => void;
  stop: () => Promise<void>;
  waitUntilInitialized: () => Promise<void>;
  getStellaSiteAuth: () => { baseUrl: string; authToken: string } | null;
  /** The owner's devices and media access, as an orchestrator turn reads them (`loadDeviceExecutionContext`). */
  loadExecutionContext: () => Promise<
    import("@stella/contracts/execution-context").ExecutionContextSnapshot | undefined
  >;
  killAllShells: () => Promise<void>;
  /** Stella's tools for the pi-durable harness. */
  piTools: import("./pi-tools.js").RunnerPiTools;
  agentHealthCheck: () => AgentHealth;
  warmModelCatalog: () => Promise<void>;
  /**
   * Resolve the provider/model an agent's turn would run on, for sizing
   * composer image attachments to that provider's limits. Returns null when
   * no route resolves (signed out, misconfigured pick).
   */
  resolveImageTarget: (
    agentType?: string,
  ) => Promise<Pick<ImageCapTarget, "provider" | "api" | "modelId"> | null>;
  webSearch: (
    query: string,
    options?: { category?: string },
  ) => Promise<{
    text: string;
    results: Array<{ title: string; url: string; snippet: string }>;
  }>;
  /**
   * Share the local files and folders `text` links with the owner's other
   * devices: an agent report written here, delivered to a chat elsewhere.
   */
  publishLinkedFiles: (text: string) => void;
  restoreClaudeCodeSession: (args: {
    threadId: string;
    cwd?: string;
    atJournalSeq?: number;
  }) => Promise<
    import("./claude-session-sync.js").ClaudeSessionRestoreResult | null
  >;
  flushClaudeSessionSync: (timeoutMs?: number) => Promise<boolean>;
  /** This computer's view of each cloud conversation's brain lease, which reads of the record feed. */
  brainLeases: Pick<import("./brain-lease.js").BrainLeaseView, "note" | "holds" | "claim" | "beganUnder">;
  /**
   * A cloud-stored conversation's journal for a transcript this computer
   * mirrors into it (pi-durable): the local-turn begin and finish, the
   * out-of-turn append, and the owner epoch they are fenced by.
   */
  cloudJournal: {
    begin: import("./cloud-transcript-write.js").CloudTranscriptWriter["begin"];
    promptSeq: import("./cloud-transcript-write.js").CloudTranscriptWriter["promptSeq"];
    finish: import("./cloud-transcript-write.js").CloudTranscriptWriter["finish"];
    append: import("./cloud-transcript-write.js").CloudTranscriptWriter["append"];
    history: import("./cloud-transcript-write.js").CloudTranscriptWriter["history"];
    priorTurnPromptSeq: import("./cloud-transcript-write.js").CloudTranscriptWriter["priorTurnPromptSeq"];
    ownerGeneration: () => Promise<string>;
  };
  /**
   * This computer's agents in a conversation stored in the cloud, as the
   * owner's agent threads list them (a paired phone shows and messages
   * them): each attempt's start and its end, through a durable outbox.
   */
  computerAgents: {
    start: import("./computer-agent-cloud-records.js").ComputerAgentCloudRecords["create"];
    complete: import("./computer-agent-cloud-records.js").ComputerAgentCloudRecords["complete"];
    /**
     * Settle every agent the owner's records say runs on this computer and
     * does not (`computer-agent-reconcile`). `elsewhere` stands for agents
     * the agent loops do not run (pi-durable's).
     */
    reconcile: (
      elsewhere: (
        threadId: string,
      ) => Promise<import("./computer-agent-reconcile.js").ComputerAgentStanding | undefined>,
    ) => Promise<{ settled: string[] }>;
  };
  /**
   * The owner's agent threads, for the pi agents' directory: a cloud
   * conversation's agents elsewhere and the user's cloud sessions, and a
   * note for one of them. Throws when not signed in.
   */
  agentThreads: {
    directory: (
      conversationId: string,
      threadIds?: string[],
    ) => Promise<AgentThreadCalls["agentThreads.directory"]["result"]>;
    message: (
      args: Omit<AgentThreadCalls["agentThreads.message"]["args"], "ownerGeneration">,
    ) => Promise<AgentThreadCalls["agentThreads.message"]["result"]>;
    stop: (
      args: Omit<AgentThreadCalls["agentThreads.stop"]["args"], "ownerGeneration">,
    ) => Promise<AgentThreadCalls["agentThreads.stop"]["result"]>;
    note: (args: {
      noteId: string;
      conversationId: string;
      fromThreadId: string;
      text: string;
    }) => Promise<void>;
    /** One of this computer's agents moving itself to another computer (`switch_destination`). */
    handoff: (
      args: Omit<AgentThreadCalls["agentThreads.handoff"]["args"], "ownerGeneration" | "fromDeviceId">,
    ) => Promise<AgentThreadCalls["agentThreads.handoff"]["result"]>;
  };
  /** Every agent's conversation in the owner's cloud (`@stella/contracts/backend/agent-logs`). */
  agentLogs: {
    append: (
      args: import("@stella/contracts/backend/agent-logs").AgentLogCalls["agentLogs.append"]["args"],
    ) => Promise<import("@stella/contracts/backend/agent-logs").AgentLogCalls["agentLogs.append"]["result"]>;
    read: (
      args: import("@stella/contracts/backend/agent-logs").AgentLogCalls["agentLogs.read"]["args"],
    ) => Promise<import("@stella/contracts/backend/agent-logs").AgentLogCalls["agentLogs.read"]["result"]>;
  };
  googleWorkspaceGetAuthStatus: () => Promise<{
    connected: boolean;
    unavailable?: boolean;
    email?: string;
    name?: string;
  }>;
  googleWorkspaceConnect: () => Promise<{
    connected: boolean;
    unavailable?: boolean;
    email?: string;
    name?: string;
  }>;
  googleWorkspaceDisconnect: () => Promise<{ ok: boolean }>;
};
