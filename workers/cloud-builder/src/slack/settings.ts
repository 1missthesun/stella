import { deleteEnvironment, LIMITED_HOSTS } from "./environment.js";
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
import { deleteWorkspaceRepos } from "./repos.js";

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

export type SlackWorkspaceSettings = {
  teamId: string;
  engine: SlackWorkspaceEngine;
  model: string;
  effort: ReasoningEffortLevel;
  slackCommands: boolean;
};

type SettingsRow = {
  team_id: string;
  engine: string;
  model: string;
  effort: string;
  slack_commands: number;
};

const defaults = (teamId: string): SlackWorkspaceSettings => ({
  teamId,
  engine: "stella",
  model: STELLA_DEFAULT_MODEL,
  effort: DEFAULT_REASONING_EFFORT,
  slackCommands: true,
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
};

export const saveWorkspaceSettings = async (
  env: Cloudflare.Env,
  teamId: string,
  patch: SettingsPatch,
): Promise<SlackWorkspaceSettings> => {
  const current = await loadWorkspaceSettings(env, teamId);
  const engine = patch.engine ?? current.engine;
  const engineChanged = patch.engine !== undefined && patch.engine !== current.engine;
  const model =
    patch.model ??
    (engineChanged
      ? engine === "claude-code"
        ? CLAUDE_CODE_DEFAULT_MODEL
        : STELLA_DEFAULT_MODEL
      : current.model);
  await d1(env)
    .prepare(
      `INSERT INTO slack_workspace_settings (team_id, engine, model, effort, slack_commands, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (team_id) DO UPDATE SET
         engine = excluded.engine, model = excluded.model, effort = excluded.effort,
         slack_commands = excluded.slack_commands, updated_at = excluded.updated_at`,
    )
    .bind(
      teamId,
      engine,
      model,
      patch.effort ?? current.effort,
      (patch.slackCommands ?? current.slackCommands) ? 1 : 0,
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
  await deleteEnvironment(env, teamId);
  await deleteWorkspaceRepos(env, teamId);
};

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
  limitedHosts: [...LIMITED_HOSTS],
});

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
