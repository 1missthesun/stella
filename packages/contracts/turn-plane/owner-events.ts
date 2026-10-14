import type { CloudExecutionSelection } from "../agent-engine.js";
import type {
  CloudTurnLane,
  CloudTurnSource,
} from "./turn-start.js";

export const OWNER_EVENT_VERSION = 1 as const;

type OwnerEventBase = {
  v: typeof OWNER_EVENT_VERSION;
  key: string;
  ownerId: string;
  ownerGeneration: string;
  emittedAt: number;
};

export type ConversationCreatedEvent = OwnerEventBase & {
  kind: "conversation.created";
  conversationId: string;
  createdAt: number;
  title: string;
  execution?: CloudExecutionSelection;
};

export type ConversationIndexEvent = OwnerEventBase & {
  kind: "conversation.index";
  conversationId: string;
  epoch: number;
  lastSeq: number;
  updatedAt: number;
  createdAt?: number;
  title?: string;
  lastPreview?: string;
  lastRole?: string;
  activity?: "idle" | "running";
  force?: boolean;
};

export type ConversationDeletedEvent = OwnerEventBase & {
  kind: "conversation.deleted";
  conversationId: string;
  deletedAt: number;
};

export type TurnKind = "chat" | "agent" | "app";

export type TurnStartedEvent = OwnerEventBase & {
  kind: "turn.started";
  turnId: string;
  turnKind: TurnKind;
  conversationId: string;
  sessionId: string;
  lane: CloudTurnLane | "agent" | "build";
  source?: CloudTurnSource;
  clientMsgId?: string;
  hidden?: boolean;
  threadId?: string;
  attemptGeneration?: number;
  agentType: string;
  execution: CloudExecutionSelection;
  prompt: string;
  createdAt: number;
};

export type TurnEventEvent = OwnerEventBase & {
  kind: "turn.event";
  turnId: string;
  attemptGeneration?: number;
  sessionId: string;
  eventSeq: number;
  eventKind: string;
  payload: unknown;
  terminal: boolean;
  terminalStatus?: "completed" | "failed" | "canceled" | "waiting_for_user";
  errorMessage?: string;
  resultJson?: string;
  createdAt: number;
};

export type ThreadSpawnedEvent = OwnerEventBase & {
  kind: "thread.spawned";
  threadId: string;
  conversationId: string;
  parentTurnId: string;
  parentThreadId?: string;
  agentDepth: number;
  attemptGeneration: number;
  description: string;
  prompt: string;
  execution: CloudExecutionSelection;
  placement: "cloud";
  originDeviceId?: string;
  originConversationId?: string;
  harness?: "pi";
  createdAt: number;
};

export type ThreadCompletedEvent = OwnerEventBase & {
  kind: "thread.completed";
  threadId: string;
  conversationId?: string;
  turnId: string;
  attemptGeneration: number;
  status: "completed" | "failed" | "canceled" | "paused" | "waiting_for_user";
  resultJson?: string;
  errorMessage?: string;
  completedAt: number;
};

export type OwnerEvent =
  | ConversationCreatedEvent
  | ConversationIndexEvent
  | ConversationDeletedEvent
  | TurnStartedEvent
  | TurnEventEvent
  | ThreadSpawnedEvent
  | ThreadCompletedEvent;

export const ownerReadsTurnEvent = (
  event: Pick<TurnEventEvent, "terminal" | "eventKind">,
): boolean =>
  event.terminal ||
  event.eventKind === "waiting_for_user" ||
  event.eventKind === "output_files";

export const ownerReadsEvent = (event: OwnerEvent): boolean =>
  event.kind !== "turn.event" || ownerReadsTurnEvent(event);
