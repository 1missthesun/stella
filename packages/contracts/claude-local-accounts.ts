/**
 * Claude Code logins on this computer, as the desktop shows them. Types only,
 * so the preload bridge and the renderer can import them.
 *
 * Stella never holds these credentials. The default login is Claude Code's
 * own default config (`~/.claude`, the user's normal `claude` login); every
 * additional login is a Stella-managed `CLAUDE_CONFIG_DIR` signed in by
 * running the real `claude auth login` with that directory. Identity comes
 * from `claude auth status --json`.
 */

export type ClaudeLocalConfig = {
  /** "default" for the CLI's own default config, else Stella's id for the extra config dir. */
  configId: string;
  isDefault: boolean;
  loggedIn: boolean;
  email?: string;
  /** `subscriptionType` as the CLI reports it (e.g. "max", "pro"). */
  plan?: string;
};

export type ClaudeLocalAccountsState = {
  /** Whether a `claude` executable was found. */
  cliInstalled: boolean;
  configs: ClaudeLocalConfig[];
  /**
   * The config the next local Claude turn runs on: the one signed in to the
   * account chosen for this computer, else the default config, else the
   * first signed-in one. Null while no config here is signed in.
   */
  activeConfigId: string | null;
  /**
   * Why the active config is the one in use: the account chosen in Stella,
   * this computer's own Claude Code login, or another login here (the chosen
   * account isn't signed in here, or nothing is chosen).
   */
  activeReason?: "selected" | "own_login" | "other_login";
  /** The account chosen in Stella for every place, when one is. */
  chosenEmail?: string;
};

/**
 * A `claude auth login` under way. The CLI has opened Anthropic's page and
 * finishes by itself once the user approves there.
 */
export type ClaudeLocalLoginStart = {
  loginId: string;
  /**
   * The CLI's printed fallback: Anthropic's page that shows a code to paste
   * instead, for when the browser didn't open.
   */
  authorizeUrl: string;
};
