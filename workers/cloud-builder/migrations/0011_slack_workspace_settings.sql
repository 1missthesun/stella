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
