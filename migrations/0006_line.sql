-- LINE bot: remember which message each place came from (for unsend) and which groups
-- the bot has joined. Run once on databases created before this change:
--   npx wrangler d1 execute foodmap --remote --file=./migrations/0006_line.sql
ALTER TABLE places ADD COLUMN line_message_id TEXT;
CREATE INDEX IF NOT EXISTS places_line_message ON places (line_message_id);

CREATE TABLE IF NOT EXISTS line_groups (
  group_id TEXT PRIMARY KEY,
  list_id INTEGER REFERENCES lists (id) ON DELETE SET NULL,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_message_at TEXT
);
