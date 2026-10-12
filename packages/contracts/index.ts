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
  /**
   * On-disk source path when the attachment came from a disk-backed File
   * (picker / drag-drop). The composer chip uses it to open the original
   * in its default app for preview; absent for synthetic files.
   */
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
  /**
   * Legacy single-slot mirror of the most recent selected area. Kept in
   * sync with the last entry of `appSelections` so single-slot readers
   * (capture heuristics, older payload producers) keep working; new code
   * should read `appSelections`.
   */
  appSelection?: ChatAppSelection | null;
  /**
   * All selected-area contexts attached to the composer, in attach
   * order. Selections accumulate until sent or individually removed,
   * like attachments.
   */
  appSelections?: ChatAppSelection[];
  windowContextEnabled?: boolean;
  windowAxTree?: string | null;
  browserUrl?: string | null;
  selectedText?: string | null;
  regionScreenshots?: {
    dataUrl: string;
    width: number;
    height: number;
    /**
     * Downscaled data URL for chip thumbnails and message-row rendering.
     * Full-resolution pixels are reserved for the model request —
     * rendering them in chips forces Chromium to decode multi-megabyte
     * images for ~50px thumbs.
     */
    previewUrl?: string;
    /**
     * Absolute on-disk path for picker/drag-drop attachments. When set,
     * the renderer never loads the original bytes — `dataUrl` holds only
     * the preview, and the runtime worker reads + resizes the original
     * from disk at send time, keeping attach instant and the send IPC
     * payload tiny.
     */
    filePath?: string;
  }[];
  files?: ChatContextFile[];
  /**
   * Long text the user pasted into the composer, lifted out of the
   * textarea into collapsed "Pasted text" chips. Each entry is sent to
   * the agent as user-provided content for the turn.
   */
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

export type DomainVisit = {
  domain: string;
  visits: number;
};

export type DomainDetail = {
  title: string;
  url: string;
  visitCount: number;
};

export type ClusterKeyword = {
  keyword: string;
  score: number;
  lastVisit: number;
};

export type SearchQuery = {
  query: string;
  count: number;
};

export type BrowserData = {
  browser: BrowserType | null;
  clusterDomains: string[];
  recentDomains: DomainVisit[];
  allTimeDomains: DomainVisit[];
  domainDetails: Record<string, DomainDetail[]>;
  clusterKeywords: ClusterKeyword[];
  searchQueries?: SearchQuery[];
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
  /** Detected languages/frameworks, e.g. ["TypeScript", "React", "Convex"]. */
  tech?: string[];
};

export type CommandFrequency = {
  command: string;
  count: number;
};

export type ShellAnalysis = {
  topCommands: CommandFrequency[];
  projectPaths: string[];
  toolsUsed: string[];
};

export type AllUserSignals = {
  browser: BrowserData;
  devProjects: DevProject[];
  shell: ShellAnalysis;
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
