export type ClaudeLocalConfig = {
  configId: string;
  isDefault: boolean;
  loggedIn: boolean;
  email?: string;
  plan?: string;
  /**
   * When Anthropic ends this login (epoch ms). A Claude login lasts a fixed
   * time from signing in, however often it is used; after it only signing
   * in again works.
   */
  loginExpiresAt?: number;
  /** The login was there but has ended (time limit, or Anthropic refused it). */
  ended?: boolean;
};

/** Claude logins end this long ahead of time get a heads-up. */
export const CLAUDE_LOGIN_WARN_BEFORE_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * The login Stella answers with on this computer needs the person: it ends
 * soon, or it has ended and nothing else here can answer.
 */
export type ClaudeLoginAttention = {
  state: "ending" | "ended";
  /** The login to sign in again; "default" is Claude Code's own login. */
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

/** Progress of installing Claude Code from onboarding. */
export type ClaudeCliInstallProgress =
  | { phase: "checking" }
  | { phase: "downloading"; received: number; total: number | null }
  | { phase: "setting-up" };

export type ClaudeCliInstallResult =
  | { status: "installed"; version: string | null; executable: string }
  /** No connection to Anthropic's download service. */
  | { status: "offline"; detail: string }
  /** Claude Code isn't offered here (platform, or a region Anthropic doesn't serve). */
  | { status: "unavailable"; detail: string }
  | { status: "failed"; detail: string };
