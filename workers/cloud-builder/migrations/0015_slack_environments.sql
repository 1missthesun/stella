CREATE TABLE slack_environments (
  team_id TEXT PRIMARY KEY,
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
  updated_at INTEGER NOT NULL
);

CREATE TABLE slack_environment_secrets (
  team_id TEXT NOT NULL,
  id TEXT NOT NULL,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  header TEXT NOT NULL,
  value_enc TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (team_id, id)
);
