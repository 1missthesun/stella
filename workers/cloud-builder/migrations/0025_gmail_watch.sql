-- Which owners watch a Gmail address, so a Gmail push notification (which
-- names only the address) reaches the right owner stores.
CREATE TABLE gmail_watch (
  address TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (address, owner_id)
);
