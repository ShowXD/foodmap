-- Account linking: extra sign-in emails that belong to the same person (users.email stays the main one),
-- and short-lived link requests (only a hash of the token is stored).
-- Run once on databases created before this change (one statement per --command if --file fails with an auth error):
--   npx wrangler d1 execute foodmap --remote --file=./migrations/0013_identities.sql
CREATE TABLE IF NOT EXISTS user_identities (
  email TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS link_requests (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
