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
  backendUrl: string | null;
  authToken: string | null;
  hasConnectedAccount: boolean;
  cloudSyncEnabled: boolean;
  isRunning: boolean;
  isInitialized: boolean;
  initializationPromise: Promise<void> | null;
  initializationStarted: import("../shared/readiness-latch.js").ReadinessLatch;
  backgroundExitWake: BackgroundExitWake | null;
  backgroundExitTarget?: BackgroundExitTarget;
  piReportDelivery?: PiReportDelivery;
  agentHistoryQuery?: AgentHistoryQuery;
  loadedAgents: ParsedAgentLike[];
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
  requestRuntimeAuthRefresh?: StellaHostRunnerOptions["requestRuntimeAuthRefresh"];
  requestChallengeToken?: StellaHostRunnerOptions["requestChallengeToken"];
  getDeviceSigner?: StellaHostRunnerOptions["getDeviceSigner"];
  scheduleApi?: ScheduleToolApi;
  runtimeStore: RuntimeStore;
  appendLocalChatEvent?: StellaHostRunnerOptions["appendLocalChatEvent"];
  cloudTranscript: import("./cloud-transcript-write.js").CloudTranscriptWriter;
  brainLeases: import("./brain-lease.js").BrainLeaseView;
  piCloudAgentThreads: PiCloudAgentThreads;
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
    executeToolCall: (
      toolName: string,
      toolArgs: Record<string, unknown>,
      context: ToolContext,
      signal?: AbortSignal,
      onUpdate?: ToolUpdateCallback,
    ) => Promise<ToolResult>;
    buildAgentShellEnvironment: (
      context: ToolContext,
      cwd: string,
    ) => Record<string, string>;
    setToolCallHooks: (hooks: Pick<HookEmitter, "emit"> | undefined) => void;
    endBrowserTurn: (
      runId: string,
      behavior: import("../browser-use/client.js").BrowserTurnEndBehavior,
    ) => Promise<void>;
    releaseAgentComputerSessions: (agentId: string) => Promise<number>;
    registerExtensionTools: (tools: ToolDefinition[]) => void;
    unregisterExtensionTools: () => void;
    listRunningShellSessionsOwnedBy: (
      access: import("../tools/shell.js").ShellSessionAccess,
    ) => string[];
    killAllShells: () => Promise<void>;
    killShell: (sessionId: string) => Promise<void> | void;
    shutdown: () => Promise<void>;
  };
};

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

export type AgentHistoryQuery = (request: {
  conversationId: string;
  threadId: string;
  args: Record<string, unknown>;
}) => Promise<unknown>;

export type PiReportDelivery = (report: {
  conversationId: string;
  requestId: string;
  text: string;
  agentReport?: import("@stella/contracts/agent-wake-prompt").AgentReportEnvelope;
}) => Promise<void>;

export type PiCloudAgentThreads = {
  execution: (model: string | undefined) => Promise<import("@stella/contracts/agent-engine").CloudExecutionSelection>;
  start: (request: {
    conversationId: string;
    requestId: string;
    description: string;
    prompt: string;
    model: string;
    parentThreadId?: string;
    workspace?: import("@stella/contracts/turn-plane/turn-start").AgentWorkspaceSize;
  }) => Promise<{ threadId: string }>;
  startOnDevice: (request: {
    conversationId: string;
    requestId: string;
    description: string;
    prompt: string;
    targetDeviceId: string;
    model?: string;
    parentThreadId?: string;
  }) => Promise<{ threadId: string; waitingForDevice: boolean }>;
  message: (request: {
    conversationId: string;
    threadId: string;
    requestId: string;
    description: string;
    message: string;
    framed?: boolean;
  }) => Promise<"steered" | "resumed">;
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
  pushedDevices: () => import("@stella/contracts/turn-plane/placement").DeviceDestination[] | undefined;
  loadExecutionContext: () => Promise<
    import("@stella/contracts/execution-context").ExecutionContextSnapshot | undefined
  >;
  killAllShells: () => Promise<void>;
  piTools: import("./pi-tools.js").RunnerPiTools;
  agentHealthCheck: () => AgentHealth;
  warmModelCatalog: () => Promise<void>;
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
  publishLinkedFiles: (text: string) => void;
  restoreClaudeCodeSession: (args: {
    threadId: string;
    cwd?: string;
    atJournalSeq?: number;
  }) => Promise<
    import("./claude-session-sync.js").ClaudeSessionRestoreResult | null
  >;
  flushClaudeSessionSync: (timeoutMs?: number) => Promise<boolean>;
  brainLeases: Pick<import("./brain-lease.js").BrainLeaseView, "note" | "holds" | "claim" | "beganUnder">;
  cloudJournal: {
    begin: import("./cloud-transcript-write.js").CloudTranscriptWriter["begin"];
    promptSeq: import("./cloud-transcript-write.js").CloudTranscriptWriter["promptSeq"];
    finish: import("./cloud-transcript-write.js").CloudTranscriptWriter["finish"];
    append: import("./cloud-transcript-write.js").CloudTranscriptWriter["append"];
    history: import("./cloud-transcript-write.js").CloudTranscriptWriter["history"];
    priorTurnPromptSeq: import("./cloud-transcript-write.js").CloudTranscriptWriter["priorTurnPromptSeq"];
    ownerGeneration: () => Promise<string>;
  };
  computerAgents: {
    start: import("./computer-agent-cloud-records.js").ComputerAgentCloudRecords["create"];
    complete: import("./computer-agent-cloud-records.js").ComputerAgentCloudRecords["complete"];
    reconcile: (
      elsewhere: (
        threadId: string,
      ) => Promise<import("./computer-agent-reconcile.js").ComputerAgentStanding | undefined>,
    ) => Promise<{ settled: string[] }>;
  };
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
    handoff: (
      args: Omit<AgentThreadCalls["agentThreads.handoff"]["args"], "ownerGeneration" | "fromDeviceId">,
    ) => Promise<AgentThreadCalls["agentThreads.handoff"]["result"]>;
  };
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
