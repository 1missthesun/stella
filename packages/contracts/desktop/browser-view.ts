import type { StellaBrowserBridgeFailureReason } from "../browser-bridge-status.js";

export type BrowserViewConnection = "checking" | "disconnected" | "connected";

export type BrowserViewUnavailableReason =
  | "extension_not_installed"
  | "extension_disconnected"
  | StellaBrowserBridgeFailureReason;

export type BrowserViewTabState = {
  id: string;
  ownerId: string;
  url: string;
  title: string;
  faviconUrl?: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  agentActive?: boolean;
};

export type BrowserViewOwnerState = {
  id: string;
  kind: "manual" | "agent";
  tabCount: number;
  activeTabId?: string;
  latest: boolean;
};

export type BrowserViewState = {
  connection: BrowserViewConnection;
  visibleOwnerId: string;
  owners: BrowserViewOwnerState[];
  tabs: BrowserViewTabState[];
  activeTabId?: string;
  error?: string;
  connectionError?: string;
  unavailableReason?: BrowserViewUnavailableReason;
};

export type BrowserViewBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type BrowserViewLayout = {
  pageBounds: BrowserViewBounds;
  surfaceBounds: BrowserViewBounds;
};

export type BrowserExtensionClientStatus =
  | "in_use"
  | "connected"
  | "not_connected"
  | "off";

export type BrowserExtensionClient = {
  key: string;
  browser: string;
  profile: string | null;
  email: string | null;
  connected: boolean;
  enabled: boolean;
  inUse: boolean;
  status: BrowserExtensionClientStatus;
  lastSeenAtMs: number;
};

export type BrowserExtensionRouting = {
  preferredKey: string | null;
  disabledKeys: string[];
};

export type BrowserExtensionClientsState = BrowserExtensionRouting & {
  clients: BrowserExtensionClient[];
};
