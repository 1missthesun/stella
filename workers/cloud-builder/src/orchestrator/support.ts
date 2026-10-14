import { Buffer } from "node:buffer";
import { reportStatusOf, type AgentAttemptOutcome } from "@stella/contracts/agent-status";
import type { DevicesResponse } from "@stella/contracts/turn-plane/placement";
import { resolveManagedModelDescriptor } from "@stella/model-catalog/gateway-resolution";
import {
  createExecutionContextSnapshot,
  type ExecutionContextSnapshot,
  mediaAccessForAudience,
} from "@stella/contracts/execution-context";
import type { AgentMessage } from "@stella/runtime/kernel/agent-core/types.js";
import type { AgentActivityEntry } from "@stella/contracts/conversation-agent-activity";
import type { CloudExecutionSelection } from "@stella/contracts/agent-engine";
import type { ManagedModelAudience } from "@stella/contracts/gateway/capability";
import {
  type MintedTurnCapability,
  mintTurnCapability,
} from "../capability-signer.js";
import { TOOL_ARGS_PREVIEW_MAX } from "../conversation-types.js";
import { JournalContextIntegrityError } from "../journal.js";
import type {
  Env,
  ChatTurnRequest,
  ChatTurnAdmissionReceipt,
  LocalTurnLease,
  AgentsView,
  HarnessExecution,
  CloudContextComponent,
} from "./types.js";
import { TERMINAL_NOTICE } from "./constants.js";

export class OwnerPurgeFenceError extends Error {}
export class OwnerFenceLeaseConflictError extends Error {}
export class OwnerFenceRegistrationUncertainError extends Error {}

export const piReportOutcome = (report: {
  text: string;
  status?: AgentAttemptOutcome;
}): { kind: AgentAttemptOutcome; body: string } => {
  const field = (name: string) => {
    const match = new RegExp(
      `(?:^|\\n)${name}: ([\\s\\S]*?)(?=\\n(?:agent_state|routing|presentation):|$)`,
    ).exec(report.text);
    return match?.[1]?.trim() ?? "";
  };
  const kind = reportStatusOf(report);
  return { kind, body: field(kind === "completed" ? "result" : "error") };
};

export const listedAgents = (
  view: AgentsView,
  limit: number,
): AgentActivityEntry[] => {
  const pi = new Set(view.pi.map((agent) => agent.agentId));
  return [...view.pi, ...view.owner.filter((agent) => !pi.has(agent.agentId))]
    .sort((a, b) => a.createdAtMs - b.createdAtMs)
    .slice(0, limit);
};

export const mintOrchestratorTurnCapability = (
  env: Env,
  turn: ChatTurnRequest,
  execution: HarnessExecution,
): Promise<MintedTurnCapability> =>
  mintTurnCapability(env, {
    ownerId: turn.ownerId,
    ownerGeneration: turn.ownerGeneration,
    turnId: turn.turnId,
    conversationId: turn.conversationId,
    execution,
    audience: turn.audience,
    budgetMicroCents: turn.budgetMicroCents,
    agentTypes: ["orchestrator"],
  });

export class CliTurnFailedError extends Error {
  constructor(
    message: string,
    readonly userMessage?: string,
  ) {
    super(message);
    this.name = "CliTurnFailedError";
  }
}

export const cloudExecutionContext = (
  turn: Pick<ChatTurnRequest, "audience">,
  destinations: DevicesResponse | null,
): ExecutionContextSnapshot =>
  createExecutionContextSnapshot({
    devices: destinations?.devices ?? null,
    destination: { kind: "cloud" },
    media: { stella: mediaAccessForAudience(turn.audience) },
  });

export const piModelSpec = (
  agentType: "orchestrator" | "general",
  execution: Extract<CloudExecutionSelection, { engine: "stella" }>,
  audience: ManagedModelAudience,
): import("@stella/agent/provider/stella").StellaModelSpec => {
  const descriptor = resolveManagedModelDescriptor({
    agentType,
    requestedModel: execution.model,
    audience,
  });
  return {
    agentType,
    alias: execution.model,
    protocol: descriptor.protocol,
    reasoning: descriptor.reasoning,
    supportsImages: descriptor.supportsImages,
    ...(descriptor.contextWindow !== undefined
      ? { contextWindow: descriptor.contextWindow }
      : {}),
    ...(descriptor.maxOutputTokens !== undefined
      ? { maxOutputTokens: descriptor.maxOutputTokens }
      : {}),
  };
};

export class ChatTurnNotResumableError extends Error {
  constructor(readonly reason: string) {
    super(`The interrupted turn could not be resumed (${reason}).`);
    this.name = "ChatTurnNotResumableError";
  }
}

