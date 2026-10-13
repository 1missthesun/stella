/**
 * Stella for Slack settings (migrations/0011): engine, model and effort for
 * the workspace's turns, whether `/stella` may change them, and the GitHub
 * repository agents start with. The owner edits them on stella.sh; Slack
 * commands edit the first three when the owner allows it.
 */

import type { CloudExecutionSelection } from "@stella/contracts/agent-engine";
import {
  DEFAULT_REASONING_EFFORT,
  REASONING_EFFORT_LEVELS,
  type ReasoningEffortLevel,
} from "@stella/contracts/reasoning-effort";
import type {
  SlackWorkspaceEngine,
  SlackWorkspaceModelOption,
  SlackWorkspaceOptions,
} from "@stella/contracts/slack-workspace";
import type { ManagedModelAudience } from "@stella/contracts/gateway/capability";
import { STELLA_DEFAULT_MODEL } from "@stella/contracts/stella-api";
import { listStellaCatalogModels } from "@stella/model-catalog/aliases";
import { decryptToken } from "./crypto.js";

const d1 = (env: Cloudflare.Env): D1Database => {
  if (!env.DB) throw new Error("The DB binding is missing.");
  return env.DB;
};

export const CLAUDE_CODE_DEFAULT_MODEL = "default";

const CLAUDE_CODE_MODELS: SlackWorkspaceModelOption[] = [
  { id: CLAUDE_CODE_DEFAULT_MODEL, label: "Claude Code default" },
  { id: "opus", label: "Opus" },
  { id: "sonnet", label: "Sonnet" },
  { id: "haiku", label: "Haiku" },
];

export const ENGINE_LABELS: Record<SlackWorkspaceEngine, string> = {
  stella: "Stella",
  "claude-code": "Claude Code",
};

export type SlackGithubStatus = "active" | "suspended" | "revoked";

export type SlackGithubConnection = {
  installationId: string;
  account: string;
  accountType: string;
  status: SlackGithubStatus;
};

export type SlackRepoSettings = {
  teamId: string;
  fullName: string;
  branch: string;
  /** A token pasted before GitHub connections existed. */
  legacyToken: string | null;
  github: SlackGithubConnection | null;
};

export type SlackWorkspaceSettings = {
  teamId: string;
  engine: SlackWorkspaceEngine;
  model: string;
  effort: ReasoningEffortLevel;
  slackCommands: boolean;
  github: SlackGithubConnection | null;
  repo: { fullName: string; branch: string; hasToken: boolean } | null;
};

type SettingsRow = {
  team_id: string;
  engine: string;
  model: string;
  effort: string;
  slack_commands: number;
  repo_full_name: string | null;
  repo_branch: string | null;
  repo_token_enc: string | null;
  github_installation_id: string | null;
  github_account: string | null;
  github_account_type: string | null;
  github_status: string | null;
};

const isGithubStatus = (value: unknown): value is SlackGithubStatus =>
  value === "active" || value === "suspended" || value === "revoked";

const githubFromRow = (row: Pick<
  SettingsRow,
  "github_installation_id" | "github_account" | "github_account_type" | "github_status"
>): SlackGithubConnection | null =>
  row.github_installation_id
    ? {
        installationId: row.github_installation_id,
        account: row.github_account ?? "",
        accountType: row.github_account_type ?? "",
        status: isGithubStatus(row.github_status) ? row.github_status : "active",
      }
    : null;

/** Whether the connection's account owns `fullName`, so the App can mint for it. */
export const repoOwnedBy = (github: SlackGithubConnection | null, fullName: string): boolean =>
  Boolean(github?.account) &&
  fullName.split("/")[0]!.toLowerCase() === github!.account.toLowerCase();

const defaults = (teamId: string): SlackWorkspaceSettings => ({
  teamId,
  engine: "stella",
  model: STELLA_DEFAULT_MODEL,
  effort: DEFAULT_REASONING_EFFORT,
  slackCommands: true,
  github: null,
  repo: null,
});

const isEngine = (value: unknown): value is SlackWorkspaceEngine =>
  value === "stella" || value === "claude-code";

export const isEffort = (value: unknown): value is ReasoningEffortLevel =>
  typeof value === "string" &&
  (REASONING_EFFORT_LEVELS as readonly string[]).includes(value);

