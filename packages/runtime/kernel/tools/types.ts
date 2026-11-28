import type { TaskLifecycleStatus } from "@stella/contracts/agent-runtime";
import type {
  AgentModelConfigSnapshot,
} from "@stella/contracts/agent-engine";
import type {
  LocalCronJobCreateInput,
  LocalCronJobRecord,
  LocalCronJobUpdatePatch,
  LocalHeartbeatConfigRecord,
  LocalHeartbeatUpsertInput,
} from "@stella/contracts/scheduling";
import type { ToolReplayPolicy } from "./defs/replay-policy.js";

export type ToolProcessIdentity = {
  uid: number;
  gid: number;
  home: string;
  user: string;
  requireNoNewPrivileges?: true;
};

export type AuthorizedToolImage = {
  data: Uint8Array;
  mimeType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  sourcePath: string;
};

export const TOOL_RESULT_AUTHORIZED_IMAGES = Symbol(
  "stella.tool-result.authorized-images",
);

export type ToolContext = {
  executionHost: "device" | "sandbox";
  conversationId: string;
  deviceId: string;
  requestId: string;
  /** Set for a call made from inside a `code` cell: unique per call there, and the same when the cell runs again. */
  nestedCallId?: string;
  runId?: string;
  rootRunId?: string;
  attemptGeneration?: number;
  agentType?: string;
  workingDirectory?: string;
  stellaAppDir?: string;
  stellaDataDir?: string;
  toolWorkspaceRoot?: string;
  agentWorkingDirectory?: string;
  toolProcessIdentity?: ToolProcessIdentity;
  toolStateRoot?: string;
  storageMode?: "cloud" | "local";
  ownerGeneration?: string;
  agentId?: string;
  parentAgentId?: string;
  agentDepth?: number;
  maxAgentDepth?: number;
  fromUser?: boolean;
  modelConfigSnapshot?: AgentModelConfigSnapshot;
  allowedToolNames?: string[];
  deferImageDeliveryAck?: boolean;
  connectorDeliveryTarget?: {
    requestId: string;
    conversationId: string;
    provider?: string;
    externalMessageId?: string;
  };
};

export type ToolResult = {
  result?: unknown;
  details?: unknown;
  error?: string;
  modelOutputTokens?: number;
  [TOOL_RESULT_AUTHORIZED_IMAGES]?: readonly AuthorizedToolImage[];
};

export type ToolUpdateCallback = (update: ToolResult) => void;

export type ToolHeldCallback = (held: boolean) => void;

export type ToolHandlerExtras = {
  signal?: AbortSignal;
  onUpdate?: ToolUpdateCallback;
  /** Told while the call waits on the user or a held media call inside it, so a long-call watchdog pauses. */
  onHeld?: ToolHeldCallback;
};

export type ToolMetadata = {
  name: string;
  label?: string;
  workingText?: string;
  description: string;
  parameters: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  resultSchema?: Record<string, unknown>;
  approval?: unknown;
  sideEffects?: unknown;
  replay?: ToolReplayPolicy;
  reversible?: boolean;
  annotations?: Record<string, unknown>;
  demoted?: {
    searchTerms?: readonly string[];
    requiredConnectorProvider?: string;
  };
  agentTypes?: readonly string[];
  awaitsUser?: boolean;
};

export type ShellRecord = {
  id: string;
  command: string;
  cwd: string;
  output: string;
  running: boolean;
  exitCode: number | null;
  startedAt: number;
  completedAt: number | null;
  kill: () => void | Promise<void>;
};

export type AgentToolSnapshot = {
  id: string;
  status: TaskLifecycleStatus;
  description: string;
  modelConfigSnapshot?: AgentModelConfigSnapshot;
  startedAt: number;
  completedAt: number | null;
  result?: string;
  error?: string;
  recentActivity?: string[];
  messages?: Array<{
    from: "orchestrator" | "subagent";
    text: string;
    timestamp: number;
  }>;
};

export type CloudBrowserBridge = {
  methods: readonly string[];
  call(method: string, args: readonly unknown[], signal: AbortSignal): Promise<unknown>;
  awaitsUser(method: string): boolean;
};

