-- Stella Crew: any number of repositories per Slack workspace, each with its
-- own environment, preview settings and rules (`src/slack/repos.ts`).
-- A workspace's single repository (0011/0013) becomes its first row here,
-- with its environment, secrets and preview settings, so nothing is set up
-- again. The old columns on slack_workspace_settings are left in place and
-- no longer read.

CREATE TABLE slack_repos (
  team_id TEXT NOT NULL,
  id TEXT NOT NULL,
  full_name TEXT NOT NULL,
  branch TEXT NOT NULL DEFAULT '',
  token_enc TEXT,
  rules TEXT NOT NULL DEFAULT '',
  preview_access TEXT,
  preview_ttl_days INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, id)
);
CREATE UNIQUE INDEX slack_repos_name ON slack_repos (team_id, full_name COLLATE NOCASE);

INSERT INTO slack_repos (team_id, id, full_name, branch, token_enc, rules, preview_access, preview_ttl_days, created_at, updated_at)
SELECT s.team_id, 'r' || lower(hex(randomblob(6))), s.repo_full_name, COALESCE(s.repo_branch, ''), s.repo_token_enc, '',
       p.access, p.ttl_days, s.updated_at, s.updated_at
FROM slack_workspace_settings s
LEFT JOIN slack_preview_settings p ON p.team_id = s.team_id
WHERE s.repo_full_name IS NOT NULL AND s.repo_full_name != '';

CREATE TABLE slack_github_connections (
  team_id TEXT NOT NULL,
  installation_id TEXT NOT NULL,
  account TEXT NOT NULL,
  account_type TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, installation_id)
);
CREATE INDEX slack_github_connections_installation ON slack_github_connections (installation_id);

INSERT INTO slack_github_connections (team_id, installation_id, account, account_type, status, created_at)
SELECT team_id, github_installation_id, COALESCE(github_account, ''), COALESCE(github_account_type, ''),
       COALESCE(github_status, 'active'), updated_at
FROM slack_workspace_settings
WHERE github_installation_id IS NOT NULL;

CREATE TABLE slack_environments_v2 (
  team_id TEXT NOT NULL,
  repo_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  network TEXT NOT NULL,
  allowed_hosts TEXT NOT NULL DEFAULT '[]',
  setup_script TEXT NOT NULL DEFAULT '',
  env_vars TEXT NOT NULL DEFAULT '',
  setup_status TEXT,
  setup_exit_code INTEGER,
  setup_at INTEGER,
  setup_ms INTEGER,
  setup_log TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, repo_id)
);

INSERT INTO slack_environments_v2 (team_id, repo_id, name, network, allowed_hosts, setup_script, env_vars,
  setup_status, setup_exit_code, setup_at, setup_ms, setup_log, updated_at)
SELECT e.team_id, COALESCE((SELECT r.id FROM slack_repos r WHERE r.team_id = e.team_id LIMIT 1), ''),
       e.name, e.network, e.allowed_hosts, e.setup_script, e.env_vars,
       e.setup_status, e.setup_exit_code, e.setup_at, e.setup_ms, e.setup_log, e.updated_at
FROM slack_environments e;

DROP TABLE slack_environments;
ALTER TABLE slack_environments_v2 RENAME TO slack_environments;

ALTER TABLE slack_environment_secrets ADD COLUMN repo_id TEXT NOT NULL DEFAULT '';
UPDATE slack_environment_secrets
SET repo_id = COALESCE((SELECT r.id FROM slack_repos r WHERE r.team_id = slack_environment_secrets.team_id LIMIT 1), '');
CREATE INDEX slack_environment_secrets_repo ON slack_environment_secrets (team_id, repo_id);

CREATE TABLE slack_conversation_repos (
  conversation_id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  set_at INTEGER NOT NULL
);
CREATE INDEX slack_conversation_repos_team ON slack_conversation_repos (team_id);

CREATE TABLE slack_channel_repos (
  team_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  channel_name TEXT NOT NULL DEFAULT '',
  set_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, channel_id)
);
CREATE INDEX slack_channel_repos_repo ON slack_channel_repos (team_id, repo_id);
