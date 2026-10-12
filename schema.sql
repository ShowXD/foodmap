CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'disabled')),
  is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- A list is either someone's private list (is_personal = 1, owner_user_id set)
-- or a group list whose members are in list_members.
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
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  list_id INTEGER REFERENCES lists (id),
  created_by INTEGER REFERENCES users (id)
);

-- Per-user daily AI extraction count (day = UTC YYYY-MM-DD) to protect the shared free quota.
CREATE TABLE IF NOT EXISTS extract_usage (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

CREATE INDEX IF NOT EXISTS places_url ON places (url);
CREATE INDEX IF NOT EXISTS places_list ON places (list_id);
