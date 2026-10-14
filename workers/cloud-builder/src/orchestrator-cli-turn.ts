import {
  isOrchestratorCliThreadId,
  orchestratorCliThreadId,
  type CloudCliAssistantMessage,
  type CloudCliTurnEventsForward,
  type CloudCliTurnIdentity,
  type CloudCliTurnTerminal,
  type CloudCliTurnToolForward,
  type CloudOrchestratorCliTurnSpec,
  type CloudOrchestratorEvent,
} from "@stella/contracts/cloud-orchestrator-cli";
import {
  TURN_PLANE_PROTOCOL,
  type CloudAgentTurnStartRequest,
  type CloudAgentTurnStartResponse,
} from "@stella/contracts/turn-plane/turn-start";
import type { CloudExecutionSelection } from "@stella/contracts/agent-engine";
import { HEADER_GATE_ADMITTED } from "./turn-start-request.js";

export const sameCliTurnIdentity = (
  left: CloudCliTurnIdentity,
  right: CloudCliTurnIdentity,
): boolean =>
  left.conversationId === right.conversationId &&
  left.threadId === right.threadId &&
  left.turnId === right.turnId &&
  left.attemptGeneration === right.attemptGeneration;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const boundedString = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.length > 0 && value.length <= max
    ? value
    : null;

const nonNegativeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export const parseCliTurnIdentity = (
  value: unknown,
): CloudCliTurnIdentity | null => {
  if (!isRecord(value)) return null;
  const conversationId = boundedString(value.conversationId, 512);
  const threadId = boundedString(value.threadId, 600);
  const turnId = boundedString(value.turnId, 128);
  const attemptGeneration = value.attemptGeneration;
  if (
    !conversationId ||
    !threadId ||
    !turnId ||
    !nonNegativeInteger(attemptGeneration) ||
    attemptGeneration < 1 ||
    !isOrchestratorCliThreadId(conversationId, threadId)
  ) {
    return null;
  }
  return { conversationId, threadId, turnId, attemptGeneration };
};

export const parseCliTurnToolForward = (
  value: unknown,
): CloudCliTurnToolForward | null => {
  const identity = parseCliTurnIdentity(value);
  if (!identity || !isRecord(value)) return null;
  const toolCallId = boundedString(value.toolCallId, 256);
  const name = boundedString(value.name, 64);
  if (!toolCallId || !name || !isRecord(value.args)) return null;
  return { ...identity, toolCallId, name, args: value.args };
};

const isUsage = (value: unknown): boolean =>
  isRecord(value) &&
  ["input", "output", "cacheRead", "cacheWrite", "totalTokens"].every(
    (field) => typeof value[field] === "number",
  );

const STOP_REASONS = new Set(["stop", "length", "toolUse", "error", "aborted"]);

const isCliAssistantMessage = (
  value: unknown,
): value is CloudCliAssistantMessage =>
  isRecord(value) &&
  value.role === "assistant" &&
  value.api === "claude-code" &&
  value.provider === "anthropic" &&
  typeof value.model === "string" &&
  typeof value.timestamp === "number" &&
  typeof value.stopReason === "string" &&
  STOP_REASONS.has(value.stopReason) &&
  isUsage(value.usage) &&
  Array.isArray(value.content) &&
  value.content.every(
    (block) =>
      isRecord(block) &&
      ((block.type === "text" && typeof block.text === "string") ||
        (block.type === "thinking" && typeof block.thinking === "string") ||
        (block.type === "toolCall" &&
          typeof block.id === "string" &&
          typeof block.name === "string" &&
          isRecord(block.arguments))),
  );

