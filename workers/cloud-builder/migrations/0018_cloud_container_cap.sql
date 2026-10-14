CREATE TABLE cloud_container_runs (
  sandbox TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);

CREATE TABLE cloud_container_months (
  month TEXT PRIMARY KEY,
  seconds INTEGER NOT NULL
);
