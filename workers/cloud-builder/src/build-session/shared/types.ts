import type { CloudExecutionSelection } from "@stella/contracts/agent-engine";
import type { VerifiedToken } from "../../auth-jwt.js";
import type { CloudOrchestratorCliTurnSpec } from "@stella/contracts/cloud-orchestrator-cli";
import type { ManagedModelAudience } from "@stella/contracts/gateway/capability";
import type {
  TurnBrokerTurnStateCheckpointReceipt,
  TurnBrokerTurnStateCheckpointRequest,
} from "@stella/contracts/turn-credential-broker";
import type { InstanceSize } from "../../instance-size.js";

export type Execution = {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type TurnRequest = {
  kind: "agent";
  ownerId: string;
  appId: string;
  turnId: string;
  prompt: string;
  description?: string;
  source?: string;
  clientMsgId?: string;
  parentTurnId?: string;
  parentThreadId?: string;
  agentDepth: number;
  agentRole?: "orchestrator";
  orchestratorCli?: CloudOrchestratorCliTurnSpec;
  orchestratorCliDigest?: string;
  originDeviceId?: string;
  originConversationId?: string;
  workspace?: "large";
  preflightDelayMs?: number;
  watchdogMs?: number;
  conversationId?: string;
  sessionId?: string;
  threadId?: string;
  execution?: CloudExecutionSelection;
  audience: ManagedModelAudience;
  budgetMicroCents: number;
  ownerGeneration: string;
  attemptGeneration?: number;
  turnBrokerRoute?: {
    sessionId: string;
    endpoint: string;
  };
  ownerPurgeGeneration?: string;
  ownerPurgeLeaseId?: string;
  gateAdmittedByCaller?: boolean;
};

export type BuildOwnerFenceLeaseReceipt = {
  schemaVersion: 1;
  ownerId: string;
  ownerGeneration: string;
  turnId: string;
  leaseId: string;
  kind: "run" | "aux";
  phase: "registering" | "registered" | "unregister_pending";
  registrationGeneration?: string;
  slotKey?: string;
  createdAt: number;
  updatedAt: number;
};

export type BuildOwnerFenceLeaseSlot = {
  schemaVersion: 1;
  ownerId: string;
  ownerGeneration: string;
  turnId: string;
  leaseId: string;
  kind: "run" | "aux";
};

export type TurnStateCheckpointOperation =
  | {
      state: "pending";
      turnId: string;
      attemptGeneration: number;
      requestId: string;
      requestFingerprint: string;
      createdAt: number;
      operationId?: string;
      payload?: TurnBrokerTurnStateCheckpointRequest;
    }
  | {
      state: "succeeded";
      turnId: string;
      attemptGeneration: number;
      requestId: string;
      requestFingerprint: string;
      createdAt: number;
      payload: TurnBrokerTurnStateCheckpointRequest;
      operationId: string;
      receipt: TurnBrokerTurnStateCheckpointReceipt;
    }
  | {
      state: "failed";
      turnId: string;
      attemptGeneration: number;
      requestId: string;
      requestFingerprint: string;
      createdAt: number;
      operationId?: string;
      payload?: TurnBrokerTurnStateCheckpointRequest;
      status: number;
    };

export type BuilderFallbackTranscript = {
  schemaVersion: 1;
  turnId: string;
  attemptGeneration: number;
  requestId: string;
  requestFingerprint: string;
  createdAt: number;
  payload: TurnBrokerTurnStateCheckpointRequest;
  messages: Array<{ ordinal: number; role: string; payloadJson: string }>;
  checkpointReceipt?: TurnBrokerTurnStateCheckpointReceipt;
  transcriptCommitted: boolean;
  workspacePublished: boolean;
};

export type AgentExecutionMarker = {
  schemaVersion: 1;
  turnId: string;
  attemptGeneration: number;
  sandboxId: string;
  size: InstanceSize;
  startedAt: number;
};

export type BuilderFallbackInput = {
  historyCursor?: string;
  messages?: Array<{ ordinal: number; role: string; payloadJson: string }>;
  nativeCheckpoint?: TurnBrokerTurnStateCheckpointRequest["nativeCheckpoint"];
};

export type AgentExecutorResult = {
  outcome?: "completed";
  ok: boolean;
  finalText?: string;
  error?: string;
  waitingFor?: string;
  usage?: Record<string, unknown>;
  checkpointPolicy?: "preserve_prior" | "builder_fallback";
  checkpointMs?: number;
  timings?: Record<string, number>;
  turnStateCheckpoint?: TurnBrokerTurnStateCheckpointReceipt;
  builderFallback?: {
    historyCursor: string;
    messages: Array<{ ordinal: number; role: string; payloadJson: string }>;
    nativeCheckpoint?: TurnBrokerTurnStateCheckpointRequest["nativeCheckpoint"];
  };
};

export type PendingTerminal = {
  turnId: string;
  attemptGeneration: number;
  kind: "completed" | "failed" | "canceled";
  eventKind?: "timeout";
  payload: Record<string, unknown>;
  threadError?: string;
  terminateSandbox?: boolean;
  eventSeq?: number;
  completedAt?: number;
};

export type ConversationCaller = {
  ownerId: string;
  subject: string;
  sessionId: string;
  expiresAtMs: number;
  issuer: string;
  identityLevel: VerifiedToken["identityLevel"];
  issuedAtMs: number;
};

export type DispatchCaller =
  | { kind: "service"; ownerId: string; ownerGeneration: string }
  | { kind: "user"; ownerId: string }
  | {
      kind: "mobile";
      ownerId: string;
      mobileDeviceId: string;
      desktopDeviceId: string;
    };

export type NativeTransientBackup = {
  backupId: string;
  checkpointKey: string;
  workspaceKey: string;
};

export type WorkspaceBackupDebt = { backupIds: string[] };

export type OwnerPurgeRequest = {
  ownerId?: string;
  ownerGeneration?: string;
  purgeGeneration?: string;
  appSlugs?: string[];
  buildPrefixes?: string[];
  browserProfiles?: string[];
  mode?: "reset" | "delete";
};

export type OwnerPurgeReport = {
  ok: true;
  deleted: number;
  pending: string[];
};
