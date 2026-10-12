-- Allow several shops per video URL: drop UNIQUE(url) from an existing places table.
-- SQLite cannot drop a constraint in place, so rebuild the table and keep all rows.
-- Run once on databases created before this change:
--   npx wrangler d1 execute foodmap --remote --file=./migrations/0002_multi_place.sql
CREATE TABLE places_new (
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL,
  caption TEXT,
  name TEXT,
  dishes TEXT,
  area TEXT,
  address TEXT,
  tags TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'visited')),
  source TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO places_new (id, url, caption, name, dishes, area, address, tags, note, status, source, created_at)
SELECT id, url, caption, name, dishes, area, address, tags, note, status, source, created_at FROM places;

DROP TABLE places;
ALTER TABLE places_new RENAME TO places;
CREATE INDEX IF NOT EXISTS places_url ON places (url);
