import type {
  CallArgs,
  CallName,
  CallResult,
  ViewArgs,
  ViewName,
  ViewResult,
} from "@stella/contracts/backend/api";
import type { AgentLineage } from "@stella/contracts/agent-depth";
import type { OwnerSnapshot } from "@stella/contracts/turn-plane/owner-snapshot";
import type { MemoryPolicyChange } from "@stella/contracts/turn-plane/memory-policy";
import type { Parser } from "./args.js";

export type OwnerCaller = {
  ownerId: string;
  subject: string;
  sessionId: string;
  expiresAtMs: number;
  identityLevel?: import("@stella/contracts/gateway/api").IdentityLevel;
  issuedAtMs?: number;
};

export type SqlValue = string | number | null | ArrayBuffer;

export type OwnerDbReader = {
  all<T extends Record<string, SqlValue>>(query: string, ...params: SqlValue[]): T[];
  one<T extends Record<string, SqlValue>>(query: string, ...params: SqlValue[]): T | null;
};

export type OwnerDb = OwnerDbReader & {
  run(query: string, ...params: SqlValue[]): void;
  transaction?<T>(fn: () => T): T;
  memory?: Map<string, unknown>;
};

export type OwnerJobs = {
  schedule(kind: string, runAt: number, payload?: unknown, options?: { id?: string }): string;
  cancel(id: string): void;
};

export type OwnerHost = {
  snapshot(): Promise<OwnerSnapshot>;
  dispatchAgentTurn(input: AgentTurnDispatch): Promise<void>;
  deviceDestinations(): Promise<import("@stella/contracts/turn-plane/placement").DeviceDestination[]>;
  dispatchDeviceAgentTurn(input: DeviceAgentTurnDispatch): Promise<{ dispatchId: string }>;
  steerAgentTurn(input: {
    threadId: string;
    conversationId: string;
    ownerGeneration: string;
    messageId: string;
    text: string;
  }): Promise<boolean>;
  steerDeviceAgentTurn(input: {
    dispatchId: string;
    messageId: string;
    text: string;
  }): Promise<{ delivered: boolean; reason?: "not_running" | "unreachable" | "timeout" }>;
  messageLocalAgent(input: LocalAgentMessage): Promise<{
    outcome: import("@stella/contracts/turn-plane/placement").AgentMessageDeviceOutcome | "unreachable" | "timeout";
  }>;
  askDeviceConsent(input: { deviceId: string; requestedAt: number }): void;
  relayDeviceRequest(input: {
    deviceId: string;
    method: import("@stella/contracts/turn-plane/device-requests").DeviceRequestMethod;
    params: Record<string, unknown>;
  }): Promise<
    | { ok: true; value: unknown }
    | {
        ok: false;
        code: import("@stella/contracts/turn-plane/device-requests").DeviceRequestErrorCode;
        message: string;
      }
  >;
  stopLocalAgent(input: LocalAgentStop): Promise<{
    outcome: import("@stella/contracts/turn-plane/placement").AgentStopDeviceOutcome | "unreachable" | "timeout";
  }>;
  controlHarnessAgent(input: HarnessAgentControl): Promise<{
    outcome: "steered" | "resumed" | "stopped" | "not_running" | "not_found";
  }>;
  cancelDeviceAgentTurn(input: {
    dispatchId: string;
    cancelRequestId: string;
    reason: string;
  }): Promise<void>;
  deliverAgentCompletion(input: AgentCompletionDelivery): Promise<void>;
  agentReportTarget(input: { conversationId: string; ownerGeneration: string }): Promise<AgentReportTarget>;
  cancelAgentTurn(input: {
    threadId: string;
    conversationId: string;
    turnId: string;
    attemptGeneration: number;
    ownerGeneration: string;
    cancelRequestId: string;
  }): Promise<"canceled" | "changed">;
  postConversationCard(input: {
    conversationId: string;
    ownerGeneration: string;
    sourceTurnId: string;
    card: unknown;
  }): Promise<boolean>;
  homeChanged(ownerGeneration: string, revision: number): Promise<void>;
  changeMemoryPolicy(change: MemoryPolicyChange): Promise<void>;
  startAgentMessageTurn(input: {
    ownerGeneration: string;
    conversationId: string;
    clientMsgId: string;
    prompt: string;
  }): Promise<void>;
  startScheduledTurn(input: ScheduledTurnStart): Promise<void>;
  purgeOwner(mode: OwnerPurgeMode, requestId: string): Promise<{ pending: string[] }>;
};

export type LocalAgentMessage = {
  deviceId: string;
  threadId: string;
  ownerGeneration: string;
  messageId: string;
  text: string;
};

export type HarnessAgentControl = {
  conversationId: string;
  ownerGeneration: string;
  threadId: string;
  commandId: string;
  kind: "message" | "stop";
  text?: string;
};

export type LocalAgentStop = {
  deviceId: string;
  threadId: string;
  ownerGeneration: string;
  commandId: string;
};

export type ScheduledTurnStart = {
  ownerGeneration: string;
  conversationId: string;
  clientMsgId: string;
  prompt: string;
  title: string;
  targetDeviceId?: string;
  agent?: { description: string };
};

export type AgentTurnDispatch = {
  ownerGeneration: string;
  conversationId: string;
  threadId: string;
  turnId: string;
  attemptGeneration: number;
  clientMsgId: string;
  description: string;
  prompt: string;
  execution: import("@stella/contracts/agent-engine").CloudExecutionSelection;
  originDeviceId?: string;
  originConversationId?: string;
  workspace?: import("@stella/contracts/turn-plane/turn-start").AgentWorkspaceSize;
  lineage: AgentLineage;
};

