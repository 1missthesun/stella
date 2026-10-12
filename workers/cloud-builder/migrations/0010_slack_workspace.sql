-- Slack Stella is the workspace's shared assistant, not each requester's own.
-- The Stella account of whoever installed the app owns the workspace's home
-- (its Drive folder, notes and billing); `home_folder` is that home's Drive
-- path, fixed the first time it is used so a workspace rename keeps its notes.
ALTER TABLE slack_installations ADD COLUMN owner_id TEXT;
ALTER TABLE slack_installations ADD COLUMN home_folder TEXT;

UPDATE slack_installations SET owner_id = (
  SELECT owner_id FROM slack_identities
  WHERE slack_identities.team_id = slack_installations.team_id
    AND slack_identities.slack_user_id = slack_installations.installed_by
);

CREATE INDEX slack_installations_owner ON slack_installations (owner_id);
