-- Daily call counts per outside API, shown on the admin page next to the quotas.
-- Run once on databases created before this change:
--   npx wrangler d1 execute foodmap --remote --file=./migrations/0009_api_usage.sql
CREATE TABLE IF NOT EXISTS api_usage (
  api TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (api, day)
);
