CREATE TABLE IF NOT EXISTS places (
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

CREATE INDEX IF NOT EXISTS places_url ON places (url);