export type DeviceAgentTurnDispatch = {
  ownerGeneration: string;
  conversationId: string;
  threadId: string;
  turnId: string;
  description: string;
  prompt: string;
  targetDeviceId: string;
  requestingDeviceId?: string;
  model?: string;
  lineage: AgentLineage;
  attachments?: readonly string[];
  requeue?: number;
};

export type AgentCompletionDelivery = {
  ownerGeneration: string;
  conversationId: string;
  threadId: string;
  attemptGeneration: number;
  description: string;
  status: "completed" | "failed" | "canceled";
  resultJson?: string;
  errorMessage?: string;
  threadUpdatedAt: number;
  clientMsgId: string;
};

export type AgentReportTarget =
  | { kind: "cloud" }
  | { kind: "device"; deviceId: string; epoch: number }
  | { kind: "sender" };

export class DispatchError extends Error {
  readonly retryable: boolean;
  readonly code: string | undefined;
  constructor(message: string, retryable: boolean, code?: string) {
    super(message);
    this.name = "DispatchError";
    this.retryable = retryable;
    this.code = code;
  }
}

export type OwnerContext = {
  ownerId: string;
  host: OwnerHost;
  caller: OwnerCaller | null;
  db: OwnerDb;
  jobs: OwnerJobs;
  env: Cloudflare.Env;
  storage: DurableObjectStorage;
  now: number;
};

export type OwnerViewContext = {
  ownerId: string;
  caller: OwnerCaller | null;
  db: OwnerDbReader;
  env: Cloudflare.Env;
  now: number;
};

export type GlobalContext = {
  caller: OwnerCaller;
  env: Cloudflare.Env;
  now: number;
};

export type OwnerCallDef<K extends CallName> = {
  scope: "owner";
  maxBodyBytes?: number;
  parse: Parser<CallArgs<K>>;
  handler: (ctx: OwnerContext, args: CallArgs<K>) => CallResult<K> | Promise<CallResult<K>>;
};

export type GlobalCallDef<K extends CallName> = {
  scope: "global";
  parse: Parser<CallArgs<K>>;
  handler: (ctx: GlobalContext, args: CallArgs<K>) => CallResult<K> | Promise<CallResult<K>>;
};

export type CallDef<K extends CallName> = OwnerCallDef<K> | GlobalCallDef<K>;

export type ViewDef<K extends ViewName> = {
  parse: Parser<ViewArgs<K>>;
  read: (ctx: OwnerViewContext, args: ViewArgs<K>) => ViewResult<K>;
};

export type JobDef = {
  run: (ctx: OwnerContext, payload: unknown) => void | Promise<void>;
  maxAttempts?: number;
};

export type Migration = {
  id: string;
  statements: string[];
};

export type InternalDef = (ctx: OwnerContext, args: unknown) => unknown;

export type OwnerInternalCall = (name: string, args: unknown) => Promise<unknown>;

export type OwnerPurgeMode = "reset" | "delete";

export type PurgeDef = (
  ctx: OwnerContext,
  mode: OwnerPurgeMode,
) => { pending: boolean } | Promise<{ pending: boolean }>;

export type OwnerDomain = {
  name: string;
  migrations?: Migration[];
  calls?: { [K in CallName]?: CallDef<K> };
  views?: { [K in ViewName]?: ViewDef<K> };
  jobs?: Record<string, JobDef>;
  internal?: Record<string, InternalDef>;
  purge?: PurgeDef;
};

export type OwnerRegistry = {
  migrations: Migration[];
  calls: Map<string, CallDef<CallName>>;
  views: Map<string, ViewDef<ViewName>>;
  jobs: Map<string, JobDef>;
  internal: Map<string, InternalDef>;
  purges: Map<string, PurgeDef>;
};

export const createOwnerRegistry = (domains: OwnerDomain[]): OwnerRegistry => {
  const registry: OwnerRegistry = {
    migrations: [],
    calls: new Map(),
    views: new Map(),
    jobs: new Map(),
    internal: new Map(),
    purges: new Map(),
  };
  const migrationIds = new Set<string>();
  for (const domain of domains) {
    for (const migration of domain.migrations ?? []) {
      if (migrationIds.has(migration.id)) {
        throw new Error(`Duplicate owner migration ${migration.id}.`);
      }
      migrationIds.add(migration.id);
      registry.migrations.push(migration);
    }
    for (const [name, def] of Object.entries(domain.calls ?? {})) {
      if (!def) continue;
      if (registry.calls.has(name)) throw new Error(`Duplicate call ${name}.`);
      registry.calls.set(name, def as CallDef<CallName>);
    }
    for (const [name, def] of Object.entries(domain.views ?? {})) {
      if (!def) continue;
      if (registry.views.has(name)) throw new Error(`Duplicate view ${name}.`);
      registry.views.set(name, def as ViewDef<ViewName>);
    }
    for (const [kind, def] of Object.entries(domain.jobs ?? {})) {
      if (registry.jobs.has(kind)) throw new Error(`Duplicate job ${kind}.`);
      registry.jobs.set(kind, def);
    }
    for (const [name, def] of Object.entries(domain.internal ?? {})) {
      if (registry.internal.has(name)) throw new Error(`Duplicate internal operation ${name}.`);
      registry.internal.set(name, def);
    }
    if (domain.purge) {
      if (registry.purges.has(domain.name)) throw new Error(`Duplicate purge for ${domain.name}.`);
      registry.purges.set(domain.name, domain.purge);
    }
  }
  return registry;
};
