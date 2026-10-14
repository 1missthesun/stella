CREATE TABLE sybil_sightings (
  kind TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  last_seen_at INTEGER NOT NULL,
  PRIMARY KEY (kind, key_hash, owner_id)
);
CREATE INDEX sybil_sightings_last_seen ON sybil_sightings (last_seen_at);

CREATE TABLE anon_allowance (
  bucket TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL
);
CREATE INDEX anon_allowance_window ON anon_allowance (window_start);

CREATE TABLE owner_risk (
  owner_id TEXT PRIMARY KEY,
  score INTEGER NOT NULL,
  status TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX owner_risk_score ON owner_risk (score DESC, updated_at DESC);
CREATE INDEX owner_risk_updated ON owner_risk (updated_at);
