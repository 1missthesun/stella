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
};

export type SlackWorkspaceRepo = {
  /** `owner/name` on github.com. */
  fullName: string;
  /** Empty means the repository's default branch. */
  branch: string;
  /**
   * How agents get it: through the workspace's GitHub connection, as a
   * public repository, or with an access token pasted before GitHub
   * connections existed (kept until the owner picks a repository again).
   */
  access: "github" | "public" | "token";
};

/**
 * The workspace's connection to GitHub through the "Stella for Slack" App.
 * `revoked` means the App was uninstalled or lost access: reconnect.
 */
export type SlackWorkspaceGithub = {
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
  github: SlackWorkspaceGithub | null;
  repo: SlackWorkspaceRepo | null;
  previews: SlackWorkspacePreviews;
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
 * `repo: null` disconnects the repository. A repository is reached through
 * the workspace's GitHub connection when it can see it, else as public.
 */
export type SlackWorkspaceUpdate = {
  engine?: SlackWorkspaceEngine;
  model?: string;
  effort?: ReasoningEffortLevel;
  slackCommands?: boolean;
  repo?: { fullName: string; branch?: string } | null;
  previews?: { access?: SlackPreviewAccess; ttlDays?: number };
  rules?: string;
  memory?: string;
};

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

/** `GET slackGithubPath(teamId, "repos")`: what the connection can see. */
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