const fromRow = (row: SettingsRow): SlackWorkspaceSettings => ({
  teamId: row.team_id,
  engine: isEngine(row.engine) ? row.engine : "stella",
  model: row.model || STELLA_DEFAULT_MODEL,
  effort: isEffort(row.effort) ? row.effort : DEFAULT_REASONING_EFFORT,
  slackCommands: row.slack_commands !== 0,
  github: githubFromRow(row),
  repo: row.repo_full_name
    ? {
        fullName: row.repo_full_name,
        branch: row.repo_branch ?? "",
        hasToken: Boolean(row.repo_token_enc),
      }
    : null,
});

export const loadWorkspaceSettings = async (
  env: Cloudflare.Env,
  teamId: string,
): Promise<SlackWorkspaceSettings> => {
  const row = await d1(env)
    .prepare("SELECT * FROM slack_workspace_settings WHERE team_id = ?")
    .bind(teamId)
    .first<SettingsRow>();
  return row ? fromRow(row) : defaults(teamId);
};

export type SettingsPatch = {
  engine?: SlackWorkspaceEngine;
  model?: string;
  effort?: ReasoningEffortLevel;
  slackCommands?: boolean;
  /** `dropToken` forgets a pasted token; a changed repository always does. */
  repo?: { fullName: string; branch: string; dropToken?: boolean } | null;
  github?: SlackGithubConnection | null;
};

export const saveWorkspaceSettings = async (
  env: Cloudflare.Env,
  teamId: string,
  patch: SettingsPatch,
): Promise<SlackWorkspaceSettings> => {
  const row = await d1(env)
    .prepare("SELECT * FROM slack_workspace_settings WHERE team_id = ?")
    .bind(teamId)
    .first<SettingsRow>();
  const current = row ? fromRow(row) : defaults(teamId);
  const engine = patch.engine ?? current.engine;
  const engineChanged = patch.engine !== undefined && patch.engine !== current.engine;
  const model =
    patch.model ??
    (engineChanged
      ? engine === "claude-code"
        ? CLAUDE_CODE_DEFAULT_MODEL
        : STELLA_DEFAULT_MODEL
      : current.model);
  let repoName = row?.repo_full_name ?? null;
  let repoBranch = row?.repo_branch ?? null;
  let repoToken = row?.repo_token_enc ?? null;
  if (patch.repo === null) {
    repoName = null;
    repoBranch = null;
    repoToken = null;
  } else if (patch.repo) {
    if (patch.repo.fullName !== repoName || patch.repo.dropToken) repoToken = null;
    repoName = patch.repo.fullName;
    repoBranch = patch.repo.branch;
  }
  const github = patch.github === undefined ? current.github : patch.github;
  await d1(env)
    .prepare(
      `INSERT INTO slack_workspace_settings
         (team_id, engine, model, effort, slack_commands, repo_full_name, repo_branch, repo_token_enc,
          github_installation_id, github_account, github_account_type, github_status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (team_id) DO UPDATE SET
         engine = excluded.engine, model = excluded.model, effort = excluded.effort,
         slack_commands = excluded.slack_commands, repo_full_name = excluded.repo_full_name,
         repo_branch = excluded.repo_branch, repo_token_enc = excluded.repo_token_enc,
         github_installation_id = excluded.github_installation_id, github_account = excluded.github_account,
         github_account_type = excluded.github_account_type, github_status = excluded.github_status,
         updated_at = excluded.updated_at`,
    )
    .bind(
      teamId,
      engine,
      model,
      patch.effort ?? current.effort,
      (patch.slackCommands ?? current.slackCommands) ? 1 : 0,
      repoName,
      repoBranch,
      repoToken,
      github?.installationId ?? null,
      github?.account ?? null,
      github?.accountType ?? null,
      github?.status ?? null,
      Date.now(),
    )
    .run();
  return await loadWorkspaceSettings(env, teamId);
};

export const deleteWorkspaceSettings = async (
  env: Cloudflare.Env,
  teamId: string,
): Promise<void> => {
  await d1(env)
    .prepare("DELETE FROM slack_workspace_settings WHERE team_id = ?")
    .bind(teamId)
    .run();
};

