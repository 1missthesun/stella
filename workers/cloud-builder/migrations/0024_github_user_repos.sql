-- The repositories the GitHub user who connected an installation can reach,
-- with that user's permission (`src/slack/repos.ts`). NULL on connections made
-- before it was recorded: those grant nothing until reconnected.
ALTER TABLE slack_github_connections ADD COLUMN user_repos TEXT;
