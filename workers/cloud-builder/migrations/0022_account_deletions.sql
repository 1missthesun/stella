-- Queued hosted-account deletions (src/auth/account-deletion.ts). A row is the
-- recorded request; the hourly cron cancels it on a newer sign-in, otherwise
-- purges the account after due_at and clears the email once it is done.
CREATE TABLE account_deletions (
  user_id TEXT PRIMARY KEY,
  email TEXT,
  status TEXT NOT NULL,
  requested_at INTEGER NOT NULL,
  due_at INTEGER NOT NULL,
  confirmation_sent_at INTEGER,
  started_at INTEGER,
  owner_closed_at INTEGER,
  completed_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

CREATE INDEX account_deletions_status_due ON account_deletions (status, due_at);
