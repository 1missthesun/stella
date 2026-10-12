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
  /** A read-only access token is saved (it is never sent back). */
  hasToken: boolean;
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
  repo: SlackWorkspaceRepo | null;
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
 * `repo: null` disconnects the repository; `repo.token` replaces the saved
 * token, and an empty string removes it.
 */
export type SlackWorkspaceUpdate = {
  engine?: SlackWorkspaceEngine;
  model?: string;
  effort?: ReasoningEffortLevel;
  slackCommands?: boolean;
  repo?: { fullName: string; branch?: string; token?: string } | null;
  rules?: string;
  memory?: string;
};

export type SlackWorkspaceUpdateResponse = { workspace: SlackWorkspace };

export const SLACK_RULES_MAX_CHARS = 6000;
export const SLACK_MEMORY_MAX_CHARS = 6000;

/** After an install from the page, Slack's callback returns to `returnTo` with these. */
export const SLACK_INSTALL_RESULT_PARAM = "slack";
export type SlackInstallResult = "installed" | "canceled" | "failed";
