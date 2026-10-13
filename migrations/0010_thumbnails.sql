-- Video preview images (og:image), copied once because IG/FB image links expire.
-- image is NULL when fetching failed; it is retried after a few days.
-- Run once on databases created before this change:
--   npx wrangler d1 execute foodmap --remote --command "CREATE TABLE IF NOT EXISTS place_thumbnails (place_id INTEGER PRIMARY KEY REFERENCES places (id) ON DELETE CASCADE, content_type TEXT, image BLOB, fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);"
CREATE TABLE IF NOT EXISTS place_thumbnails (
  place_id INTEGER PRIMARY KEY REFERENCES places (id) ON DELETE CASCADE,
  content_type TEXT,
  image BLOB,
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
