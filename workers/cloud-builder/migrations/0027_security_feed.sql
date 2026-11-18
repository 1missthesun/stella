-- Stella Security's shared news read: one row, rebuilt every few hours for everyone.
CREATE TABLE security_feed (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  checked_at INTEGER NOT NULL,
  lease_until INTEGER
);
