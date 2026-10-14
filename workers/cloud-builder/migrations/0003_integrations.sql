-- `json` is the integration record: id, name, provider, category, auth,
-- catalogToolCount, actionCount, description, sourceUrl, iconUrl, connector
-- ({type:"composio", toolkit, provider}), enabled, usagePolicy.
CREATE TABLE integration_catalog (
  slug TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX integration_catalog_by_updated ON integration_catalog (updated_at DESC);

CREATE TABLE integration_actions (
  slug TEXT NOT NULL,
  action TEXT NOT NULL,
  json TEXT NOT NULL,
  search_text TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (slug, action)
);
