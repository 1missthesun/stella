/**
 * Stella for Slack: the workspace settings page on stella.sh and the backend
 * API it calls. Every route is on the backend origin and takes the signed-in
 * user's backend JWT as a bearer token. A workspace is listed and editable
 * only by the Stella account that owns it (the one that installed it).
 */

import type { ReasoningEffortLevel } from "./reasoning-effort.js";

export const SLACK_WORKSPACES_PATH = "/api/slack/workspaces";
export const SLACK_INSTALL_START_PATH = "/api/slack/install/start";

export const slackWorkspacePath = (teamId: string): string =>
  `${SLACK_WORKSPACES_PATH}/${encodeURIComponent(teamId)}`;

export type SlackGithubAction = "connect" | "finish" | "disconnect" | "repos" | "branches";

/** `POST` adds a repository (`SlackRepoAdd`). */
export const slackReposPath = (teamId: string): string => `${slackWorkspacePath(teamId)}/repos`;

/** `POST` changes one repository (`SlackRepoUpdate`); `POST …/remove` removes it. */
export const slackRepoPath = (teamId: string, repoId: string): string =>
  `${slackReposPath(teamId)}/${encodeURIComponent(repoId)}`;

/** `slackWorkspacePath(teamId)/github/<action>`. */
export const slackGithubPath = (teamId: string, action: SlackGithubAction): string =>
  `${slackWorkspacePath(teamId)}/github/${action}`;

/** Stella's own runtime, or Claude Code on the owner's Claude login. */
export type SlackWorkspaceEngine = "stella" | "claude-code";

export const SLACK_WORKSPACE_ENGINES: readonly SlackWorkspaceEngine[] = ["stella", "claude-code"];

export type SlackWorkspaceModelOption = { id: string; label: string };

export type SlackWorkspaceOptions = {
  engines: Array<{ id: SlackWorkspaceEngine; label: string; detail: string }>;
  models: Record<SlackWorkspaceEngine, SlackWorkspaceModelOption[]>;
  efforts: ReasoningEffortLevel[];
  /** What `limited` network access allows besides Stella and the workspace's own hosts. */
  limitedHosts: string[];
};

/**
 * One GitHub account (user or organization) the workspace connected through
 * the Stella Crew GitHub App. A workspace can connect several, so repositories
 * of different owners sit side by side; each repository uses the connection
 * whose account owns it. `revoked` means the App was uninstalled or lost
 * access: reconnect.
 */
export type SlackWorkspaceGithub = {
  installationId: string;
  account: string;
  accountType: string;
  status: "active" | "suspended" | "revoked";
  /** github.com page where the installer picks which repositories Stella sees. */
  manageUrl: string;
};

/**
 * Who can open the workspace's Stella previews: anyone with the link, or only
 * people who sign in with Slack as members of the workspace.
 */
export type SlackPreviewAccess = "public" | "members";

export const SLACK_PREVIEW_ACCESS_DEFAULT: SlackPreviewAccess = "members";
export const SLACK_PREVIEW_TTL_DAYS_CHOICES = [1, 3, 7, 14, 30, 90] as const;
export const SLACK_PREVIEW_TTL_DAYS_DEFAULT = 14;

/**
 * Stella previews: sites agents build and host on Stella when the repository
 * publishes no preview of its own. Each link expires `ttlDays` after it was
 * made; changing it applies to existing links too.
 */
export type SlackWorkspacePreviews = {
  access: SlackPreviewAccess;
  ttlDays: number;
  /** Bytes held by links that haven't expired, against the owner's plan quota. */
  usedBytes: number;
  quotaBytes: number;
  live: number;
  /** Largest single preview. */
  maxPreviewBytes: number;
};

/**
 * What an agent container may reach. `none`: only Stella itself (and the
 * workspace's repository on GitHub). `limited`: also package registries,
 * GitHub and the other hosts in `SlackWorkspaceOptions.limitedHosts`, plus
 * the workspace's own `allowedHosts` and its secrets' hosts. `full`: the
 * Internet. Enforced by the container's network, not by the agent.
 */
export type SlackNetworkLevel = "none" | "limited" | "full";

export const SLACK_NETWORK_LEVELS: readonly SlackNetworkLevel[] = ["none", "limited", "full"];