/** The repository a Slack conversation's agents start with, with how to reach it. */
export const repoForConversation = async (
  env: Cloudflare.Env,
  conversationId: string,
): Promise<SlackRepoSettings | null> => {
  const row = await d1(env)
    .prepare(
      `SELECT s.team_id, s.repo_full_name, s.repo_branch, s.repo_token_enc, s.github_installation_id,
              s.github_account, s.github_account_type, s.github_status
       FROM slack_threads t JOIN slack_workspace_settings s ON s.team_id = t.team_id
       WHERE t.conversation_id = ? AND s.repo_full_name IS NOT NULL LIMIT 1`,
    )
    .bind(conversationId)
    .first<
      Pick<
        SettingsRow,
        | "team_id"
        | "repo_branch"
        | "repo_token_enc"
        | "github_installation_id"
        | "github_account"
        | "github_account_type"
        | "github_status"
      > & { repo_full_name: string }
    >();
  if (!row) return null;
  return {
    teamId: row.team_id,
    fullName: row.repo_full_name,
    branch: row.repo_branch ?? "",
    legacyToken: row.repo_token_enc
      ? await decryptToken(env, row.repo_token_enc).catch(() => null)
      : null,
    github: githubFromRow(row),
  };
};

/** Record what GitHub said about an installation on every workspace using it. */
export const setGithubStatus = async (
  env: Cloudflare.Env,
  installationId: string,
  status: SlackGithubStatus,
): Promise<number> => {
  const result = await d1(env)
    .prepare(
      "UPDATE slack_workspace_settings SET github_status = ?, updated_at = ? WHERE github_installation_id = ? AND github_status IS NOT ?",
    )
    .bind(status, Date.now(), installationId, status)
    .run();
  return result.meta.changes ?? 0;
};

/** The execution a workspace's turns run on. */
export const workspaceExecution = (
  settings: SlackWorkspaceSettings,
): CloudExecutionSelection =>
  settings.engine === "claude-code"
    ? {
        engine: "anthropic",
        provider: "anthropic",
        model: settings.model || CLAUDE_CODE_DEFAULT_MODEL,
        reasoningEffort: settings.effort,
      }
    : {
        engine: "stella",
        provider: "stella",
        model: settings.model || STELLA_DEFAULT_MODEL,
        reasoningEffort: settings.effort,
      };

export const stellaModelOptions = (
  audience: ManagedModelAudience,
): SlackWorkspaceModelOption[] => {
  const options: SlackWorkspaceModelOption[] = [
    { id: STELLA_DEFAULT_MODEL, label: "Stella default" },
  ];
  for (const model of listStellaCatalogModels(audience)) {
    if (model.type !== "language" || !model.allowedForAudience) continue;
    if (options.some((option) => option.id === model.id)) continue;
    options.push({ id: model.id, label: model.name });
  }
  return options;
};

export const workspaceOptions = (
  audience: ManagedModelAudience,
): SlackWorkspaceOptions => ({
  engines: [
    {
      id: "stella",
      label: ENGINE_LABELS.stella,
      detail: "Stella's own runtime on Stella's models, billed to your plan.",
    },
    {
      id: "claude-code",
      label: ENGINE_LABELS["claude-code"],
      detail:
        "Claude Code on your own Claude login in Stella's cloud. Sign in to Claude in the Stella app first.",
    },
  ],
  models: {
    stella: stellaModelOptions(audience),
    "claude-code": CLAUDE_CODE_MODELS,
  },
  efforts: [...REASONING_EFFORT_LEVELS],
});

/** A model id the engine accepts: a listed one, or any `stella/…` id for Stella. */
export const resolveModelChoice = (
  engine: SlackWorkspaceEngine,
  requested: string,
  audience: ManagedModelAudience,
): string | null => {
  const wanted = requested.trim().toLowerCase();
  if (!wanted) return null;
  const options =
    engine === "claude-code" ? CLAUDE_CODE_MODELS : stellaModelOptions(audience);
  const exact = options.find(
    (option) =>
      option.id.toLowerCase() === wanted ||
      option.label.toLowerCase() === wanted,
  );
  if (exact) return exact.id;
  const partial = options.filter(
    (option) =>
      option.id.toLowerCase().includes(wanted) ||
      option.label.toLowerCase().includes(wanted),
  );
  return partial.length === 1 ? partial[0]!.id : null;
};

const REPO_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/u;

/** `owner/name`, or a github.com URL of one. */
export const parseRepoName = (value: string): string | null => {
  const trimmed = value
    .trim()
    .replace(/^https?:\/\/(?:www\.)?github\.com\//iu, "")
    .replace(/^git@github\.com:/iu, "")
    .replace(/\.git$/iu, "")
    .replace(/\/+$/u, "");
  return REPO_PATTERN.test(trimmed) ? trimmed : null;
};

const BRANCH_PATTERN = /^[A-Za-z0-9._/-]{0,200}$/u;

export const parseBranch = (value: string | undefined): string | null => {
  const trimmed = (value ?? "").trim();
  if (!BRANCH_PATTERN.test(trimmed) || trimmed.includes("..")) return null;
  return trimmed;
};
