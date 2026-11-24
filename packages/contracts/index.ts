export type WindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ShowCaptureAttachment = {
  id: string;
  status: "preparing" | "ready" | "failed";
  durationMs: number;
  dir: string;
  contactSheet?: {
    path: string;
    previewUrl: string;
    width: number;
    height: number;
  };
  summary?: string;
  moments?: number;
  said?: string;
  video?: { path: string; name: string; size: number; mimeType: string };
  saveVideoToDrive?: boolean;
  error?: string;
};

export type ChatContextFile = {
  name: string;
  size: number;
  mimeType: string;
  dataUrl: string;
  path?: string;
};

export type ChatAppSelection = {
  label: string;
  snapshot: string;
  bounds: WindowBounds;
  surface?: string;
  anchor?: {
    kind: string;
    label?: string;
    tag?: string;
    role?: string;
    path?: string;
  };
  source?: {
    filePath?: string;
    lineNumber?: number;
    componentName?: string;
  };
  stack?: string;
};

export type ChatContext = {
  window: {
    title: string;
    app: string;
    bounds: WindowBounds;
  } | null;
  activity?: {
    id: string;
    label: string;
    agentType: string;
    status: string;
    runId?: string;
    anchorTurnId?: string;
    startedAtMs?: number;
    completedAtMs?: number;
    lastUpdatedAtMs?: number;
  } | null;
  appSelection?: ChatAppSelection | null;
  appSelections?: ChatAppSelection[];
  windowContextEnabled?: boolean;
  windowAxTree?: string | null;
  browserUrl?: string | null;
  selectedText?: string | null;
  regionScreenshots?: {
    dataUrl: string;
    width: number;
    height: number;
    previewUrl?: string;
    filePath?: string;
  }[];
  files?: ChatContextFile[];
  pastedTexts?: string[];
  showCaptures?: ShowCaptureAttachment[];
  captureSummaries?: string[];
  capturePending?: boolean;
  windowScreenshot?: {
    dataUrl: string;
    width: number;
    height: number;
  } | null;
};

export type ChatContextUpdate = {
  context: ChatContext | null;
  version: number;
};

export type AgentHealth =
  | {
      ready: true;
      runnerVersion?: string;
      engine?: string;
    }
  | {
      ready: false;
      reason?: string;
      engine?: string;
    };

export type LocalLlmCredentialSummary = {
  provider: string;
  label: string;
  status: "active";
  updatedAt: number;
  account?: string;
  plan?: string;
};

export type {
  LocalCronJobRecord,
  LocalHeartbeatConfigRecord,
  ScheduledConversationEvent,
  LocalCronJobUpdatePatch,
  LocalHeartbeatUpsertInput,
} from "./scheduling.js";

export type VoiceRuntimeSnapshot = {
  sessionState: "idle" | "connecting" | "connected" | "error" | "disconnecting";
  isConnected: boolean;
  isSpeaking: boolean;
  isUserSpeaking: boolean;
  micLevel: number;
  outputLevel: number;
};
