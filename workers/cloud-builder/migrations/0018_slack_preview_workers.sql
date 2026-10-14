-- Stella previews of Worker apps (src/slack/preview-worker.ts) and uploads
-- in several parts. `kind` is 'static' (files only) or 'worker' (the app's
-- server code runs as a Dynamic Worker); a row is served once `ready`.
ALTER TABLE slack_previews ADD COLUMN kind TEXT NOT NULL DEFAULT 'static';
ALTER TABLE slack_previews ADD COLUMN ready INTEGER NOT NULL DEFAULT 1;
