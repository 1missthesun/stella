import type { CloudExecutionSelection } from "../agent-engine.js";
import type { CloudOrchestratorCliTurnSpec } from "../cloud-orchestrator-cli.js";

export const TURN_PLANE_PROTOCOL = 1 as const;

export const TURN_START_PATH_PREFIX = "/conversations" as const;
export const turnStartPath = (conversationId: string): string =>
  `${TURN_START_PATH_PREFIX}/${encodeURIComponent(conversationId)}/turns`;

export const TURN_OWNER_ID_HEADER = "x-stella-owner-id" as const;
export const TURN_OWNER_GENERATION_HEADER =
  "x-stella-owner-generation" as const;

export type CloudTurnLane = "chat" | "wake" | "schedule";

export type CloudTurnSource =
  | "desktop"
  | "web"
  | "mobile"
  | "schedule"
  | "agent-thread"
  | "placement"
  | "probe"
  | "slack";

export const CLIENT_MSG_ID_PATTERN = /^[A-Za-z0-9._:-]{8,64}$/;
export const CONVERSATION_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;
export const TURN_PROMPT_MAX_CHARS = 8_000;
export const TURN_ATTACHMENTS_MAX = 4;
export const TURN_TITLE_MAX_CHARS = 120;
export const TURN_CONTEXT_TEXT_MAX_CHARS = 400_000;
export const TURN_CONTEXT_DISPLAY_MAX_CHARS = 64_000;

export type CloudTurnContext = {
  text?: string;
  display?: Record<string, unknown>;
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export const parseCloudTurnContext = (value: unknown): CloudTurnContext | null => {
  if (!isPlainRecord(value)) return null;
  const context: CloudTurnContext = {};
  if (value.text !== undefined) {
    if (typeof value.text !== "string" || value.text.length > TURN_CONTEXT_TEXT_MAX_CHARS) return null;
    if (value.text.trim()) context.text = value.text;
  }
  if (value.display !== undefined) {
    if (!isPlainRecord(value.display)) return null;
    if (JSON.stringify(value.display).length > TURN_CONTEXT_DISPLAY_MAX_CHARS) return null;
    if (Object.keys(value.display).length > 0) context.display = value.display;
  }
  return context;
};

export type CloudAgentThreadControl = {
  lifecycleReport?: string;
  threadId: string;
  attemptGeneration: number;
  threadUpdatedAt: number;
  status:
    | "running"
    | "waiting_for_user"
    | "resuming"
    | "completed"
    | "failed"
    | "canceled";
};

export type CloudAgentRuntime = "pi";

export type CloudPiAgentRequest = {
  op: "start";
  threadId: string;
  description?: string;
};

export const PI_AGENT_THREAD_ID_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export type CloudTurnStartRequest = {
  protocol: typeof TURN_PLANE_PROTOCOL;
  clientMsgId: string;
  originUserMessageId?: string;
  prompt: string;
  execution?: CloudExecutionSelection;
  locale?: string;
  attachments?: string[];
  context?: CloudTurnContext;
  lane?: CloudTurnLane;
  source?: CloudTurnSource;
  title?: string;
  hiddenMessage?: boolean;
  agentThreadControl?: CloudAgentThreadControl;
  agentRuntime?: CloudAgentRuntime;
  piAgent?: CloudPiAgentRequest;
};

export type CloudTurnStartResponse = {
  protocol: typeof TURN_PLANE_PROTOCOL;
  conversationId: string;
  turnId: string;
  accepted: true;
  replayed: boolean;
  createdConversation: boolean;
};

export type CloudTurnStartErrorCode =
  | "unauthorized"
  | "forbidden"
  | "owner_mismatch"
  | "bad_request"
  | "conversation_locked"
  | "idempotency_conflict"
  | "owner_purged"
  | "generation_stale"
  | "execution_unavailable"
  | "sign_in_required"
  | "subscription_required"
  | "usage_limit"
  | "billing_unavailable"
  | "owner_suspended"
  | "internal";

export type CloudTurnStartError = {
  error: {
    code: CloudTurnStartErrorCode;
    message: string;
    retryable: boolean;
    retryAfterMs?: number;
  };
};

export type CloudAgentTurnSource =
  | "desktop"
  | "placement"
  | "agent-thread"
  | "orchestrator";

export type AgentWorkspaceSize = "large";

export type CloudAgentTurnStartRequest = {
  protocol: typeof TURN_PLANE_PROTOCOL;
  kind: "agent";
  ownerId: string;
  ownerGeneration: string;
  conversationId: string;
  threadId: string;
  agentDepth: number;
  parentThreadId?: string;
  attemptGeneration: number;
  turnId?: string;
  prompt: string;
  description: string;
  execution: CloudExecutionSelection;
  audience: string;
  budgetMicroCents: number;
  source: CloudAgentTurnSource;
  clientMsgId?: string;
  parentTurnId?: string;
  originDeviceId?: string;
  originConversationId?: string;
  workspace?: AgentWorkspaceSize;
  agentRole?: "orchestrator";
  orchestratorCli?: CloudOrchestratorCliTurnSpec;
};

export type CloudAgentTurnStartResponse = {
  protocol: typeof TURN_PLANE_PROTOCOL;
  threadId: string;
  turnId: string;
  attemptGeneration: number;
  accepted: true;
  replayed: boolean;
};
