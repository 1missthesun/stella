import {
  isAgentAttemptOutcome,
  type AgentAttemptOutcome,
  type AgentStatus,
} from "./agent-status.js";

/** Durable chat decorations. Payloads match the on-device lifecycle events. */
type LifecycleIdentity = {
  agentId: string;
  rootRunId?: string;
  attemptGeneration: number;
};

export type CloudAgentLifecycleEvent =
  | {
      type: "agent-started";
      payload: LifecycleIdentity & {
        description: string;
        agentType: string;
        isFollowUp?: boolean;
        statusText?: string;
      };
    }
  | {
      type: "agent-progress";
      payload: LifecycleIdentity & { statusText: string };
    }
  | {
      type: "agent-completed";
      payload: LifecycleIdentity & { result: string; status?: "completed" };
    }
  | {
      type: "agent-failed" | "agent-canceled";
      /**
       * `status` says how the attempt ended in the shared vocabulary. Builds
       * before `stop_agent` wrote `status: "paused"` on a stop's card, which
       * reads as `canceled`.
       */
      payload: LifecycleIdentity & { error?: string; status?: AgentAttemptOutcome };
    };

export type CloudAgentLifecycleCard = {
  type: "agent-lifecycle";
  eventId: string;
  event: CloudAgentLifecycleEvent;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const parseCloudAgentLifecycleCard = (
  value: unknown,
): CloudAgentLifecycleCard | null => {
  if (
    !isRecord(value) ||
    value.type !== "agent-lifecycle" ||
    typeof value.eventId !== "string" ||
    !value.eventId ||
    !isRecord(value.event)
  )
    return null;
  const event = value.event;
  const payload = event.payload;
  if (
    !isRecord(payload) ||
    typeof payload.agentId !== "string" ||
    !payload.agentId ||
    typeof payload.attemptGeneration !== "number" ||
    !Number.isSafeInteger(payload.attemptGeneration) ||
    payload.attemptGeneration < 1 ||
    (payload.rootRunId !== undefined && typeof payload.rootRunId !== "string")
  )
    return null;
  const identity = {
    agentId: payload.agentId,
    attemptGeneration: payload.attemptGeneration,
    ...(typeof payload.rootRunId === "string"
      ? { rootRunId: payload.rootRunId }
      : {}),
  };
  const card = { type: "agent-lifecycle", eventId: value.eventId } as const;
  switch (event.type) {
    case "agent-started":
      if (
        typeof payload.description !== "string" ||
        typeof payload.agentType !== "string" ||
        (payload.isFollowUp !== undefined &&
          typeof payload.isFollowUp !== "boolean") ||
        (payload.statusText !== undefined &&
          typeof payload.statusText !== "string")
      )
        return null;
      return {
        ...card,
        event: {
          type: event.type,
          payload: {
            ...identity,
            description: payload.description,
            agentType: payload.agentType,
            ...(payload.isFollowUp === true ? { isFollowUp: true } : {}),
            ...(typeof payload.statusText === "string"
              ? { statusText: payload.statusText }
              : {}),
          },
        },
      };
    case "agent-progress":
      return typeof payload.statusText === "string"
        ? {
            ...card,
            event: {
              type: event.type,
              payload: { ...identity, statusText: payload.statusText },
            },
          }
        : null;
    case "agent-completed":
      return typeof payload.result === "string"
        ? {
            ...card,
            event: {
              type: event.type,
              payload: {
                ...identity,
                result: payload.result,
                ...(payload.status === "completed" ? { status: "completed" as const } : {}),
              },
            },
          }
        : null;
    case "agent-failed":
    case "agent-canceled":
      if (payload.error !== undefined && typeof payload.error !== "string")
        return null;
      return {
        ...card,
        event: {
          type: event.type,
          payload: {
            ...identity,
            ...(typeof payload.error === "string"
              ? { error: payload.error }
              : {}),
            ...(isAgentAttemptOutcome(payload.status) ? { status: payload.status } : {}),
          },
        },
      };
    default:
      return null;
  }
};

/** The status a lifecycle card leaves its agent in, in the shared vocabulary. */
export const cloudAgentLifecycleStatus = (event: CloudAgentLifecycleEvent): AgentStatus => {
  switch (event.type) {
    case "agent-started":
    case "agent-progress":
      return "running";
    case "agent-completed":
      return "completed";
    case "agent-failed":
      return event.payload.status ?? "failed";
    case "agent-canceled":
      return event.payload.status ?? "canceled";
  }
};
