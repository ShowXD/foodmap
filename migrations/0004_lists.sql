-- Personal lists + group lists; existing places move into a "家人" group.
-- Open registration replaces admin approval, so pending users become approved.
-- Run once on databases created before this change (after 0002 and 0003):
--   npx wrangler d1 execute foodmap --remote --file=./migrations/0004_lists.sql
-- Then add family members to "家人" from the admin page.
CREATE TABLE IF NOT EXISTS lists (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  owner_user_id INTEGER REFERENCES users (id),
  is_personal INTEGER NOT NULL DEFAULT 0 CHECK (is_personal IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS lists_personal_owner ON lists (owner_user_id) WHERE is_personal = 1;

CREATE TABLE IF NOT EXISTS list_members (
  list_id INTEGER NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  is_owner INTEGER NOT NULL DEFAULT 0 CHECK (is_owner IN (0, 1)),
  PRIMARY KEY (list_id, user_id)
);

ALTER TABLE places ADD COLUMN list_id INTEGER REFERENCES lists (id);
ALTER TABLE places ADD COLUMN created_by INTEGER REFERENCES users (id);
CREATE INDEX IF NOT EXISTS places_list ON places (list_id);

INSERT INTO lists (name, is_personal) VALUES ('家人', 0);
UPDATE places SET list_id = (SELECT MAX(id) FROM lists WHERE name = '家人' AND is_personal = 0) WHERE list_id IS NULL;

UPDATE users SET status = 'approved' WHERE status = 'pending';
