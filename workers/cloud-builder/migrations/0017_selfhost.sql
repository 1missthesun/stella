CREATE TABLE selfhost_server (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  server_id TEXT NOT NULL,
  name TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE device_pairings (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  device_name TEXT,
  platform TEXT,
  session_id TEXT,
  claimed_at INTEGER
);
CREATE INDEX device_pairings_expiry ON device_pairings (expires_at);

CREATE TABLE device_pairing_rate (
  key TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL
);
