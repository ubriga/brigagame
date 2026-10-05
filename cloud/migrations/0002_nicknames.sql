-- 0002: public nicknames (privacy: real/Google names are never shown to other players).
-- New tables only. Reversible: DROP TABLE user_nicknames; DROP TABLE nickname_blocked;
CREATE TABLE IF NOT EXISTS user_nicknames (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  nickname_norm TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'ok',        -- ok | blocked (admin)
  changes INTEGER NOT NULL DEFAULT 0,       -- paid changes so far (first self-chosen set is free)
  auto INTEGER NOT NULL DEFAULT 0,          -- 1 = system-assigned neutral default (first self-chosen change is free)
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS nickname_blocked (
  norm TEXT PRIMARY KEY,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
