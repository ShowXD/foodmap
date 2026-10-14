-- LINE links saved while the day's AI limit was used up are analysed later, when someone opens the list.
-- The UPDATE marks links already saved that way (no shop name, but the post text was kept).
-- Run once on databases created before this change:
--   npx wrangler d1 execute foodmap --remote --command "ALTER TABLE places ADD COLUMN ai_pending INTEGER NOT NULL DEFAULT 0; UPDATE places SET ai_pending = 1 WHERE source = 'line' AND COALESCE(name, '') = '' AND COALESCE(caption, '') <> '';"
ALTER TABLE places ADD COLUMN ai_pending INTEGER NOT NULL DEFAULT 0;
UPDATE places SET ai_pending = 1 WHERE source = 'line' AND COALESCE(name, '') = '' AND COALESCE(caption, '') <> '';
