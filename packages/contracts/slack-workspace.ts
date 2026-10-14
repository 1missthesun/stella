import type { ReasoningEffortLevel } from "./reasoning-effort.js";

export const SLACK_WORKSPACES_PATH = "/api/slack/workspaces";
export const SLACK_INSTALL_START_PATH = "/api/slack/install/start";

export const slackWorkspacePath = (teamId: string): string =>
  `${SLACK_WORKSPACES_PATH}/${encodeURIComponent(teamId)}`;

export type SlackGithubAction = "connect" | "finish" | "disconnect" | "repos" | "branches";

export const slackReposPath = (teamId: string): string => `${slackWorkspacePath(teamId)}/repos`;

export const slackRepoPath = (teamId: string, repoId: string): string =>
  `${slackReposPath(teamId)}/${encodeURIComponent(repoId)}`;

export const slackGithubPath = (teamId: string, action: SlackGithubAction): string =>
  `${slackWorkspacePath(teamId)}/github/${action}`;

export type SlackWorkspaceEngine = "stella" | "claude-code";

export const SLACK_WORKSPACE_ENGINES: readonly SlackWorkspaceEngine[] = ["stella", "claude-code"];

export type SlackWorkspaceModelOption = { id: string; label: string };

export type SlackWorkspaceOptions = {
  engines: Array<{ id: SlackWorkspaceEngine; label: string; detail: string }>;
  models: Record<SlackWorkspaceEngine, SlackWorkspaceModelOption[]>;
  efforts: ReasoningEffortLevel[];
  limitedHosts: string[];
};

export type SlackWorkspaceGithub = {
  installationId: string;
  account: string;
  accountType: string;
  status: "active" | "suspended" | "revoked";
  manageUrl: string;
};

export type SlackPreviewAccess = "public" | "members";

export const SLACK_PREVIEW_ACCESS_DEFAULT: SlackPreviewAccess = "members";
export const SLACK_PREVIEW_TTL_DAYS_CHOICES = [1, 3, 7, 14, 30, 90] as const;
export const SLACK_PREVIEW_TTL_DAYS_DEFAULT = 14;

export type SlackWorkspacePreviews = {
  access: SlackPreviewAccess;
  ttlDays: number;
  usedBytes: number;
  quotaBytes: number;
  live: number;
  maxPreviewBytes: number;
};

export type SlackNetworkLevel = "none" | "limited" | "full";

export const SLACK_NETWORK_LEVELS: readonly SlackNetworkLevel[] = ["none", "limited", "full"];

export type SlackNetworkSecret = {
  id: string;
  name: string;
  host: string;
  header: string;
};

export type SlackSetupRun = {
  status: "succeeded" | "failed";
  exitCode: number | null;
  at: number;
  ms: number;
  log: string;
};

export type SlackWorkspaceEnvironment = {
  name: string;
  network: SlackNetworkLevel;
  allowedHosts: string[];
  secrets: SlackNetworkSecret[];
  setupScript: string;
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

export type SlackRepoChannel = { id: string; name: string };

export type SlackWorkspaceRepo = {
  id: string;
  fullName: string;
  branch: string;
  access: "github" | "public" | "token";
  rules: string;
  channels: SlackRepoChannel[];
  environment: SlackWorkspaceEnvironment | null;
  previews: SlackWorkspacePreviews;
};

export type SlackWorkspace = {
  teamId: string;
  teamName: string;
  homeFolder: string;
  installedAt: number;
  engine: SlackWorkspaceEngine;
  model: string;
  effort: ReasoningEffortLevel;
  slackCommands: boolean;
  githubAccounts: SlackWorkspaceGithub[];
  repos: SlackWorkspaceRepo[];
  previews: SlackWorkspacePreviews;
  environment: SlackWorkspaceEnvironment | null;
  rules: string;
  memory: string;
  slackUrl: string;
};

export type SlackWorkspacesResponse = {
  available: boolean;
  githubAvailable: boolean;
  workspaces: SlackWorkspace[];
  options: SlackWorkspaceOptions;
};

export type SlackInstallStartRequest = {
  returnTo: string;
};
export type SlackInstallStartResponse = { url: string };

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

export type SlackRepoAdd = { fullName: string; branch?: string };

export type SlackRepoAddResponse = { workspace: SlackWorkspace; repoId: string };

export type SlackRepoUpdate = {
  branch?: string;
  rules?: string;
  previews?: { access?: SlackPreviewAccess; ttlDays?: number };
  environment?: SlackWorkspaceEnvironmentUpdate;
  removeChannels?: string[];
};

export const SLACK_REPOS_MAX = 50;
export const SLACK_REPO_RULES_MAX_CHARS = 4000;

export type SlackWorkspaceUpdateResponse = { workspace: SlackWorkspace };

export const SLACK_RULES_MAX_CHARS = 6000;
export const SLACK_MEMORY_MAX_CHARS = 6000;

export type SlackGithubConnectRequest = {
  returnTo: string;
};
export type SlackGithubConnectResponse = { url: string };

export const SLACK_GITHUB_RESULT_PARAM = "github";
export const SLACK_GITHUB_ERROR_PARAM = "github_error";

export type SlackGithubInstallationChoice = {
  installationId: string;
  account: string;
  accountType: string;
};

export type SlackGithubFinishRequest = { code: string; installationId?: string };
export type SlackGithubFinishResponse =
  | { workspace: SlackWorkspace }
  | { choices: SlackGithubInstallationChoice[] };

export type SlackGithubRepoOption = {
  fullName: string;
  private: boolean;
  defaultBranch: string;
};

export type SlackGithubDisconnectRequest = { installationId: string };

export type SlackGithubReposResponse = { repos: SlackGithubRepoOption[]; truncated: boolean };

export type SlackGithubBranchesResponse = {
  branches: string[];
  defaultBranch: string;
  truncated: boolean;
};

export const SLACK_INSTALL_RESULT_PARAM = "slack";
export type SlackInstallResult = "installed" | "canceled" | "failed";
