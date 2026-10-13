-- Sharing with friends: per-person daily limits on paid/limited APIs, and one-time codes that let a
-- group owner bind their own LINE group.
-- Run once on databases created before this change (one statement per --command if --file fails with an auth error):
--   npx wrangler d1 execute foodmap --remote --file=./migrations/0012_friends.sql
CREATE TABLE IF NOT EXISTS user_daily_usage (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  api TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, api, day)
);
CREATE TABLE IF NOT EXISTS line_bind_codes (
  code TEXT PRIMARY KEY,
  list_id INTEGER NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
  expires_at TEXT NOT NULL
);
