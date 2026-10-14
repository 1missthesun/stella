ALTER TABLE slack_installations ADD COLUMN owner_id TEXT;
ALTER TABLE slack_installations ADD COLUMN home_folder TEXT;

UPDATE slack_installations SET owner_id = (
  SELECT owner_id FROM slack_identities
  WHERE slack_identities.team_id = slack_installations.team_id
    AND slack_identities.slack_user_id = slack_installations.installed_by
);

CREATE INDEX slack_installations_owner ON slack_installations (owner_id);
