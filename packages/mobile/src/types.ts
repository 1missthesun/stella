import type { AgentPause } from "@stella/contracts/agent-pause";
import type { UserAskRecord } from "@stella/contracts/user-ask-deck";
import type { ReplyRef } from "@stella/contracts/reply-refs";
import type { ToolStep } from "./lib/tool-activity";

export type MobileDisplayFileArtifactKind =
  | "office-document"
  | "office-spreadsheet"
  | "office-slides"
  | "delimited-table";

export type MobileMediaAsset =
  | { kind: "image"; filePaths: string[] }
  | { kind: "video"; filePath: string }
  | { kind: "audio"; filePath: string }
  | { kind: "model3d"; filePath: string; label?: string }
  | { kind: "download"; filePath: string; label: string }
  | { kind: "text"; text: string };

export type MobileMapTravelMode = "driving" | "walking" | "cycling" | "transit";

export type MobileMapMarker = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address?: string;
  placeId?: string;
  rating?: number;
  ratingCount?: number;
  role?: "origin" | "destination" | "place";
};

export type MobileMapRoute = {
  mode: MobileMapTravelMode;
  originId: string;
  destinationId: string;
  distanceMeters: number;
  durationSeconds: number;
  summary?: string;
  polyline: string;
  steps?: { instruction: string; distanceMeters: number }[];
};

export type MobileAgentWorkFileSection = {
  agentId: string;
  title: string;
  files: MobileDisplayPayload[];
  summary?: string;
};

export type MobileOfficePreviewRef = {
  sessionId: string;
  title: string;
  sourcePath: string;
};

export type MobileDisplayPayload =
  | {
      kind: "canvas-html";
      filePath: string;
      title?: string;
      slug?: string;
      createdAt: number;
      driveBacked?: boolean;
    }
  | { kind: "url"; url: string; title: string; tabId: string; tooltip?: string }
  | { kind: "office"; previewRef: MobileOfficePreviewRef; title?: string }
  | {
      kind: "markdown";
      filePath: string;
      title?: string;
      createdAt?: number;
      driveBacked?: boolean;
    }
  | {
      kind: "source-diff";
      filePath: string;
      title?: string;
      patch?: string;
      createdAt?: number;
    }
  | {
      kind: "file-artifact";
      filePath: string;
      artifactKind: MobileDisplayFileArtifactKind;
      title?: string;
      createdAt?: number;
      driveBacked?: boolean;
    }
  | {
      kind: "pdf";
      filePath: string;
      title?: string;
      localUri?: string;
      sizeBytes?: number;
      textOffset?: number;
      toolCallId?: string;
      driveBacked?: boolean;
    }
  | {
      kind: "media";
      asset: MobileMediaAsset;
      createdAt: number;
      prompt?: string;
      title?: string;
      madeBy?: string;
      presentation?: "inline-image";
      aspectRatio?: string;
      numImages?: number;
      toolCallId?: string;
      generationState?: "running" | "completed" | "failed" | "canceled";
      textOffset?: number;
      driveBacked?: boolean;
    }
  | {
      kind: "agent-work";
      state: "running" | "done";
      agentIds?: string[];
      total: number;
      completed: number;
      title: string;
      subtitle: string;
      createdAt: number;
      textOffset?: number;
      textOffsetsByAgentId?: Record<string, number>;
      agents?: MobileAgentWorkFileSection[];
      followUp?: boolean;
      failed?: boolean;
      completion?: boolean;
    }
  | {
      kind: "map-route";
      version: 1;
      title?: string;
      markers: MobileMapMarker[];
      route?: MobileMapRoute;
    };

export type ChatArtifact = {
  id: string;
  conversationId: string;
  payload: MobileDisplayPayload;
  textOffset?: number;
};

export type ComposerQuote = {
  id: string;
  text: string;
};

export type ComposerPastedText = {
  id: string;
  text: string;
};

export type ChatMessage = {
  askRecords?: readonly UserAskRecord[];
  reminder?: { fireId: string; scheduleId: string; dueAt?: number };
  welcome?: import("@stella/contracts/welcome-message").WelcomeMark;
  scheduleNotice?: import("@stella/contracts/schedule-notice").ScheduleNoticeCard;
  scheduleNoticeRun?: readonly import("@stella/contracts/schedule-notice").ScheduleNoticeCard[];
  replyRefs?: ReplyRef[];
  reaction?: string;
  reactionAt?: number;
  agentStates?: Record<string, "running" | "completed" | "error" | "canceled">;
  spawnedThreadIds?: string[];
  spawnedDescriptions?: string[];
  id: string;
  canonicalId?: string;
  requestId?: string;
  createdAt?: number;
  canonicalCreatedAt?: number;
  sourceMessageId?: string;
  sourceTimestamp?: number;
  sequence?: number;
  sentAfterSequence?: number;
  role: "assistant" | "user";
  text: string;
  artifacts?: ChatArtifact[];
  /** Stella Views this reply made or changed (the orchestrator's `view` tool). */
  views?: ChatViewRef[];
  toolSteps?: ToolStep[];
  tasks?: MobileTask[];
  hasImage?: boolean;
  thumbnailUris?: string[];
  attachmentPaths?: string[];
  attachmentPreviews?: {
    path: string;
    name: string;
    imageUri?: string;
    uploadId?: string;
  }[];
  documentNames?: string[];
  quotedText?: string;
  pastedTexts?: { lines: number; chars: number; text?: string }[];
  send?: "queued" | "not_sent" | "stopped";
  sentWhileBusy?: boolean;
  stopped?: boolean;
  cloudFallback?: boolean;
};

/** One version of a Stella View: the whole `.view.tsx` source, run on the phone itself. */
export type ChatViewRef = {
  slug: string;
  title: string;
  source: string;
  data?: unknown;
  createdAt: number;
  toolCallId: string;
};

export type MobileTask = {
  id: string;
  title: string;
  agentType?: string;
  parentAgentId?: string;
  status: "running" | "completed" | "error" | "canceled";
  authoritativeRunning?: true;
  waitingFor?: string;
  waitingForHelpers?: boolean;
  paused?: AgentPause;
  updatedAt?: number;
  statusText?: string;
  resultText?: string;
  errorMessage?: string;
  reasoningSummaries?: string[];
  createdAt: number;
  completedAt?: number;
};

