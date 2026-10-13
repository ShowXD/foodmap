-- Personal display name and photo. Photos live in their own table because the middleware loads
-- the users row on every request.
-- Run once on databases created before this change (if --file fails with an auth error, run each statement with --command):
--   npx wrangler d1 execute foodmap --remote --file=./migrations/0011_profile.sql
ALTER TABLE users ADD COLUMN display_name TEXT;
CREATE TABLE IF NOT EXISTS user_avatars (
  user_id INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  image BLOB NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
