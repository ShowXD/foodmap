-- places.hand_edited: a person edited the name, address, area or dishes, so garble detection and AI
-- re-analysis leave that wording alone. settings: site-wide choices a site admin changes in the app
-- (for now the Workers AI model).
-- Run once on databases created before this change:
--   npx wrangler d1 execute foodmap --remote --command "ALTER TABLE places ADD COLUMN hand_edited INTEGER NOT NULL DEFAULT 0; CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);"
ALTER TABLE places ADD COLUMN hand_edited INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