export type ToolHostOptions = {
  stellaAppDir: string;
  recoverStaleSecrets?: boolean;
  enableShellShims?: boolean;
  shellsEndWithTurn?: boolean;
  allowCloudCode?: boolean;
  cloudBrowser?: CloudBrowserBridge;
  browserSessionFactory?: import("../browser-use/client.js").BrowserSessionFactory;
  stellaBrowserBinPath?: string;
  stellaOfficeBinPath?: string;
  stellaComputerCliPath?: string;
  stellaMediaCliPath?: string;
  stellaXApiCliPath?: string;
  cliBridgeSocketPath?: string;
  deviceId?: string;
  scheduleApi?: ScheduleToolApi;
  extensionTools?: import("../extensions/types.js").ToolDefinition[];
  webSearch?: (
    query: string,
    options?: { category?: string },
  ) => Promise<{
    text: string;
    results?: Array<{ title: string; url: string; snippet: string }>;
  }>;
  getStellaSiteAuth?: () => { baseUrl: string; authToken: string } | null;
  getCloudBackendAuth?: () => { baseUrl: string; authToken: string } | null;
  codeConnectClient?: import("../connectors/connect-service.js").ReplConnectClient;
  codeHistoryQuery?: (
    args: Record<string, unknown>,
    context: ToolContext,
  ) => Promise<unknown>;
  agentHistoryQuery?: (
    args: Record<string, unknown>,
    context: ToolContext,
  ) => Promise<unknown>;
  stellaDataDir?: string;
  askUser?: import("./user.js").UserToolsConfig["askUser"];
  requestSecureInput?: import("./user.js").UserToolsConfig["requestSecureInput"];
  useSecureValue?: import("./user.js").UserToolsConfig["useSecureValue"];
  revealSecureValueForFill?: import("./user.js").UserToolsConfig["revealSecureValueForFill"];
  requestBrowserExtensionConnect?: import("./browser-extension-offer.js").BrowserExtensionConnectRequester;
  requestConnectorConnection?: import("./defs/connector-status.js").ConnectorConnectionRequester;
};

export type ScheduleToolApi = {
  listCronJobs: () => Promise<LocalCronJobRecord[]>;
  listHeartbeats: () => Promise<LocalHeartbeatConfigRecord[]>;
  addCronJob: (input: LocalCronJobCreateInput) => Promise<LocalCronJobRecord>;
  updateCronJob: (
    jobId: string,
    patch: LocalCronJobUpdatePatch,
  ) => Promise<LocalCronJobRecord | null>;
  removeCronJob: (jobId: string) => Promise<boolean>;
  runCronJob: (jobId: string) => Promise<LocalCronJobRecord | null>;
  getHeartbeatConfig: (
    conversationId: string,
  ) => Promise<LocalHeartbeatConfigRecord | null>;
  upsertHeartbeat: (
    input: LocalHeartbeatUpsertInput,
  ) => Promise<LocalHeartbeatConfigRecord>;
  runHeartbeat: (
    conversationId: string,
  ) => Promise<LocalHeartbeatConfigRecord | null>;
};

export type ToolHandler = (
  args: Record<string, unknown>,
  context: ToolContext,
  extras?: ToolHandlerExtras,
) => Promise<ToolResult>;

export type { ToolReplayPolicy };

export type ToolDefinition = {
  name: string;
  label?: string;
  workingText?: string;
  description: string;
  parameters: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  resultSchema?: Record<string, unknown>;
  approval?: unknown;
  sideEffects?: unknown;
  replay?: ToolReplayPolicy;
  reversible?: boolean;
  annotations?: Record<string, unknown>;
  agentTypes?: readonly string[];
  awaitsUser?: boolean;
  demoted?: {
    searchTerms?: readonly string[];
    requiredConnectorProvider?: string;
  };
  execute: ToolHandler;
};

export const nestedToolCallId = (outerCallId: string, toolName: string, sequence: number): string =>
  `${outerCallId}\0${toolName}\0${sequence}`;

/** The id of this exact tool call: a nested call's own id inside a `code` cell, or the model's tool call id. */
export const toolCallIdentity = (context: Pick<ToolContext, "requestId" | "nestedCallId">): string =>
  context.nestedCallId ?? context.requestId;
