-- Map location per place. Google's terms allow keeping the place ID forever but lat/lng for at
-- most 30 days, so Google-sourced coordinates carry a fetch time and get refreshed; positions a
-- person dragged by hand are their own data (location_source = 'manual') and never expire.
-- Run once on databases created before this change:
--   npx wrangler d1 execute foodmap --remote --file=./migrations/0008_location.sql
ALTER TABLE places ADD COLUMN google_place_id TEXT;
ALTER TABLE places ADD COLUMN lat REAL;
ALTER TABLE places ADD COLUMN lng REAL;
ALTER TABLE places ADD COLUMN location_source TEXT CHECK (location_source IN ('google', 'manual'));
ALTER TABLE places ADD COLUMN location_fetched_at TEXT;
