export type DiscoveryCategory =
  | "browsing_bookmarks"
  | "dev_environment"
  | "apps_system"
  | "messages_notes";

export type WindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
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

export type BrowserType =
  | "chrome"
  | "edge"
  | "brave"
  | "arc"
  | "opera"
  | "vivaldi";

export type BrowsingSignals = {
  browsers: string[];
  visitCount: number;
  text: string;
};

export type PreferredBrowserProfile = {
  browser: BrowserType | null;
  profile: string | null;
};

export type BrowserProfile = {
  id: string;
  name: string;
};

export type DevProject = {
  name: string;
  path: string;
  lastActivity: number;
  tech?: string[];
};

export type AllUserSignals = {
  browsing: BrowsingSignals | null;
  devProjects: DevProject[];
};

export type AllUserSignalsResult = {
  data: AllUserSignals | null;
  formatted: string | null;
  formattedSections?: Partial<Record<DiscoveryCategory, string>> | null;
  error?: string;
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
