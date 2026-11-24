export type ClaudeLocalConfig = {
  configId: string;
  isDefault: boolean;
  loggedIn: boolean;
  email?: string;
  plan?: string;
  /** A Claude login lasts a fixed time from signing in, however often it is used. */
  loginExpiresAt?: number;
  ended?: boolean;
};

export const CLAUDE_LOGIN_WARN_BEFORE_MS = 3 * 24 * 60 * 60 * 1000;

export type ClaudeLoginAttention = {
  state: "ending" | "ended";
  configId: string;
  email?: string;
  expiresAt?: number;
};

export type ClaudeLocalAccountsState = {
  cliInstalled: boolean;
  configs: ClaudeLocalConfig[];
  activeConfigId: string | null;
  activeReason?: "selected" | "own_login" | "other_login";
  chosenEmail?: string;
  attention?: ClaudeLoginAttention;
};

export type ClaudeLocalLoginStart = {
  loginId: string;
  authorizeUrl: string;
};

export type ClaudeCliInstallProgress =
  | { phase: "checking" }
  | { phase: "downloading"; received: number; total: number | null }
  | { phase: "setting-up" };

export type ClaudeCliInstallResult =
  | { status: "installed"; version: string | null; executable: string }
  | { status: "offline"; detail: string }
  | { status: "unavailable"; detail: string }
  | { status: "failed"; detail: string };
