CREATE TABLE model_prices (
  model TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_provider TEXT NOT NULL,
  source_model_id TEXT NOT NULL,
  input_per_million_usd REAL NOT NULL,
  output_per_million_usd REAL NOT NULL,
  cache_read_per_million_usd REAL NOT NULL,
  cache_write_per_million_usd REAL NOT NULL,
  reasoning_per_million_usd REAL NOT NULL,
  modalities_input TEXT NOT NULL,
  modalities_output TEXT NOT NULL,
  source_updated_at TEXT NOT NULL,
  synced_at INTEGER NOT NULL
);

CREATE TABLE x_bot_runs (
  mention_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  mention_json TEXT NOT NULL,
  author_id TEXT NOT NULL,
  parent_id TEXT NOT NULL,
  summoner_username TEXT NOT NULL,
  handle TEXT,
  handle_display TEXT,
  poster_username TEXT,
  reply_id TEXT,
  headline TEXT,
  reply TEXT,
  exchanges_json TEXT,
  image_key TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX x_bot_runs_by_handle ON x_bot_runs (handle, created_at);
CREATE INDEX x_bot_runs_by_author ON x_bot_runs (author_id, created_at);
CREATE INDEX x_bot_runs_by_created ON x_bot_runs (created_at);
CREATE INDEX x_bot_runs_by_status ON x_bot_runs (status, updated_at);