export const measureInto =
  (timings: Record<string, number>) =>
  async <T>(name: string, work: () => Promise<T>): Promise<T> => {
    const start = performance.now();
    try {
      return await work();
    } finally {
      timings[name] = Math.round(performance.now() - start);
    }
  };

export const isDurableChatTurnAdmissionIntent = (
  receipt: Partial<ChatTurnAdmissionReceipt>,
): receipt is ChatTurnAdmissionReceipt =>
  receipt.schemaVersion === 2 &&
  typeof receipt.fingerprint === "string" &&
  typeof receipt.ownerId === "string" &&
  typeof receipt.ownerGeneration === "string" &&
  typeof receipt.turnId === "string" &&
  typeof receipt.leaseId === "string" &&
  (receipt.phase === "registering" || receipt.phase === "accepted") &&
  typeof receipt.createdConversation === "boolean" &&
  Number.isFinite(receipt.queuedAt) &&
  Number.isFinite(receipt.createdAt) &&
  Number.isFinite(receipt.updatedAt);

export const localTurnRetirementDeadline = (lease: LocalTurnLease): number => {
  if (!lease.cancelRequested) return lease.expiresAt;
  return Number.isFinite(lease.cancelDeadlineAt) && lease.cancelDeadlineAt! > 0
    ? lease.cancelDeadlineAt!
    : Number.POSITIVE_INFINITY;
};

export const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: { "cache-control": "no-store" } });

export const staleOwnerGenerationResponse = (): Response =>
  json(
    {
      code: "OWNER_DATA_GENERATION_STALE",
      message: "This cloud owner generation is no longer current.",
    },
    409,
  );

export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const log = (
  level: "info" | "error",
  event: string,
  fields: Record<string, unknown> = {},
) => {
  console[level](
    JSON.stringify({
      service: "stella-v2-cloud-builder",
      event,
      timestamp: new Date().toISOString(),
      ...fields,
    }),
  );
};

export const base64FromBytes = (bytes: Uint8Array): string =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64");

/**
 * Degrades an oversize payload in place. Used only on the synchronous
 * loop-persist path, where an R2 round trip is impossible: the Agent's event
 * sink is fire-and-forget, so an `await` there would silently drop the row.
 * The async append paths spill to R2 instead and keep the full bytes.
 */
export const truncateMessage = (
  message: AgentMessage,
  limit: number,
): AgentMessage => {
  const record = message as { role?: string; content?: unknown };
  if (!Array.isArray(record.content)) return message;
  const budget = Math.max(1_000, Math.floor(limit / 2));
  let used = 0;
  const content: unknown[] = [];
  for (const block of record.content) {
    const text = (block as { text?: unknown }).text;
    if (typeof text !== "string") {
      content.push(block);
      continue;
    }
    if (used >= budget) continue;
    const room = budget - used;
    used += text.length;
    content.push(
      text.length <= room
        ? block
        : { ...(block as object), text: `${text.slice(0, room)}\n[truncated]` },
    );
  }
  return { ...(message as object), content } as AgentMessage;
};

export class CloudContextBlockedError extends Error {
  readonly code = "CLOUD_CONTEXT_UNAVAILABLE";

  constructor(
    readonly component: CloudContextComponent,
    readonly reason: string,
  ) {
    super("Required cloud context is unavailable or failed integrity checks.");
    this.name = "CloudContextBlockedError";
  }
}

export const requireCloudContext = async <T>(
  component: CloudContextComponent,
  operation: Promise<T>,
): Promise<T> => {
  try {
    return await operation;
  } catch (error) {
    if (error instanceof CloudContextBlockedError) throw error;
    throw new CloudContextBlockedError(component, "read_failed");
  }
};

export const cloudContextFailure = (
  error: unknown,
): {
  code: "CLOUD_CONTEXT_UNAVAILABLE";
  component: CloudContextComponent;
  repairSeq?: number;
} | null => {
  if (error instanceof JournalContextIntegrityError) {
    return {
      code: error.code,
      component: error.component,
      repairSeq: error.seq,
    };
  }
  if (error instanceof CloudContextBlockedError) {
    return { code: error.code, component: error.component };
  }
  return null;
};

export const terminalNotice = (kind: string): string =>
  (TERMINAL_NOTICE as Record<string, string>)[kind] ?? TERMINAL_NOTICE.failed;

export const previewArgs = (args: unknown): string => {
  try {
    return JSON.stringify(args ?? {}).slice(0, TOOL_ARGS_PREVIEW_MAX);
  } catch {
    return "";
  }
};
