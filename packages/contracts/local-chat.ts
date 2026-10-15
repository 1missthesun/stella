import type { OfficePreviewRef } from "./office-preview.js";
import type { AgentModelConfigSnapshot } from "./agent-engine.js";

export type EventRecord = {
  _id: string;
  timestamp: number;
  sequence?: number;
  type: string;
  deviceId?: string;
  requestId?: string;
  targetDeviceId?: string;
  payload?: Record<string, unknown>;
  channelEnvelope?: ChannelEnvelope;
};

export type LocalChatUpdatedPayload = {
  conversationId?: string;
  event?: EventRecord;
};

export type ConversationSummary = {
  conversationId: string;
  title: string;
  latestMessageId?: string;
  latestMessageAt?: number;
  createdAt: number;
  updatedAt: number;
};

export type LocalModelUsageRecord = {
  id: string;
  timestamp: number;
  conversationId: string;
  conversationTitle: string;
  threadId: string;
  threadName: string;
  agentType: string;
  agentDescription?: string;
  agentDepth?: number;
  parentAgentId?: string;
  rootRunId?: string;
  provider: string;
  api: string;
  model: string;
  responseModel?: string;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  inputCostUsd: number;
  cacheReadCostUsd: number;
  cacheWriteCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
  stopReason: string;
  errorMessage?: string;
};

export type LocalModelUsagePage = {
  records: LocalModelUsageRecord[];
  truncated: boolean;
};

export type ThreadActivityRecord = {
  source: "stella" | "claude-native";
  threadId: string;
  conversationId: string;
  agentType: string;
  description: string;
  status: "running" | "completed" | "error" | "canceled";
  attemptGeneration?: number;
  recordRevision?: number;
  rootRunId?: string;
  modelConfigSnapshot?: AgentModelConfigSnapshot;
  parentAgentId?: string;
  groupKey?: string;
  groupLabel?: string;
  startedAt: number;
  completedAt?: number;
  result?: string;
  error?: string;
  assistantMessages?: string[];
  assistantMessagesUpdatedAt?: number;
  assistantMessagesUpdatedSequence?: number;
  updatedAt: number;
};

export type ThreadActivityAssistantUpdate = {
  threadId: string;
  assistantMessages: string[];
  reasoningSummaries: string[];
  latestMessage: string;
  atMs: number;
  atSequence?: number;
  attemptGeneration: number;
  rootRunId?: string;
};

export type ThreadTranscriptUpdate = {
  source?: "stella" | "claude-native";
  threadId: string;
  entryId: string;
  atMs: number;
};

export type ThreadActivityUpdatedPayload = {
  conversationId: string;
  record?: ThreadActivityRecord;
  assistantUpdate?: ThreadActivityAssistantUpdate;
  transcriptUpdate?: ThreadTranscriptUpdate;
};

export type WebSearchResultHit = {
  title: string;
  url: string;
  snippet: string;
  image?: string;
  favicon?: string;
};

export type BrowserUseResponseMeta = {
  "stella/browserUse": true;
  "stella/toolSurface": {
    kind: "browserUse";
    backend: "iab" | "extension";
    browserId: string;
    openTabIds: string[];
    sessionEnded: boolean;
    screenshot?: {
      tabId: string;
      url: string;
      pageUrl?: string;
    };
  };
  browser_use?: {
    url?: string;
  };
};

export type ToolResultPayload = {
  toolName: string;
  isError?: boolean;
  result?: unknown;
  resultPreview?: string;
  error?: string;
  requestId?: string;
  agentType?: string;
  officePreviewRef?: OfficePreviewRef;
  mode?: string;
  query?: string;
  results?: WebSearchResultHit[];
  _meta?: BrowserUseResponseMeta;
};

export type Attachment = {
  id?: string;
  url?: string;
  mimeType?: string;
  name?: string;
  size?: number;
  kind?: string;
  path?: string;
  providerMeta?: unknown;
};

export type ChannelReaction = {
  emoji: string;
  action: "add" | "remove";
  targetMessageId?: string;
};

export type ChannelEnvelope = {
  provider: string;
  kind: "message" | "reaction" | "edit" | "delete" | "system";
  chatType?: string;
  externalUserId?: string;
  externalChatId?: string;
  externalMessageId?: string;
  threadId?: string;
  text?: string;
  attachments?: Attachment[];
  reactions?: ChannelReaction[];
  sourceTimestamp?: number;
  providerPayload?: unknown;
};

const CHANNEL_ENVELOPE_KINDS: ReadonlySet<ChannelEnvelope["kind"]> = new Set([
  "message",
  "reaction",
  "edit",
  "delete",
  "system",
]);

