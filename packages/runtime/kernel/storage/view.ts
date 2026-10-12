/**
 * Pure projection and view helpers for the storage layer.
 *
 * Everything in this file is a pure function over already-loaded rows:
 * eager-event projection and search tokenization. No SQL lives here.
 */

import {
  type LocalChatEventRecord,
} from "./shared.js";

export const EAGER_TOOL_EVENT_LIMIT = 32;
export const EAGER_TOOL_EVENT_PAYLOAD_BYTES = 4096;
export const EAGER_TOOL_EVENT_SIDE_LIMIT = EAGER_TOOL_EVENT_LIMIT / 2;

export const eventRoleForType = (type: string): string => {
  switch (type) {
    case "user_message":
      return "user";
    case "assistant_message":
      return "assistant";
    case "tool_request":
    case "tool_result":
      return "tool";
    default:
      return "system";
  }
};

/* ------------------------------------------------------------------ */
/* Timeline cursors                                                    */
/* ------------------------------------------------------------------ */

export type Cursor = {
  timestamp: number;
  id: string;
  sequence?: number;
};

export const compareTimelineCursor = (a: Cursor, b: Cursor): number => {
  if (
    typeof a.sequence === "number" &&
    Number.isFinite(a.sequence) &&
    typeof b.sequence === "number" &&
    Number.isFinite(b.sequence)
  ) {
    if (a.sequence !== b.sequence) return a.sequence - b.sequence;
    return a.id.localeCompare(b.id);
  }
  if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
  return a.id.localeCompare(b.id);
};

/* ------------------------------------------------------------------ */
/* Eager tool-event payload projection                                 */
/* ------------------------------------------------------------------ */

type ProjectionLimits = {
  stringChars: number;
  arrayItems: number;
  objectKeys: number;
};

const projectBoundedJsonValue = (
  value: any,
  depth: number,
  limits: ProjectionLimits,
): any => {
  if (value == null || typeof value === "boolean" || typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    return value.length <= limits.stringChars
      ? value
      : `${value.slice(0, limits.stringChars)}…`;
  }
  if (depth <= 0) return "[detail omitted]";
  if (Array.isArray(value)) {
    return value
      .slice(0, limits.arrayItems)
      .map((item) => projectBoundedJsonValue(item, depth - 1, limits));
  }
  if (typeof value === "object") {
    const projected: Record<string, unknown> = {};
    const entries = Object.entries(value).slice(0, limits.objectKeys);
    for (const [key, item] of entries) {
      projected[key] = projectBoundedJsonValue(item, depth - 1, limits);
    }
    if (Object.keys(value).length > entries.length) {
      projected.__truncatedKeys = Object.keys(value).length - entries.length;
    }
    return projected;
  }
  return String(value);
};

const projectEagerEventPayload = (
  payload: any,
): { payload: any; projected: boolean } => {
  if (!payload) return { payload, projected: false };
  const markProjected = (value: any) =>
    value && typeof value === "object" && !Array.isArray(value)
      ? {
          ...value,
          __stellaEagerProjection: {
            truncated: true,
            fullDetailAvailable: true,
          },
        }
      : value;
  const fitsEnvelope = (value: unknown) =>
    new TextEncoder().encode(JSON.stringify(value)).byteLength <=
    EAGER_TOOL_EVENT_PAYLOAD_BYTES;
  try {
    if (fitsEnvelope(payload)) {
      return { payload, projected: false };
    }
  } catch {
    /* fall through to projection */
  }
  const projected = markProjected(
    projectBoundedJsonValue(payload, 5, {
      stringChars: 768,
      arrayItems: 10,
      objectKeys: 32,
    }),
  );
  try {
    if (fitsEnvelope(projected)) {
      return { payload: projected, projected: true };
    }
  } catch {
    /* fall through */
  }
  const minimal = markProjected(
    projectBoundedJsonValue(payload, 3, {
      stringChars: 192,
      arrayItems: 4,
      objectKeys: 16,
    }),
  );
  try {
    if (fitsEnvelope(minimal)) {
      return { payload: minimal, projected: true };
    }
  } catch {
    /* fall through */
  }
  return {
    payload: {
      detailOmitted: true,
      __stellaEagerProjection: {
        truncated: true,
        fullDetailAvailable: true,
      },
    },
    projected: true,
  };
};

export const projectLocalChatUpdateEventWithMetadata = (
  event: LocalChatEventRecord,
): { event: LocalChatEventRecord; payloadProjected: boolean } => {
  if (
    !event?.payload ||
    event.type === "user_message" ||
    event.type === "assistant_message"
  ) {
    return { event, payloadProjected: false };
  }
  const projected = projectEagerEventPayload(event.payload);
  return {
    event: { ...event, payload: projected.payload },
    payloadProjected: projected.projected,
  };
};

export const projectLocalChatUpdateEvent = (
  event: LocalChatEventRecord,
): LocalChatEventRecord =>
  projectLocalChatUpdateEventWithMetadata(event).event;

/* ------------------------------------------------------------------ */
/* Message previews                                                    */
/* ------------------------------------------------------------------ */

