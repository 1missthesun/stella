-- Stella for Slack: each workspace's environment, what every agent container
-- started from Slack runs with (`src/slack/environment.ts`). A workspace with
-- no row has the default: full network access, nothing else.
-- `network` is 'none', 'limited' or 'full'; `allowed_hosts` is a JSON array.
-- `env_vars` is `.env` text and not secret. The last setup run is kept so the
-- settings page can show its log.
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

-- Network secrets: the value is sealed (AES-GCM, `crypto.ts`) and only ever
-- decrypted by the container's egress proxy, which sets `header` to it on
-- HTTPS requests to `host`.
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