/**
 * A network secret: on HTTPS requests to `host` (`*.example.com` matches any
 * subdomain), the container's network sets `header` to the saved value. The
 * value is write-only: never returned, never in the container.
 */
export type SlackNetworkSecret = {
  id: string;
  /** Also the name of a placeholder environment variable agents see. */
  name: string;
  host: string;
  header: string;
};

export type SlackSetupRun = {
  status: "succeeded" | "failed";
  exitCode: number | null;
  at: number;
  ms: number;
  /** The end of the script's output (stdout and stderr). */
  log: string;
};

/**
 * An environment: what an agent container started from Slack runs with.
 * Each repository has its own; the workspace has one more for work that
 * isn't about any repository.
 */
export type SlackWorkspaceEnvironment = {
  name: string;
  network: SlackNetworkLevel;
  /** Extra hosts for `limited`, one per entry (`*.example.com` allowed). */
  allowedHosts: string[];
  secrets: SlackNetworkSecret[];
  /** Bash, run as the agent's user when its container starts, in the repository. */
  setupScript: string;
  /** `.env` text. Not secret: anyone using the environment can read it. */
  envVars: string;
  lastSetup: SlackSetupRun | null;
};

export type SlackNetworkSecretInput = {
  name: string;
  host: string;
  header?: string;
  value: string;
};

export type SlackWorkspaceEnvironmentUpdate = {
  name?: string;
  network?: SlackNetworkLevel;
  allowedHosts?: string[];
  setupScript?: string;
  envVars?: string;
  secrets?: { add?: SlackNetworkSecretInput[]; remove?: string[] };
};

export const SLACK_ENV_NAME_MAX_CHARS = 60;
export const SLACK_SETUP_SCRIPT_MAX_CHARS = 20_000;
export const SLACK_ENV_VARS_MAX_CHARS = 20_000;
export const SLACK_ALLOWED_HOSTS_MAX = 100;
export const SLACK_NETWORK_SECRETS_MAX = 50;
export const SLACK_NETWORK_SECRET_MAX_CHARS = 8_000;

/** A channel (or DM) whose threads default to a repository. */
export type SlackRepoChannel = { id: string; name: string };

/**
 * One of the workspace's repositories. Stella picks which one a request is
 * about (from the request, the thread and the channel's default) and every
 * agent she starts for it gets it cloned, with its own environment.
 */
export type SlackWorkspaceRepo = {
  /** Stable id, used in `slackRepoPath`. */
  id: string;
  /** `owner/name` on github.com. */
  fullName: string;
  /** Empty means the repository's default branch. */
  branch: string;
  /**
   * How agents get it: through one of the workspace's GitHub connections, as
   * a public repository, or with an access token pasted before GitHub
   * connections existed (kept until the owner picks the repository again).
   */
  access: "github" | "public" | "token";
  /** Rules for work in this repository, on top of the workspace's rules. */
  rules: string;
  /** Channels whose threads use this repository unless Stella picks another. */
  channels: SlackRepoChannel[];
  /** Null where this deployment doesn't offer environments yet. */
  environment: SlackWorkspaceEnvironment | null;
  /** Previews built from this repository. Usage is the workspace's. */
  previews: SlackWorkspacePreviews;
};

export type SlackWorkspace = {
  teamId: string;
  teamName: string;
  /** The Drive folder that holds the workspace's files and notes. */
  homeFolder: string;
  installedAt: number;
  engine: SlackWorkspaceEngine;
  model: string;
  effort: ReasoningEffortLevel;
  /** People in Slack may switch engine, model and effort with `/stella`. */
  slackCommands: boolean;
  /** Connected GitHub accounts, oldest first. */
  githubAccounts: SlackWorkspaceGithub[];
  /** The workspace's repositories, oldest first. */
  repos: SlackWorkspaceRepo[];
  /** Previews of work that isn't about a repository (and the workspace's usage). */
  previews: SlackWorkspacePreviews;
  /**
   * The environment of work that isn't about any repository. Null where this
   * deployment doesn't offer environments yet.
   */
  environment: SlackWorkspaceEnvironment | null;
  /** Plain-language rules Stella follows in this workspace (`memories/rules.md`). */
  rules: string;
  /** Stella's workspace-wide notes (`memories/workspace.md`). */
  memory: string;
  /** Opens the workspace in Slack. */
  slackUrl: string;
};

