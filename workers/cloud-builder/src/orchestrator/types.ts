import type { AgentActivityEntry } from "@stella/contracts/conversation-agent-activity";
import type { CloudExecutionSelection } from "@stella/contracts/agent-engine";
import type { ManagedModelAudience } from "@stella/contracts/gateway/capability";
import type {
  CloudTurnContext,
  CloudTurnLane,
  CloudTurnSource,
} from "@stella/contracts/turn-plane/turn-start";
import type { MintedTurnCapability } from "../capability-signer.js";
import type { CloudAgentControlReceipt } from "../cloud-agent-dispatch.js";
import type { TurnPhase } from "../conversation-types.js";
import type { LocalTerminalPhase } from "../local-turn-protocol.js";

export type WakeReport = { prompt: string; lifecycleReport?: string };

/**
 * Binding names/types come from Wrangler. Storage fields remain optional here
 * solely for rolling-deploy compatibility.
 */
export type Env = Pick<
  Cloudflare.Env,
  | "BUILD_SESSIONS"
  | "ORCHESTRATOR_SESSIONS"
  | "OWNER_GATES"
  | "WORLDS"
  | "LOADER"
  | "BUILDER_SERVICE_SECRET"
> &
  Partial<
    Pick<
      Cloudflare.Env,
      | "AGENT_HOME"
      | "BACKUP_BUCKET"
      | "CONVERSATION_ARCHIVE"
      | "MODEL_GATEWAY"
      | "MODEL_GATEWAY_CONTROL"
      | "MODEL_GATEWAY_OWNERS"
      | "MODEL_GATEWAY_URL"
      | "Sandbox"
      | "SANDBOX_IDLE_TIMEOUT_MS"
      | "CLOUD_BUILDER_PUBLIC_URL"
      | "CAPABILITY_SIGNING_KEY"
      | "CAPABILITY_SIGNING_KID"
      | "DB"
      | "IMAGES"
    >
  >;

export type ChatTurnRequest = {
  kind: "chat";
  ownerId: string;
  ownerGeneration: string;
  conversationId: string;
  turnId: string;
  sessionId: string;
  prompt: string;
  execution: CloudExecutionSelection;
  audience: ManagedModelAudience;
  budgetMicroCents: number;
  lane: CloudTurnLane;
  source?: CloudTurnSource;
  title?: string;
  hiddenMessage?: boolean;
  clientMsgId: string;
  originUserMessageId?: string;
  locale?: string;
  timeZone?: string;
  attachments?: string[];
  context?: CloudTurnContext;
  agentThreadControl?: CloudAgentControlReceipt;
  piAgent?: import("@stella/contracts/turn-plane/turn-start").CloudPiAgentRequest;
  wakeReportSpillKey?: string;
  watchdogMs?: number;
  ownerPurgeGeneration?: string;
  ownerPurgeLeaseId?: string;
  queuedAt?: number;
};

export type ChatTurnAdmissionReceipt = {
  schemaVersion: 2;
  fingerprint: string;
  ownerId: string;
  ownerGeneration: string;
  turnId: string;
  leaseId: string;
  phase: "registering" | "accepted";
  createdConversation: boolean;
  queuedAt: number;
  acceptedAt?: number;
  createdAt: number;
  updatedAt: number;
};

export type OwnerFencedTurn = {
  ownerId: string;
  ownerGeneration: string;
  turnId: string;
  ownerPurgeGeneration?: string;
  ownerPurgeLeaseId?: string;
};

export type OwnerFenceLeaseReceipt = {
  schemaVersion: 1;
  ownerId: string;
  ownerGeneration: string;
  turnId: string;
  leaseId: string;
  kind: "run" | "aux";
  phase: "registering" | "registered" | "unregister_pending";
  registrationGeneration?: string;
  runSlotKey?: string;
  operationFingerprint?: string;
  createdAt: number;
  updatedAt: number;
};

export type OwnerFenceRunSlot = {
  schemaVersion: 1;
  ownerId: string;
  ownerGeneration: string;
  turnId: string;
  leaseId: string;
};

export type OwnerFenceRegisterRequest = {
  ownerGeneration: string;
  leaseId: string;
  sessionId: string;
  turnId: string;
  namespace: "orchestrator";
  role: "orchestrator";
  generation?: string;
};

export type OwnerFenceRegisterTransport = (
  ownerId: string,
  body: OwnerFenceRegisterRequest,
) => Promise<{ generation: string } | null>;

export type LocalTurnLease = OwnerFencedTurn & {
  deviceId: string;
  localTurnId: string;
  leaseToken: string;
  expiresAt: number;
  beginFingerprint: string;
  finishFingerprint?: string;
  cancelRequested?: boolean;
  cancelDeadlineAt?: number;
  clientMsgId?: string;
};

export type LocalTurnFinishReceipt = {
  ownerGeneration: string;
  turnId: string;
  deviceId: string;
  localTurnId: string;
  leaseToken: string;
  phase: LocalTerminalPhase;
  firstSeq: number;
  lastSeq: number;
  epoch: number;
  finishFingerprint?: string;
  externallyCanceled?: boolean;
};

export type PiThreadOutcome = {
  status: "completed" | "failed" | "canceled";
  resultJson?: string;
  errorMessage?: string;
  files?: import("../pi-runtime.js").PiDeliveredFile[];
};

type PiThreadAttemptRecord = {
  turnId: string;
  attemptGeneration: number;
  handedOff?: true;
  pausing?: true;
  terminal?: PiThreadOutcome & { completedAt: number };
};

export type PiThreadRecord = {
  ownerId: string;
  ownerGeneration: string;
  threadId: string;
  description: string;
  originDeviceId?: string;
  attempts: PiThreadAttemptRecord[];
  settledThrough: number;
};

export type BrainHandoff = {
  turnId: string;
  ownerId: string;
  ownerGeneration: string;
  deviceId: string;
  clientMsgId: string;
  prompt: string;
};

export type AgentsView = {
  pi: AgentActivityEntry[];
  owner: AgentActivityEntry[];
};

export type HarnessExecution = Exclude<
  CloudExecutionSelection,
  { engine: "anthropic" }
>;

export type ChatTurnResumeRecord = { turnId: string; count: number };
export type PersistedChatTurnModelCapability = {
  turnId: string;
  capability: MintedTurnCapability;
};

export type CloudContextComponent =
  | "canonical_prompt"
  | "canonical_history"
  | "agent_home_memory"
  | "agent_home_personality"
  | "skill_catalog";

export type OwedTerminal = {
  kind: TurnPhase;
  message: string;
  payload?: Record<string, unknown>;
  eventSeq?: number;
};
