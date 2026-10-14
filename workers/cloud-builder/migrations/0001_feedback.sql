CREATE TABLE feedback (
  id TEXT PRIMARY KEY,
  message TEXT NOT NULL,
  app_version TEXT,
  platform TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX feedback_created_at ON feedback (created_at);
