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
      /**
       * On-device PDF, kept on rows saved by the removed phone-side `pdf`
       * tool. Present only for phone-generated PDFs; a `file://` URI that the artifact
       * viewer previews and the share sheet saves/opens directly, with no
       * desktop bridge. Absent for bridged desktop PDFs, which stream their
       * bytes over the bridge from `filePath`.
       */
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
      /**
       * Per-agent produced-file sections computed desktop-side (each covered
       * agent's completion-rollup files, noise-filtered, deliverables first).
       * Present — possibly empty — on bridges that consolidate agent files
       * onto this card; its presence means any loose file artifacts left on
       * the row are orchestrator-direct. Absent on older desktops, where
       * mobile falls back to row-scoped folding.
       */
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

export type ChatMessage = {
  askRecords?: readonly UserAskRecord[];
  reminder?: { fireId: string; scheduleId: string; dueAt?: number };
  scheduleNotice?: import("@stella/contracts/schedule-notice").ScheduleNoticeCard;
  replyRefs?: ReplyRef[];
  reaction?: string;
  reactionAt?: number;
  agentStates?: Record<string, "running" | "completed" | "error" | "canceled">;
  spawnedThreadIds?: string[];
  /**
   * Descriptions of `spawn_agent` requests on this row. When the journal
   * carries no thread id for a spawn, reply context matches these against
   * the task titles later reports cite.
   */
  spawnedDescriptions?: string[];
  id: string;
  /**
   * Desktop-local message id this row reconciled to. Mobile keeps `id` stable
   * for the just-streamed row so sync does not remount the bubble.
   */
  canonicalId?: string;
  /**
   * Desktop request id linking a row to its turn. Canonical assistant rows are
   * stamped with the turn's user-message id desktop-side; the streamed local
   * reply adopts it at turn end so later syncs can link the canonical reply to
   * the bubble instead of duplicating it.
   */
  requestId?: string;
  /**
   * Creation time (ms epoch) shown for the row and used as its LOCAL anchor.
   * Local rows stamp this at send time (phone clock); desktop rows carry the
   * canonical desktop `timestamp`. Transcript ORDERING among canonical rows
   * uses `canonicalCreatedAt` — not this field — because the two clocks can
   * disagree by minutes.
   */
  createdAt?: number;
  /**
   * First-seen desktop timestamp for the canonical row this message is (or
   * reconciled to). It positions genuinely new sync rows against canonical
   * neighbours, then stays immutable: once a row is visible, replay,
   * reconciliation, and card-state updates preserve the array's insertion
   * order instead of globally re-sorting it. `createdAt` remains the local
   * display stamp. Absent on rows with no canonical identity yet (in-flight
   * optimistic turns, offline error bubbles) and on rows persisted by older
   * builds.
   */
  canonicalCreatedAt?: number;
  /**
   * Durable desktop source row used for backward keyset pagination. Synthetic
   * mobile projections (for example `:agent` cards) keep their own stable id,
   * but paging must continue from the real SessionStore row that produced
   * them.
   */
  sourceMessageId?: string;
  sourceTimestamp?: number;
  /**
   * Authoritative monotonic ordering key from the desktop (chat-ordering
   * re-architecture). When every row carries it the transcript is ordered by it
   * (jump-free, clock-independent). Present on canonical rows; absent on
   * in-flight optimistic rows until they reconcile, and on rows from a peer
   * desktop on an older build that never sends it — in those windows the merge
   * falls back to canonical insertion order (see rederiveOrder) so a row never
   * inverts above its neighbours.
   */
  sequence?: number;
  role: "assistant" | "user";
  text: string;
  artifacts?: ChatArtifact[];
  toolSteps?: ToolStep[];
  tasks?: MobileTask[];
  hasImage?: boolean;
  thumbnailUris?: string[];
  attachmentPaths?: string[];
  attachmentPreviews?: { path: string; name: string; imageUri?: string }[];
  documentNames?: string[];
  quotedText?: string;
  pastedTexts?: { lines: number; chars: number; text?: string }[];
  queued?: boolean;
  sentWhileBusy?: boolean;
  stopped?: boolean;
  /**
   * Assistant message: the paired desktop was unreachable, so this reply was
   * answered by the fallback responder instead. Renders a small "Answered
   * while your computer was offline" caption.
   */
  cloudFallback?: boolean;
};

export type MobileTask = {
  id: string;
  title: string;
  agentType?: string;
  parentAgentId?: string;
  status: "running" | "completed" | "error" | "canceled";
  authoritativeRunning?: true;
  updatedAt?: number;
  statusText?: string;
  resultText?: string;
  errorMessage?: string;
  reasoningSummaries?: string[];
  createdAt: number;
  completedAt?: number;
};

