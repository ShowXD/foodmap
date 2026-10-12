-- Per-user daily AI extraction count (day = UTC YYYY-MM-DD) to protect the shared free quota.
-- Run once on databases created before this change:
--   npx wrangler d1 execute foodmap --remote --file=./migrations/0005_extract_usage.sql
CREATE TABLE IF NOT EXISTS extract_usage (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
