-- Stella previews for Slack workspaces: static sites agents build and Stella
-- hosts (src/slack/previews.ts). Files live in APP_BUILDS under
-- slack-previews/<id>/; a row is the link. A link expires ttl_days (the
-- workspace's current setting) after created_at.
CREATE TABLE IF NOT EXISTS slack_previews (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  files INTEGER NOT NULL,
  spa INTEGER NOT NULL DEFAULT 1,
  repo TEXT,
  commit_sha TEXT,
  deleted_at INTEGER
);

CREATE INDEX IF NOT EXISTS slack_previews_team ON slack_previews (team_id, created_at);
CREATE INDEX IF NOT EXISTS slack_previews_created ON slack_previews (created_at) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS slack_preview_settings (
  team_id TEXT PRIMARY KEY,
  access TEXT NOT NULL,
  ttl_days INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS slack_threads_conversation ON slack_threads (conversation_id);
