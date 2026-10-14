-- Group invite links (/?join=CODE): one person each, valid 7 days, revocable. Only a hash of the code is stored.
-- Run once on databases created before this change:
--   npx wrangler d1 execute foodmap --remote --command "CREATE TABLE IF NOT EXISTS group_invites (id INTEGER PRIMARY KEY, code_hash TEXT NOT NULL UNIQUE, list_id INTEGER NOT NULL REFERENCES lists (id) ON DELETE CASCADE, created_by INTEGER REFERENCES users (id) ON DELETE SET NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at TEXT NOT NULL);"
CREATE TABLE IF NOT EXISTS group_invites (
  id INTEGER PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  list_id INTEGER NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL
);
