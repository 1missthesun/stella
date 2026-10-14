-- Reusable pairing codes for app review demos (STELLA_REVIEW_PAIRING=1 only):
-- claimed many times until they expire or are canceled; each claim's session
-- is kept so canceling signs every reviewer device out.
ALTER TABLE device_pairings ADD COLUMN reusable INTEGER NOT NULL DEFAULT 0;
ALTER TABLE device_pairings ADD COLUMN uses INTEGER NOT NULL DEFAULT 0;
CREATE TABLE device_pairing_sessions (
  pairing_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (pairing_id, session_id)
);
