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
  kind?: string;
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
  /**
   * Present on the admitted dispatch when `agentRole` is `"orchestrator"`.
   * Never part of the stored `turn` record (see `durableTurnRecord`): the
   * spec lives in `orchestrator-cli-turn-store.ts` and is read back when
   * turn-input.json is written.
   */
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

export type PendingAppBuildPublication = {
  turnId: string;
  phase: "callback" | "cleanup";
  artifactPrefix: string;
  buildId?: string;
  callbackBody: Record<string, unknown>;
  completionSeq: number | "auto";
  completionResult: Record<string, unknown>;
  failureMessage?: string;
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

/**
 * THE LIST. Every store outside the owner object that holds data belonging to one owner,
 * how it is addressed, and what deletes it. `purgeOwnerStorage` walks exactly
 * this list; a store that is not here is a store account deletion does not
 * reach, so adding one to the system without adding it here is the defect.
 *
 *  id                | where                    | addressed by
 *  ------------------|--------------------------|--------------------------------
 *  agent-home        | R2 AGENT_HOME            | `agent-home/<sha256(owner)>/`
 *  conversations     | R2 CONVERSATION_ARCHIVE  | `conversations/<sha256(owner)>/`
 *  backups           | R2 BACKUP_BUCKET         | `backups/<backupId>/` — the id
 *                    |                          | is only in the KV descriptor
 *  builds            | R2 APP_BUILDS            | app
 *                    |                          | `builds/<ownerHash>/<buildId>/`
 *                    |                          | (legacy exact `builds/<buildId>/`)
 *  checkpoints       | KV APP_ROUTES            | `ws:<sha256(owner:workspace)>`
 *                    |                          | and `…:size`
 *  native-checkpoints| KV + R2 BACKUP_BUCKET    | `ws:<hash>:native-state:<threadHash>`
 *                    |                          | plus its descriptor/name-derived backup
 *  routes            | KV APP_ROUTES            | `app:<slug>`, owner in the value
 *
 * Deliberately NOT here, with the reason:
 *  - OrchestratorSession DO SQLite and the R2 objects its manifest names are
 *    purged per conversation by the owner object's purge hook
 *    (`owner-store/purge.ts`, run as this route's `owner-data` step), because
 *    only the DO can say its own storage is gone. The `conversations/` prefix
 *    sweep above is the backstop for segments whose index row was already lost.
 *  - BuildSession DOs hold no durable owner state. The world's Sandbox DO
 *    keeps a handle to its last container filesystem snapshot; an owner purge
 *    destroys that sandbox, which drops the handle. Cloudflare has no snapshot
 *    delete, so the unreferenced snapshot itself expires after 30 days.
 *    A workspace that must survive is a `backups/` archive, which IS here.
 *  - The drive's R2 objects are deleted by the owner object's drive domain
 *    purge hook, which knows its own file rows.
 *
 * The two hash prefixes are duplicated from their owners deliberately —
 * importing `ConversationArchive` or `AgentHome` here would pull a DO-shaped
 * module into the worker entry for two string literals. They must stay in step
 * with `archive.ts` (`conversations/<hash>/`) and `agent-home.ts:163`
 * (`agent-home/<hash>/`).
 */
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
