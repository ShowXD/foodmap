-- Personal marks: each person's own "吃過" (+ rating/note), "想吃" stars, and list read times.
-- Run once on databases created before this change:
--   npx wrangler d1 execute foodmap --remote --file=./migrations/0007_personal.sql
CREATE TABLE IF NOT EXISTS place_visits (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  place_id INTEGER NOT NULL REFERENCES places (id) ON DELETE CASCADE,
  visited_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  note TEXT,
  PRIMARY KEY (user_id, place_id)
);

CREATE TABLE IF NOT EXISTS place_stars (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  place_id INTEGER NOT NULL REFERENCES places (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, place_id)
);

CREATE TABLE IF NOT EXISTS list_reads (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  list_id INTEGER NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
  read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, list_id)
);

-- The old shared "吃過" flag becomes the marker of whoever added the place, when known.
INSERT OR IGNORE INTO place_visits (user_id, place_id)
SELECT created_by, id FROM places WHERE status = 'visited' AND created_by IS NOT NULL;
