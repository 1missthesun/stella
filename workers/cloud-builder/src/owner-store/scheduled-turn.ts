import { PLACEMENT_PROTOCOL } from "@stella/contracts/turn-plane/placement";
import {
  TURN_OWNER_GENERATION_HEADER,
  TURN_PLANE_PROTOCOL,
  TURN_TITLE_MAX_CHARS,
  type CloudTurnStartRequest,
  type CloudTurnStartResponse,
} from "@stella/contracts/turn-plane/turn-start";
import { HEADER_CONVERSATION_ID, ORCHESTRATOR_INTERNAL_ORIGIN } from "../build-session/shared/keys.js";
import { HEADER_OWNER } from "../conversation-types.js";
import { HEADER_TURN_AUTH_KIND } from "../turn-start-request.js";
import type { GateHostDependencies } from "./gate-host.js";
import type { ScheduledTurnStart, ScheduledTurnStarted } from "./registry.js";

export class ScheduledTurnError extends Error {
  readonly retryable: boolean;
  readonly conversationGone: boolean;
  readonly computerAway: boolean;
  constructor(
    message: string,
    options: { retryable: boolean; conversationGone?: boolean; computerAway?: boolean },
  ) {
    super(message);
    this.name = "ScheduledTurnError";
    this.retryable = options.retryable;
    this.conversationGone = options.conversationGone ?? false;
    this.computerAway = options.computerAway ?? false;
  }
}

const startOnDesktop = async (
  deps: GateHostDependencies,
  input: ScheduledTurnStart & { targetDeviceId: string },
): Promise<ScheduledTurnStarted> => {
  const result = await deps.submit({
    request: {
      protocol: PLACEMENT_PROTOCOL,
      idempotencyKey: input.clientMsgId,
      kind: "chat",
      ingress: "schedule",
      subject: input.computerOnly ? "computer" : "cloud",
      targetMode: "device",
      targetDeviceId: input.targetDeviceId,
      ...(input.computerOnly?.ownDevice ? { requestingDeviceId: input.targetDeviceId } : {}),
      conversationId: input.conversationId,
      requiredCapabilities: ["chat"],
      payload: {
        schemaVersion: 1,
        prompt: input.prompt,
        conversationId: input.conversationId,
        clientMsgId: input.clientMsgId,
        ...(input.agent ? { scheduledAgent: { description: input.agent.description } } : {}),
      },
    },
    expectedGeneration: input.ownerGeneration,
  });
  if (!result.ok) {
    throw new ScheduledTurnError(result.error.message, { retryable: result.error.retryable });
  }
  const dispatch = result.response.dispatch;
  if (dispatch.state === "blocked" || dispatch.state === "failed") {
    throw new ScheduledTurnError(dispatch.errorMessage ?? "The scheduled run could not be placed.", {
      retryable: true,
      computerAway: Boolean(input.computerOnly) && dispatch.state === "blocked",
    });
  }
  return { dispatchId: dispatch.dispatchId };
};

const startInCloud = async (
  deps: GateHostDependencies,
  input: ScheduledTurnStart,
): Promise<ScheduledTurnStarted> => {
  const request: CloudTurnStartRequest = {
    protocol: TURN_PLANE_PROTOCOL,
    clientMsgId: input.agent ? `pia:${input.clientMsgId}` : input.clientMsgId,
    prompt: input.prompt,
    lane: "schedule",
    source: "schedule",
    hiddenMessage: true,
    ...(input.title.trim() ? { title: input.title.trim().slice(0, TURN_TITLE_MAX_CHARS) } : {}),
    ...(input.agent
      ? {
          piAgent: {
            op: "start" as const,
            threadId: scheduledAgentThreadId(input.clientMsgId),
            description: input.agent.description.slice(0, 1_000),
          },
        }
      : {}),
  };
  const response = await deps.env.ORCHESTRATOR_SESSIONS.getByName(input.conversationId).fetch(
    `${ORCHESTRATOR_INTERNAL_ORIGIN}/turn`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [HEADER_OWNER]: deps.ownerId(),
        [HEADER_TURN_AUTH_KIND]: "service",
        [HEADER_CONVERSATION_ID]: input.conversationId,
        [TURN_OWNER_GENERATION_HEADER]: input.ownerGeneration,
      },
      body: JSON.stringify(request),
    },
  );
  if (response.ok) {
    const accepted = (await response.json().catch(() => null)) as Partial<CloudTurnStartResponse> | null;
    const cloudTurnId = typeof accepted?.turnId === "string" && accepted.turnId ? accepted.turnId : undefined;
    return {
      ...(cloudTurnId ? { cloudTurnId } : {}),
      ...(input.agent ? { agentThreadId: scheduledAgentThreadId(input.clientMsgId) } : {}),
    };
  }
  const body = (await response.json().catch(() => null)) as {
    error?: { code?: unknown; message?: unknown; retryable?: unknown };
  } | null;
  const code = typeof body?.error?.code === "string" ? body.error.code : "";
  throw new ScheduledTurnError(
    typeof body?.error?.message === "string"
      ? body.error.message
      : `The scheduled run was refused (${response.status}).`,
    {
      retryable: body?.error?.retryable === true || response.status >= 500,
      conversationGone:
        code === "owner_mismatch" ||
        code === "forbidden" ||
        response.status === 404 ||
        response.status === 410,
    },
  );
};

const scheduledAgentThreadId = (clientMsgId: string): string =>
  `thr-${clientMsgId.replace(/[^A-Za-z0-9]/g, "").slice(-24)}`;

export const startScheduledTurn = async (
  deps: GateHostDependencies,
  input: ScheduledTurnStart,
): Promise<ScheduledTurnStarted> => {
  const targetDeviceId = input.targetDeviceId?.trim();
  if (targetDeviceId) return await startOnDesktop(deps, { ...input, targetDeviceId });
  if (input.computerOnly) {
    throw new ScheduledTurnError("There is no computer to run this on.", { retryable: false, computerAway: true });
  }
  return await startInCloud(deps, input);
};
