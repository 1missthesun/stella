import type { ReactNode } from "react";
import type {
  Attachment,
  ChannelEnvelope,
} from "@/features/chat/lib/event-transforms";
import type { DisplayPayload } from "@stella/contracts/desktop/display-payload";
import type { AgentResponseTarget } from "@/features/chat/streaming/streaming-types";
import type { TurnMapArtifact } from "@/features/chat/lib/derive-turn-map-artifacts";
import type { PastedTextDescriptor } from "@/features/chat/lib/paste-context";
import type { ToolActivityGroup } from "@/features/chat/lib/tool-activity";
import type { ConversationFileEntry } from "@/features/workspace-display/derive-conversation-files";
import type { AgentCompletionSection } from "@/features/chat/lib/agent-completion";
import type { OfficePreviewRef } from "@stella/contracts/office-preview";
import type { VoiceSessionSummaryMetadata } from "@stella/contracts/local-chat";
import type { ReminderMark } from "@stella/contracts/reminders";
import type { ReplyRef } from "@stella/contracts/reply-refs";
import type { UserAskRecord } from "@stella/contracts/user-ask-deck";

export type UserRowViewModel = {
  kind: "user";
  id: string;
  text: string;
  timestampMs?: number;
  justSent?: boolean;
  windowLabel?: string;
  windowPreviewImageUrl?: string;
  appSelectionLabels?: string[];
  activityLabel?: string;
  pastedTexts?: PastedTextDescriptor[];
  quotedText?: string;
  reaction?: string;
  reactionAt?: number;
  attachments: Attachment[];
  channelEnvelope?: ChannelEnvelope;
  hidden?: boolean;
  spawnedThreadIds?: string[];
  spawnedDescriptions?: string[];
};

export type AssistantRowViewModel = {
  kind: "assistant";
  id: string;
  text: string;
  timestampMs?: number;
  cacheKey: string;
  sourceMessageId?: string;
  sourceMessageSequence?: number;
  toolEventSummary?: {
    totalCount: number;
    loadedCount: number;
    truncated: boolean;
    totalCountIsLowerBound?: boolean;
    detailLoaded?: boolean;
    detailCursor?: { timestamp: number; id: string; sequence?: number };
    detailHasMore?: boolean;
    livePinsPending?: boolean;
  };
  justArrived?: boolean;
  isIntraTurn?: boolean;
  responseTarget?: AgentResponseTarget;
  replyRefs?: ReplyRef[];
  agentLabelIds?: string[];
  replyToUserMessageId?: string;
  spawnedThreadIds?: string[];
  spawnedDescriptions?: string[];
  officePreviewRef?: OfficePreviewRef;
  linkedFiles?: ConversationFileEntry[];
  resourcePayload?: DisplayPayload;
  inlineImagePayloads?: DisplayPayload[];
  mapArtifacts?: TurnMapArtifact[];
  askRecords?: UserAskRecord[];
  sourceDiffPayloads?: DisplayPayload[];
  voiceSession?: VoiceSessionSummaryMetadata;
  reminder?: ReminderMark;
  toolActivity?: ToolActivityGroup;
  backgroundWork?: {
    threadIds: string[];
    completedThreadIds: string[];
    failedThreadIds?: string[];
    stoppedThreadIds?: string[];
    supersededThreadIds?: string[];
    descriptions: Record<string, string>;
    statusTexts?: Record<string, string>;
    progressTexts?: Record<string, string>;
    followUpThreadIds?: string[];
    spawnedAtMs?: Record<string, number>;
    startEventIdsByThread: Record<string, string>;
    attemptGenerationsByThread?: Record<string, number>;
    rootRunIdsByThread: Record<string, string>;
    terminalEventIdsByThread?: Record<string, string>;
    cardId: string;
    completionSections?: AgentCompletionSection[];
  };
  agentCompletion?: {
    sections: AgentCompletionSection[];
  };
  /**
   * Optional renderer for surface-specific row attachments (e.g. the Store
   * thread's draft confirmation card). Mounted after the markdown body and
   * after built-in inline artifacts.
   *
   * Identity-stable per `customSlotKey` — the row equality comparator only
   * checks `customSlotKey` so re-rendering ancestors don't blow away the
   * memoized row when the renderer closure identity churns.
   */
  customSlot?: ReactNode;
  customSlotKey?: string;
};

export type EventRowViewModel = UserRowViewModel | AssistantRowViewModel;
