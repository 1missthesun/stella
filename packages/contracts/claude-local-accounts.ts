export type ClaudeLocalConfig = {
  configId: string;
  isDefault: boolean;
  loggedIn: boolean;
  email?: string;
  plan?: string;
};

export type ClaudeLocalAccountsState = {
  cliInstalled: boolean;
  configs: ClaudeLocalConfig[];
  activeConfigId: string | null;
  activeReason?: "selected" | "own_login" | "other_login";
  chosenEmail?: string;
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
