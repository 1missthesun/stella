-- Stella for Slack: the workspace's GitHub connection through the read-only
-- "Stella for Slack" GitHub App. Only the installation id is kept; agents get
-- a short-lived, repo-scoped, contents:read token minted when they clone.
-- `github_status` is 'active', 'suspended' or 'revoked' (uninstalled or
-- unreachable), which the settings page shows as a reconnect state.
-- `repo_token_enc` (0011) stays for workspaces that pasted a token before
-- this; it is dropped once they pick a repository through the App.
ALTER TABLE slack_workspace_settings ADD COLUMN github_installation_id TEXT;
ALTER TABLE slack_workspace_settings ADD COLUMN github_account TEXT;
ALTER TABLE slack_workspace_settings ADD COLUMN github_account_type TEXT;
ALTER TABLE slack_workspace_settings ADD COLUMN github_status TEXT;

-- A "Connect GitHub" in progress. The owner's page starts it; GitHub's
-- callback records the installations the connecting GitHub user can reach;
-- the owner's page finishes it by spending the nonce. Single use, 15 minutes.
CREATE TABLE slack_github_connects (
  nonce TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  return_to TEXT NOT NULL,
  installations TEXT,
  expires_at INTEGER NOT NULL
);
