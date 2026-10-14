ALTER TABLE slack_workspace_settings ADD COLUMN github_installation_id TEXT;
ALTER TABLE slack_workspace_settings ADD COLUMN github_account TEXT;
ALTER TABLE slack_workspace_settings ADD COLUMN github_account_type TEXT;
ALTER TABLE slack_workspace_settings ADD COLUMN github_status TEXT;

CREATE TABLE slack_github_connects (
  nonce TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  return_to TEXT NOT NULL,
  installations TEXT,
  expires_at INTEGER NOT NULL
);