const recordOf = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const optionalString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const optionalNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const parseAttachment = (value: unknown): Attachment | null => {
  const record = recordOf(value);
  if (!record) return null;
  const attachment: Attachment = {};
  for (const key of ["id", "url", "mimeType", "name", "kind", "path"] as const) {
    const text = optionalString(record[key]);
    if (text !== undefined) attachment[key] = text;
  }
  const size = optionalNumber(record.size);
  if (size !== undefined) attachment.size = size;
  if (record.providerMeta !== undefined) {
    attachment.providerMeta = record.providerMeta;
  }
  return attachment;
};

const parseReaction = (value: unknown): ChannelReaction | null => {
  const record = recordOf(value);
  if (!record || typeof record.emoji !== "string") return null;
  if (record.action !== "add" && record.action !== "remove") return null;
  const targetMessageId = optionalString(record.targetMessageId);
  return {
    emoji: record.emoji,
    action: record.action,
    ...(targetMessageId !== undefined ? { targetMessageId } : {}),
  };
};

export const parseChannelEnvelope = (
  value: unknown,
): ChannelEnvelope | null => {
  const record = recordOf(value);
  if (!record || typeof record.provider !== "string") return null;
  const kind = record.kind as ChannelEnvelope["kind"];
  if (!CHANNEL_ENVELOPE_KINDS.has(kind)) return null;
  const envelope: ChannelEnvelope = { provider: record.provider, kind };
  for (const key of [
    "chatType",
    "externalUserId",
    "externalChatId",
    "externalMessageId",
    "threadId",
    "text",
  ] as const) {
    const text = optionalString(record[key]);
    if (text !== undefined) envelope[key] = text;
  }
  if (Array.isArray(record.attachments)) {
    envelope.attachments = record.attachments
      .map(parseAttachment)
      .filter((attachment): attachment is Attachment => attachment !== null);
  }
  if (Array.isArray(record.reactions)) {
    envelope.reactions = record.reactions
      .map(parseReaction)
      .filter((reaction): reaction is ChannelReaction => reaction !== null);
  }
  const sourceTimestamp = optionalNumber(record.sourceTimestamp);
  if (sourceTimestamp !== undefined) envelope.sourceTimestamp = sourceTimestamp;
  if (record.providerPayload !== undefined) {
    envelope.providerPayload = record.providerPayload;
  }
  return envelope;
};

export type MessagePayload = {
  text?: string;
  contextText?: string;
  role?: string;
  source?: string;
  agentType?: string;
  attachments?: Attachment[];
  mode?: string;
  userMessageId?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  metadata?: MessageMetadata;
};

export type MessageMetadata = {
  ui?: {
    visibility?: "visible" | "hidden";
  };
  context?: {
    windowLabel?: string;
    windowPreviewImageUrl?: string;
    appSelectionLabel?: string;
    appSelectionLabels?: string[];
    activityLabel?: string;
    pastedTexts?: { text?: string; lines: number; chars: number }[];
    quotedText?: string;
  };
  trigger?: {
    kind?: string;
    source?: string;
    targetAgentId?: string;
  };
  voiceSession?: VoiceSessionSummaryMetadata;
  reminder?: { fireId: string; scheduleId: string; dueAt?: number };
  scheduleNotice?: import("./schedule-notice.js").ScheduleNoticeCard;
};

export type VoiceSessionSummaryMetadata = {
  durationMs: number;
};

export type MessageRecord = {
  _id: string;
  timestamp: number;
  sequence?: number;
  type: string;
  deviceId?: string;
  requestId?: string;
  targetDeviceId?: string;
  payload?: Record<string, unknown>;
  channelEnvelope?: ChannelEnvelope;
  toolEvents: EventRecord[];
  toolEventSummary?: {
    totalCount: number;
    loadedCount: number;
    truncated: boolean;
    totalCountIsLowerBound?: boolean;
    detailLoaded?: boolean;
    detailCursor?: LocalChatTimelineCursor;
    detailHasMore?: boolean;
    livePinsPending?: boolean;
  };
};

export type LocalChatTimelineCursor = {
  timestamp: number;
  id: string;
  sequence?: number;
};

export type LocalChatMessageWindow = {
  messages: MessageRecord[];
  visibleMessageCount: number;
  nextCursor?: LocalChatTimelineCursor;
};

export type LocalChatLineageWindow = {
  messages: MessageRecord[];
  hasOlder: boolean;
};

export type LocalChatAgentReport = {
  threadId: string;
  description: string;
  agentType: string;
  status: "running" | "completed" | "error" | "canceled";
  result?: string;
  error?: string;
  startedAt: number;
  completedAt?: number;
};

