import type {
  EventRecord,
  MessageRecord,
} from "@stella/contracts/local-chat";
import { groupChatTurns } from "@stella/contracts/chat-turn-grouping";

const isTurnDecorationEvent = (event: EventRecord): boolean =>
  event.type === "tool_request" ||
  event.type === "tool_result" ||
  event.type === "agent-started" ||
  event.type === "agent-progress" ||
  event.type === "agent-completed" ||
  event.type === "agent-failed" ||
  event.type === "agent-canceled";

const toMessageRecord = (event: EventRecord): MessageRecord => ({
  _id: event._id,
  timestamp: event.timestamp,
  type: event.type,
  ...(event.deviceId ? { deviceId: event.deviceId } : {}),
  ...(event.requestId ? { requestId: event.requestId } : {}),
  ...(event.targetDeviceId ? { targetDeviceId: event.targetDeviceId } : {}),
  ...(event.payload ? { payload: event.payload } : {}),
  ...(event.channelEnvelope ? { channelEnvelope: event.channelEnvelope } : {}),
  toolEvents: [],
});

export const groupEventsIntoMessages = (
  events: readonly EventRecord[],
): MessageRecord[] =>
  groupChatTurns(events, toMessageRecord, isTurnDecorationEvent).messages;
