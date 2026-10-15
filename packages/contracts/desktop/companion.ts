import type { ChatContext } from "../index.js";

export const COMPANION_MARK_SIZE = 84;

export const COMPANION_COMPACT_SIZE = { width: 128, height: 128 } as const;

export const COMPANION_FULL_SIZE = { width: 400, height: 560 } as const;

export const COMPANION_MARK_BOTTOM_INSET = 14;
export const COMPANION_MARK_SIDE_INSET =
  (COMPANION_COMPACT_SIZE.width - COMPANION_MARK_SIZE) / 2;
export const COMPANION_MARK_TOP_INSET =
  COMPANION_COMPACT_SIZE.height -
  COMPANION_MARK_SIZE -
  COMPANION_MARK_BOTTOM_INSET;

export type CompanionWindowKind = "mark" | "panel";

export type CompanionAnchor = { x: number; y: number };

export type CompanionEdgeH = "left" | "right";
export type CompanionEdgeV = "top" | "bottom";

export type CompanionLayout = {
  kind: CompanionWindowKind;
  width: number;
  height: number;
  edgeH: CompanionEdgeH;
  edgeV: CompanionEdgeV;
};

export type CompanionPanelStatus = {
  expanded: boolean;
  recording: boolean;
  transcribing: boolean;
  wantsVisible: boolean;
};

export type CompanionActivity = {
  hovered: boolean;
  panelActive: boolean;
  expanded: boolean;
  recording: boolean;
  transcribing: boolean;
};

export type CompanionWorkState =
  | "thinking"
  | "working"
  | "writing"
  | "searching"
  | "reading";

export type CompanionMessagePreview = {
  id: string;
  text: string;
  at: number;
  /** User messages: the optimistic id the stored message was accepted from. */
  originId?: string;
  /** Assistant messages: the user message this replies to. */
  replyTo?: string;
};

export type CompanionState = {
  conversationId: string | null;
  latestUser: CompanionMessagePreview | null;
  latestAssistant: (CompanionMessagePreview & { streaming: boolean }) | null;
  isStreaming: boolean;
  workState: CompanionWorkState | null;
  runningAgentCount: number;
  readAloudPlaying: boolean;
};

export const EMPTY_COMPANION_STATE: CompanionState = {
  conversationId: null,
  latestUser: null,
  latestAssistant: null,
  isStreaming: false,
  workState: null,
  runningAgentCount: 0,
  readAloudPlaying: false,
};

/** What the pet's + menu and paste can attach to a message. */
export type CompanionAttachments = Pick<
  ChatContext,
  "files" | "regionScreenshots" | "pastedTexts"
>;

export type CompanionSendRequest = {
  text: string;
  attachments?: CompanionAttachments;
};

export type CompanionDragMove = {
  screenX: number;
  screenY: number;
};

export type CompanionVisibility = { visible: boolean };
