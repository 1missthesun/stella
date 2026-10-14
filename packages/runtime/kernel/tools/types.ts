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

export type ToolHandlerExtras = {
  signal?: AbortSignal;
  onUpdate?: ToolUpdateCallback;
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

export type ToolHostOptions = {
  stellaAppDir: string;
  recoverStaleSecrets?: boolean;
  enableShellShims?: boolean;
  allowCloudCode?: boolean;
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
  promptSnippet?: string;
  demoted?: {
    searchTerms?: readonly string[];
    requiredConnectorProvider?: string;
  };
  execute: ToolHandler;
};

