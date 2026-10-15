CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'disabled')),
  is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  display_name TEXT
);

-- Profile photos, kept out of users because the middleware loads that row on every request.
CREATE TABLE IF NOT EXISTS user_avatars (
  user_id INTEGER PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  content_type TEXT NOT NULL,
  image BLOB NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
  created_by INTEGER REFERENCES users (id),
  line_message_id TEXT,
  -- Google's terms: place ID may be kept, lat/lng from Google for at most 30 days (see migrations/0008).
  google_place_id TEXT,
  lat REAL,
  lng REAL,
  location_source TEXT CHECK (location_source IN ('google', 'manual')),
  location_fetched_at TEXT,
  -- 1 = a LINE link saved while the day's AI limit was used up; analysed later (line/webhook.js retryPendingAi).
  ai_pending INTEGER NOT NULL DEFAULT 0
);

-- LINE groups the bot has been added to. Links are only collected once a site admin
-- binds the group to a list, so a stranger adding the bot to another group gets nothing.
CREATE TABLE IF NOT EXISTS line_groups (
  group_id TEXT PRIMARY KEY,
  list_id INTEGER REFERENCES lists (id) ON DELETE SET NULL,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_message_at TEXT
);

-- Each person's own "吃過" mark, with an optional 1-5 rating and note family members can read.
CREATE TABLE IF NOT EXISTS place_visits (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  place_id INTEGER NOT NULL REFERENCES places (id) ON DELETE CASCADE,
  visited_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  note TEXT,
  PRIMARY KEY (user_id, place_id)
);

-- Personal "想吃" star.
CREATE TABLE IF NOT EXISTS place_stars (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  place_id INTEGER NOT NULL REFERENCES places (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, place_id)
);

-- When each person last opened each list, to mark places added since then as "新".
CREATE TABLE IF NOT EXISTS list_reads (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  list_id INTEGER NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
  read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, list_id)
);

-- Video preview images (og:image) copied once, since IG/FB image links expire; image NULL = fetch failed.
CREATE TABLE IF NOT EXISTS place_thumbnails (
  place_id INTEGER PRIMARY KEY REFERENCES places (id) ON DELETE CASCADE,
  content_type TEXT,
  image BLOB,
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Group invite links (/?join=CODE): one person each, valid 7 days, revocable; only the code's SHA-256 is stored.
CREATE TABLE IF NOT EXISTS group_invites (
  id INTEGER PRIMARY KEY,
  code_hash TEXT NOT NULL UNIQUE,
  list_id INTEGER NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TEXT NOT NULL
);

-- Extra sign-in emails linked to an account (e.g. a Google login with a different address); users.email is the main one.
CREATE TABLE IF NOT EXISTS user_identities (
  email TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- A link started on 我的 waits here (token stored as a SHA-256 hash) until the other login comes back.
CREATE TABLE IF NOT EXISTS link_requests (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

-- Per-person daily counts for APIs that have a per-person limit (see lib/usage.js APIS.perUserDaily).
CREATE TABLE IF NOT EXISTS user_daily_usage (
  user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  api TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, api, day)
);

-- One-time codes a group owner sends in their LINE group ("綁定 CODE") to bind it to their list.
CREATE TABLE IF NOT EXISTS line_bind_codes (
  code TEXT PRIMARY KEY,
  list_id INTEGER NOT NULL REFERENCES lists (id) ON DELETE CASCADE,
  created_by INTEGER REFERENCES users (id) ON DELETE SET NULL,
  expires_at TEXT NOT NULL
);

-- Daily call counts per outside API (see lib/usage.js); day is in the timezone the provider resets its quota.
CREATE TABLE IF NOT EXISTS api_usage (
  api TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (api, day)
);

CREATE INDEX IF NOT EXISTS places_url ON places (url);
CREATE INDEX IF NOT EXISTS places_list ON places (list_id);
CREATE INDEX IF NOT EXISTS places_line_message ON places (line_message_id);
