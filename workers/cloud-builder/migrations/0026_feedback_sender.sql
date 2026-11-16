-- Who sent each in-app feedback message and whether it reached the team's inbox.
ALTER TABLE feedback ADD COLUMN owner_id TEXT;
ALTER TABLE feedback ADD COLUMN account_email TEXT;
ALTER TABLE feedback ADD COLUMN contact TEXT;
ALTER TABLE feedback ADD COLUMN ip_hash TEXT;
ALTER TABLE feedback ADD COLUMN notified_at INTEGER;
ALTER TABLE feedback ADD COLUMN notify_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE feedback ADD COLUMN notify_error TEXT;

CREATE INDEX feedback_owner ON feedback (owner_id, created_at);
CREATE INDEX feedback_ip ON feedback (ip_hash, created_at);
CREATE INDEX feedback_unnotified ON feedback (created_at) WHERE notified_at IS NULL;
