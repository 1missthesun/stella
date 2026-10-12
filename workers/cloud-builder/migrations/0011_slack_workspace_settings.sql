-- Stella for Slack: what the workspace owner sets on stella.sh. Engine, model
-- and effort pick how Stella runs in the workspace; `slack_commands` lets
-- people in Slack change them with `/stella`. The GitHub repository is cloned
-- into every agent container Stella starts for the workspace; its optional
-- read-only token is sealed like the bot token. Rules and notes live in the
-- owner's Drive under the workspace's home folder, not here.
CREATE TABLE slack_workspace_settings (
  team_id TEXT PRIMARY KEY,
  engine TEXT NOT NULL DEFAULT 'stella',
  model TEXT NOT NULL DEFAULT 'stella/default',
  effort TEXT NOT NULL DEFAULT 'medium',
  slack_commands INTEGER NOT NULL DEFAULT 1,
  repo_full_name TEXT,
  repo_branch TEXT,
  repo_token_enc TEXT,
  updated_at INTEGER NOT NULL
);