const parseCliEvent = (value: unknown): CloudOrchestratorEvent | null => {
  if (!isRecord(value)) return null;
  switch (value.type) {
    case "text_delta":
      return typeof value.text === "string"
        ? { type: "text_delta", text: value.text }
        : null;
    case "status":
      return (value.state === "running" || value.state === "compacting") &&
        typeof value.text === "string"
        ? { type: "status", state: value.state, text: value.text }
        : null;
    case "compaction":
      return typeof value.id === "string" &&
        value.id.length > 0 &&
        value.id.length <= 200 &&
        typeof value.summary === "string" &&
        value.summary.length > 0
        ? {
            type: "compaction",
            id: value.id,
            summary: value.summary,
            ...(nonNegativeInteger(value.preservedMessages)
              ? { preservedMessages: value.preservedMessages }
              : {}),
          }
        : null;
    case "assistant_message":
      return isCliAssistantMessage(value.message)
        ? { type: "assistant_message", message: value.message }
        : null;
    case "models": {
      const windows = isRecord(value.windows)
        ? Object.fromEntries(
            Object.entries(value.windows)
              .filter(([model, window]) => model.length > 0 && model.length <= 200 && nonNegativeInteger(window))
              .slice(0, 16),
          )
        : undefined;
      const alias = boundedString(value.alias, 200);
      const resolved = boundedString(value.resolved, 200);
      return {
        type: "models",
        ...(alias && resolved ? { alias, resolved } : {}),
        ...(windows && Object.keys(windows).length > 0 ? { windows: windows as Record<string, number> } : {}),
      };
    }
    case "usage":
      return nonNegativeInteger(value.inputTokens) &&
        nonNegativeInteger(value.outputTokens) &&
        nonNegativeInteger(value.llmCalls)
        ? {
            type: "usage",
            inputTokens: value.inputTokens,
            outputTokens: value.outputTokens,
            llmCalls: value.llmCalls,
          }
        : null;
    default:
      return null;
  }
};

export const parseCliTurnEventsForward = (
  value: unknown,
): CloudCliTurnEventsForward | null => {
  const identity = parseCliTurnIdentity(value);
  if (!identity || !isRecord(value)) return null;
  const { batchSeq } = value;
  if (
    !nonNegativeInteger(batchSeq) ||
    batchSeq < 1 ||
    !Array.isArray(value.events)
  ) {
    return null;
  }
  const events: CloudOrchestratorEvent[] = [];
  for (const raw of value.events) {
    const event = parseCliEvent(raw);
    if (!event) return null;
    events.push(event);
  }
  return { ...identity, batchSeq, events };
};

export const parseCliTurnTerminal = (
  value: unknown,
): CloudCliTurnTerminal | null => {
  const identity = parseCliTurnIdentity(value);
  if (!identity || !isRecord(value)) return null;
  const { outcome, usage } = value;
  if (
    (outcome !== "completed" && outcome !== "failed" && outcome !== "canceled") ||
    typeof value.finalText !== "string" ||
    (value.error !== undefined && typeof value.error !== "string") ||
    !isRecord(usage) ||
    !nonNegativeInteger(usage.inputTokens) ||
    !nonNegativeInteger(usage.outputTokens) ||
    !nonNegativeInteger(usage.llmCalls)
  ) {
    return null;
  }
  return {
    ...identity,
    outcome,
    finalText: value.finalText,
    ...(typeof value.error === "string"
      ? { error: value.error.slice(0, 2_000) }
      : {}),
    usage: {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      llmCalls: usage.llmCalls,
    },
  };
};

export type BuildSessionEnv = Pick<Cloudflare.Env, "BUILD_SESSIONS"> &
  Partial<Pick<Cloudflare.Env, "CLOUD_BUILDER_PUBLIC_URL">>;

const buildSession = (env: BuildSessionEnv, threadId: string) =>
  env.BUILD_SESSIONS.getByName(threadId);

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export class OrchestratorCliDispatchRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrchestratorCliDispatchRefused";
  }
}

export class OrchestratorCliPreviousTurnBusy extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OrchestratorCliPreviousTurnBusy";
  }
}