/** `GET SLACK_WORKSPACES_PATH` */
export type SlackWorkspacesResponse = {
  /** False when this deployment has no Slack app configured. */
  available: boolean;
  /** False when this deployment has no GitHub App for Slack configured. */
  githubAvailable: boolean;
  workspaces: SlackWorkspace[];
  options: SlackWorkspaceOptions;
};

/** `POST SLACK_INSTALL_START_PATH` → the Slack "Add to Slack" URL to open. */
export type SlackInstallStartRequest = {
  /** Where Slack's install finishes; must be on the site's origin. */
  returnTo: string;
};
export type SlackInstallStartResponse = { url: string };

/**
 * `POST slackWorkspacePath(teamId)`. Only the fields present change.
 * `previews` and `environment` are those of work that isn't about a
 * repository; each repository's are changed with `SlackRepoUpdate`.
 */
export type SlackWorkspaceUpdate = {
  engine?: SlackWorkspaceEngine;
  model?: string;
  effort?: ReasoningEffortLevel;
  slackCommands?: boolean;
  previews?: { access?: SlackPreviewAccess; ttlDays?: number };
  environment?: SlackWorkspaceEnvironmentUpdate;
  rules?: string;
  memory?: string;
};

/**
 * `POST slackReposPath(teamId)` → `SlackWorkspaceUpdateResponse`. A
 * repository is reached through the GitHub connection whose account owns it,
 * else as public. It starts with the default environment (full network).
 */
export type SlackRepoAdd = { fullName: string; branch?: string };

/** `POST slackReposPath(teamId)` → the workspace, and the new repository's id. */
export type SlackRepoAddResponse = { workspace: SlackWorkspace; repoId: string };

/** `POST slackRepoPath(teamId, repoId)` → `SlackWorkspaceUpdateResponse`. Only the fields present change. */
export type SlackRepoUpdate = {
  branch?: string;
  rules?: string;
  previews?: { access?: SlackPreviewAccess; ttlDays?: number };
  environment?: SlackWorkspaceEnvironmentUpdate;
  /** Channel ids that stop defaulting to this repository. */
  removeChannels?: string[];
};

export const SLACK_REPOS_MAX = 50;
export const SLACK_REPO_RULES_MAX_CHARS = 4000;

export type SlackWorkspaceUpdateResponse = { workspace: SlackWorkspace };

export const SLACK_RULES_MAX_CHARS = 6000;
export const SLACK_MEMORY_MAX_CHARS = 6000;

/** `POST slackGithubPath(teamId, "connect")` → the GitHub URL to open. */
export type SlackGithubConnectRequest = {
  /** Where GitHub returns; must be on the site's origin. */
  returnTo: string;
};
export type SlackGithubConnectResponse = { url: string };

/** GitHub returns to `returnTo` with `?github=<code>` to finish, or `?github_error=<message>`. */
export const SLACK_GITHUB_RESULT_PARAM = "github";
export const SLACK_GITHUB_ERROR_PARAM = "github_error";

export type SlackGithubInstallationChoice = {
  installationId: string;
  account: string;
  accountType: string;
};

/**
 * `POST slackGithubPath(teamId, "finish")`. When the GitHub user can reach
 * several installations, the first call returns `choices`; call again with one.
 */
export type SlackGithubFinishRequest = { code: string; installationId?: string };
export type SlackGithubFinishResponse =
  | { workspace: SlackWorkspace }
  | { choices: SlackGithubInstallationChoice[] };

export type SlackGithubRepoOption = {
  fullName: string;
  private: boolean;
  defaultBranch: string;
};

/** `POST slackGithubPath(teamId, "disconnect")`: which connection to remove. */
export type SlackGithubDisconnectRequest = { installationId: string };

/** `GET slackGithubPath(teamId, "repos")`: what the workspace's connections can see. */
export type SlackGithubReposResponse = { repos: SlackGithubRepoOption[]; truncated: boolean };

/** `GET slackGithubPath(teamId, "branches")?repo=owner/name`. */
export type SlackGithubBranchesResponse = {
  branches: string[];
  defaultBranch: string;
  truncated: boolean;
};

/** After an install from the page, Slack's callback returns to `returnTo` with these. */
export const SLACK_INSTALL_RESULT_PARAM = "slack";
export type SlackInstallResult = "installed" | "canceled" | "failed";