export const dispatchOrchestratorCliTurn = async (args: {
  env: BuildSessionEnv;
  ownerId: string;
  ownerGeneration: string;
  audience: string;
  budgetMicroCents: number;
  identity: CloudCliTurnIdentity;
  execution: Extract<CloudExecutionSelection, { engine: "anthropic" }>;
  prompt: string;
  spec: CloudOrchestratorCliTurnSpec;
  clientMsgId?: string;
  signal?: AbortSignal;
}): Promise<void> => {
  const publicOrigin = (args.env.CLOUD_BUILDER_PUBLIC_URL ?? "")
    .trim()
    .replace(/\/+$/, "");
  if (!publicOrigin) {
    throw new Error(
      "Claude Code turns are unavailable: the builder's public origin is not configured.",
    );
  }
  const { identity } = args;
  const payload: CloudAgentTurnStartRequest = {
    protocol: TURN_PLANE_PROTOCOL,
    kind: "agent",
    ownerId: args.ownerId,
    ownerGeneration: args.ownerGeneration,
    conversationId: identity.conversationId,
    threadId: identity.threadId,
    agentDepth: 0,
    attemptGeneration: identity.attemptGeneration,
    turnId: identity.turnId,
    prompt: args.prompt,
    description: "Stella chat turn",
    execution: args.execution,
    audience: args.audience,
    budgetMicroCents: args.budgetMicroCents,
    source: "orchestrator",
    ...(args.clientMsgId ? { clientMsgId: args.clientMsgId } : {}),
    agentRole: "orchestrator",
    orchestratorCli: args.spec,
  };
  let response: Response;
  try {
    response = await buildSession(args.env, identity.threadId).fetch(
      "https://build-session/turn",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-stella-build-session-name": identity.threadId,
          "x-stella-turn-broker-endpoint": `${publicOrigin}/sessions/${encodeURIComponent(identity.threadId)}/turn-broker`,
          [HEADER_GATE_ADMITTED]: "1",
        },
        body: JSON.stringify(payload),
        ...(args.signal ? { signal: args.signal } : {}),
      },
    );
  } catch (error) {
    throw new Error(
      `Starting the Claude Code turn failed: ${errorText(error)}`.slice(0, 400),
    );
  }
  const body = (await response.json().catch(() => null)) as
    | (Partial<CloudAgentTurnStartResponse> & {
        error?: unknown;
        message?: unknown;
        reason?: unknown;
      })
    | null;
  if (response.status === 409 && body?.reason === "previous_turn_recovering") {
    throw new OrchestratorCliPreviousTurnBusy(
      "The previous Claude Code turn is still finishing.",
    );
  }
  if (!response.ok) {
    const detail =
      typeof body?.error === "string"
        ? body.error
        : typeof body?.message === "string"
          ? body.message
          : `Starting the Claude Code turn failed (${response.status}).`;
    throw response.status >= 500 || response.status === 429
      ? new Error(detail)
      : new OrchestratorCliDispatchRefused(detail);
  }
  if (
    body &&
    ((typeof body.turnId === "string" && body.turnId !== identity.turnId) ||
      (typeof body.attemptGeneration === "number" &&
        body.attemptGeneration !== identity.attemptGeneration))
  ) {
    throw new Error(
      "The orchestrator session accepted a different attempt than the one dispatched.",
    );
  }
};

/**
 * Stop one CLI attempt through the BuildSession's existing exact
 * cancellation (`POST https://build-session/cancel`): it runs the container
 * kill ladder, delivers the canceled terminal to this conversation's
 * `/internal/cli-turn/terminal`, and only then answers 200 `{ canceled: true,
 * joined: true }`. No checkpoint is taken; the session keeps the native state
 * it had before this attempt. Callers must not hold a lock the terminal route
 * needs across this call.
 */
export const cancelOrchestratorCliTurn = async (args: {
  env: BuildSessionEnv;
  ownerId: string;
  ownerGeneration: string;
  identity: CloudCliTurnIdentity;
  cancelRequestId: string;
}): Promise<{ status: number }> => {
  const response = await buildSession(args.env, args.identity.threadId).fetch(
    "https://build-session/cancel",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ownerId: args.ownerId,
        ownerGeneration: args.ownerGeneration,
        turnId: args.identity.turnId,
        attemptGeneration: args.identity.attemptGeneration,
        cancelRequestId: args.cancelRequestId.slice(0, 128),
      }),
    },
  );
  await response.arrayBuffer().catch(() => undefined);
  return { status: response.status };
};

export const prewarmOrchestratorCli = async (args: {
  env: BuildSessionEnv;
  ownerId: string;
  conversationId: string;
}): Promise<{
  ok: boolean;
  status?: number;
  alreadyRunning?: boolean;
  startMs?: number;
}> => {
  const threadId = orchestratorCliThreadId(args.conversationId);
  try {
    const response = await buildSession(args.env, threadId).fetch(
      "https://build-session/orchestrator-turn/prewarm",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-stella-build-session-name": threadId,
        },
        body: JSON.stringify({ ownerId: args.ownerId, threadId }),
        signal: AbortSignal.timeout(60_000),
      },
    );
    const body = (await response.json().catch(() => null)) as unknown;
    return {
      ok: response.ok,
      status: response.status,
      ...(isRecord(body) && typeof body.alreadyRunning === "boolean"
        ? { alreadyRunning: body.alreadyRunning }
        : {}),
      ...(isRecord(body) && typeof body.startMs === "number"
        ? { startMs: body.startMs }
        : {}),
    };
  } catch {
    return { ok: false };
  }
};
